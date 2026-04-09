# UPDATE.md — Working tree changes since `origin/main` (`65cd2ba`)

This document describes every file added, modified, or deleted in the current
working tree relative to `origin/main`. It exists so the team can understand
a large unstaged delta without reading every diff. Once these changes are
merged in chunks (see "Suggested PR breakdown" at the bottom), this file
should be removed or rewritten.

> **Updated** after a consolidation pass: 4 doc files merged into one, 4
> tiny worker utility files merged into `runtime.mjs`, `bias/zones.ts`
> merged into `bias/config.ts`, `cluster-meta-badges.tsx` inlined into
> `cluster-card.tsx`, and 3 dead upstream files (`design/3`, `design/4`,
> `article-detail-dialog.tsx`) removed. Net **−14 files**.

## TL;DR

| Bucket | Count |
|---|---|
| New files (untracked) | 91 |
| Modified tracked files | 23 |
| Deleted tracked files | 14 |
| **Total status entries** | **~128** |

The bulk of the work falls into eight cohesive themes:

1. **Foundation** — vitest setup, shared lib helpers, bias config refactor
2. **Database schema** — 17 Supabase migrations + seeds
3. **Background workers** — RSS, clustering, headline-rewrite, og:image workers
4. **Clustering feature** — story-cluster cards, cluster detail page, ensemble logic
5. **New site pages** — `/blindspots`, `/saved`, `/sources`, `/timeline`, `/trends`, sitemap, robots, manifest, error/loading/not-found
6. **Admin refactor** — admin dashboard decomposed into reusable components
7. **Operational APIs** — `/api/health`, `/api/metrics`, `/api/newsletter`
8. **Misc UX + docs** — bookmarks, share button, source chips, contributor guide, architecture docs

The biggest conceptual change underneath all of this is the **bias taxonomy
shift** — `alignment` (5-value) + `tradition` (7-value) + `source_type` were
collapsed into a single 10-value `BiasCategory` enum. That ripples through
types, components, migrations, and seed data.

---

## 1. Foundation: tests + lib helpers

- **`vitest.config.ts`** — Vitest test runner config; test glob includes
  `src/**/*.test.ts`, `scripts/**/*.test.mjs`, `tests/**/*.test.ts`. Node
  environment, 10s timeout, `@/*` path alias.
- **`tests/api/admin.test.ts`** — Integration tests for `/api/admin`
  (verifies stats payload shape: `articles / sources / clusters / sourcesList`)
  and `/api/cron` endpoints. Also asserts `/cluster/<invalid-uuid>` returns 404.
- **`src/lib/api/errors.ts`** — Canonical JSON error response shape and factory
  helpers (`badRequest`, `unauthorized`, `notFound`, `serverError`) for all
  `/api` routes. Exports a `withApiErrors` wrapper that catches thrown errors
  and converts them to consistent responses.
- **`src/lib/rate-limit.ts`** — In-memory token-bucket rate limiter keyed by
  client IP (from `x-forwarded-for`). Returns `{allowed, retryAfterMs}`.
  Periodic sweep evicts idle buckets so memory doesn't grow unbounded.
- **`src/lib/time.ts`** — Turkish relative-time formatter (`"2 saat önce"`).
  Pure, dependency-free, safe for both Server and Client Components.
- **`src/lib/bias/config.ts`** — Single source of truth for the 10-bias
  taxonomy AND the bias → Medya DNA zone mapping. Exports `BIAS_LABELS`,
  `BIAS_SHORT_LABELS`, `BIAS_COLORS` (per-bias Tailwind class set),
  `BIAS_ORDER` (spectrum rendering order), `BIAS_TO_ZONE`, `ZONE_META`
  (Turkish labels + per-zone Tailwind tokens), and `zoneOf(bias)`.
  *(Was two separate files — `config.ts` and `zones.ts` — collapsed during
  the consolidation pass since they share the same `BiasCategory` key
  space and were always edited together.)*
- **`src/lib/bias/cross-spectrum.ts`** — Detects when a cluster contains
  outlets from the *opposite* zone of its dominant zone (the "surprise"
  signal that drives the blindspot UX). Exports `detectCrossSpectrum` and
  `summarizeSurprises` (renders Turkish blurbs, capped at max count).
- **`src/lib/bias/cross-spectrum.test.ts`** — Unit tests for the
  cross-spectrum detector. Validates the 0.65 dominance threshold, the >=3
  outlet margin guard, and the minimum cluster size floor (5 members).
- **`src/lib/sources/factuality.ts`** — Hand-tagged factuality
  (`high` / `mixed` / `low`) and ownership metadata for ~30 Turkish outlets.
  Exported as `SOURCE_METADATA` keyed by slug; consumed by `<SourceChips>`.

## 2. Database schema (Supabase migrations)

> All migrations are idempotent. Numbering jumps from 009 → 011 because 010
> was a planned migration that got rolled into 011.

- **`005_expand_bias_categories.sql`** — Expands bias from a 3-value union
  (`pro_government / center / opposition`) to the new 10-value taxonomy.
  Migrates legacy `independent` rows to `center`.
- **`006_create_stories_and_stances.sql`** — Creates `stories`
  (hand-curated demo rows: `title_tr / summary_tr / display_order`) and
  `story_stances` (per-story per-source stance:
  `destekliyor / tarafsiz / elestiriyor / sessiz`) tables for the
  surprise-detection showcase.
- **`007_clustering_columns.sql`** — Adds `fingerprint` and `entities[]`
  columns to `articles` for ensemble clustering. Adds partial indexes on
  both. Widens `clusters.blindspot_side` CHECK to the 10-value taxonomy.
  Updates `bias_distribution` default to a 10-key JSONB shape.
- **`008_politics_cleanup.sql`** — Deletes non-political (non
  `politika / son_dakika`) `cluster_articles` and orphaned clusters.
  Recomputes `article_count` + `bias_distribution` on survivors. Adds
  partial indexes scoped to politics-filtered queries.
- **`009_db_hygiene.sql`** — Reclaims disk via `VACUUM FULL clusters` and
  re-`ANALYZE`s affected tables after 008's deletes. No schema changes.
- **`011_source_logos.sql`** — Populates `sources.logo_url` using Google's
  S2 favicon service (URLs derived deterministically from
  `sources.url` hostname).
- **`012_fix_relative_urls.sql`** — Prefixes any relative article URLs with
  their source's base URL. Handles both `url` and `image_url` columns.
- **`013_dedupe_and_hygiene.sql`** — Dedupes `cluster_articles` (keeps the
  earliest row per `(cluster_id, source_id)`). Pre-deletes article duplicates
  that would violate `(source_id, content_hash) UNIQUE`. Recomputes cluster
  stats. Drops 5 never-scanned indexes. Runs `VACUUM` outside transaction.
- **`014_query_perf.sql`** — Adds composite partial index
  `idx_clusters_active_updated_at (updated_at DESC WHERE article_count >= 2)`
  for the home-page badge query. Drops two unused indexes
  (`idx_articles_entities`, `idx_clusters_is_blindspot`).
- **`015_image_attempted_at.sql`** — Adds `image_backfill_attempted_at`
  column to `articles`. The accompanying partial index is scoped to
  `image_url IS NULL` + politics categories so the image worker rotates
  through the backlog instead of looping on the newest 50.
- **`016_unify_content_hash.sql`** — **Largest migration in the set
  (~17k lines).** Unifies 6,638 sha1 content hashes with 10,668 sha256 ones.
  Repoints `cluster_articles` from losers to survivors, deletes losers, then
  re-adds the `UNIQUE` constraint. Lines 28–17,594 are precomputed
  `(id, new_hash)` pairs.
- **`017_rls_policies.sql`** — Enables RLS on every table. Creates
  "public read" policies for `anon` and `authenticated` roles. No write
  policies — `service_role` key bypasses RLS for workers and admin actions.
- **`018_decode_title_entities.sql`** — One-shot pass decoding stray HTML
  entities in article + cluster titles/summaries (e.g. `&amp;apos;` → `'`).
  Fixes ~1,844 articles + ~422 clusters. The RSS worker + `normalize.ts`
  now decode twice on ingest to prevent regressions.
- **`019_neutral_headlines.sql`** — Adds `title_tr_original`,
  `title_tr_neutral`, `title_neutral_at` columns to `clusters`. Backfills
  `title_tr_original`. Creates a partial index for the rewrite worker to
  find clusters needing neutralization.
- **`020_article_body_column.sql`** — Adds `body_excerpt` text column for
  enriching empty-description RSS feeds. Partial index on
  `(published_at DESC)` scoped to `body_excerpt IS NULL` + politics
  categories.
- **`021_newsletter.sql`** — Creates `newsletter_subscribers`
  (`email UNIQUE`, `confirmed BOOLEAN DEFAULT false`) plus a partial index
  on `(confirmed = true)` for a future "send to all confirmed" job.
- **`022_image_backfill_attempts.sql`** — Adds
  `image_backfill_attempts INT NOT NULL DEFAULT 0`. The image worker
  increments after failed attempts and escalates to a 7-day future timestamp
  once `>= 5` consecutive failures, so dead URLs stop hot-looping.
- **`supabase/seed_stories.sql`** — Populates `stories` and `story_stances`
  for three demo clusters (`merkez-bankasi-faiz`, `suriye-sinir-operasyonu`,
  `afad-deprem-elestirileri`) with hand-curated stances showcasing
  cross-spectrum surprise detection.
- **`supabase/config.toml`** *(modified)* — Renamed `project_id` from
  `"uriel"` to `"tayf"`. Trimmed several upstream commented blocks
  (`db.ssl_enforcement`, `storage.s3_protocol`, `storage.analytics`,
  `storage.vector`, `auth.passkey`, `auth.jwt_issuer`, `health_timeout`).

## 3. Background workers (`scripts/`)

- **`scripts/check.sh`** — Master pre-commit check orchestrating `tsc`,
  `eslint`, `node --check` on all workers, **inline cluster lib
  self-tests run via `node`**, and Vitest. Exits non-zero on first failure
  with logs in `/tmp/check-*`.
- **`scripts/rotate-logs.sh`** — Log rotation for `team/status.log` and
  `team/logs/*.log`. Archives oversized files to `team/logs/archive/` with
  timestamp, gzips archives older than 1 day, deletes gzipped files older
  than 30 days.
- **`scripts/rss-worker.mjs`** — Continuous RSS listener (60s cycle,
  pool=8). Fetches all active sources via conditional GET (ETag /
  Last-Modified), upserts normalized articles + `content_hash`, runs the
  haberler-com hook to fetch `og:image` before upsert, and uses a
  per-slug circuit breaker (3 failures → 30 min cooldown). `DRY_RUN=1`
  exits after one cycle.
- **`scripts/cluster-worker.mjs`** — Ensemble clustering worker
  (30 / 15 / 60s adaptive cycle). Computes `fingerprint` + `entities`
  for backfill. Scores candidates against a 48h rolling window using three
  signals: fingerprint exact match, TF-IDF cosine, entity overlap.
  Politics-only (`politika / son_dakika`). Per-source dedupe with
  next-best fallback.
- **`scripts/headline-worker.mjs`** — Neutral headline rewriter
  (60s productive, 300s idle). Walks `idx_clusters_needs_rewrite`. Calls
  `claude-haiku-4-5` via the Anthropic REST API (batch=5, ~$1/month
  budget). Writes `title_tr_neutral` + `title_neutral_at`. Consumers
  coalesce neutral over original.
- **`scripts/image-worker.mjs`** — Backfills `og:image` for articles
  missing one (30 / 120s adaptive cycle). Rotates by
  `image_backfill_attempted_at NULLS FIRST`. Per-host circuit breaker.
  `SKIP_SOURCES` blocklist for sources already handled inline by
  `rss-worker`. Site-specific extractors for known-hard sources. 5s
  per-URL timeout.

### Cluster algorithm libs

> Each `.mjs` file in this directory has its own runnable self-test
> block at the bottom (guarded by
> `if (process.argv[1] === import.meta.url.replace("file://", ""))`).
> Run with `node scripts/lib/cluster/<file>.mjs`. The previous duplicate
> Vitest `*.test.mjs` files were removed during the consolidation pass —
> the inline self-tests are the only suite for these modules now, and
> `scripts/check.sh` invokes them via `node`.

- **`scripts/lib/cluster/constants.mjs`** — Tuning constants
  (`MATCH_THRESHOLD`, `TIME_WINDOW_HOURS`, `MIN_SHARED_ENTITIES`,
  `MAX_CANDIDATE_CLUSTERS`). Single source of truth for the ensemble knobs.
- **`scripts/lib/cluster/ensemble.mjs`** — Ensemble scoring function.
  Combines fingerprint exact match, TF-IDF cosine, and entity overlap into
  a single 0..3 score. Returns top-N candidates above threshold.
  Inline self-tests cover strict auto-accept, MinHash soft-accept, primary
  lane, time decay, and unrelated baseline.
- **`scripts/lib/cluster/entities.mjs`** — Turkish-aware entity extraction
  (people, organizations, locations) from `title + description` via regex
  patterns. Returns a `Set` for O(1) overlap checks. Inline self-tests
  cover MHP-fesh whitelist hits, multi-word phrase rejection, year and
  percentage extraction, and the EN→TR bilingual bridge.
- **`scripts/lib/cluster/fingerprint.mjs`** — Turkish-aware strict
  fingerprinting via 4-gram character shingling + sorted-set dedupe + SHA1.
  Used for near-duplicate detection and `content_hash` unification.
  Inline self-tests cover diacritic folding, digit preservation, MinHash
  Jaccard at near-duplicate vs unrelated extremes.
- **`scripts/lib/cluster/tfidf.mjs`** — TF-IDF indexer scoped to a 48h
  rolling window. Scores article pairs via cosine similarity. Used for
  paraphrase detection in the ensemble.

### Shared worker utilities

> Reduced from 11 files to 7 during the consolidation pass. The 4 tiny
> single-purpose modules (`sleep.mjs`, `signal.mjs`, `env.mjs`, `log.mjs`)
> were collapsed into a single `runtime.mjs` because they were all <70
> lines, all mutually-imported, and `signal → log` was a circular import
> waiting to bite.

- **`scripts/lib/shared/runtime.mjs`** — Worker runtime helpers. Exports
  `loadDotEnvLocal()` (env loader), `ts()` / `log()` / `logCycle()`
  (unified stdout + `team/status.log` writer), `installShutdownHandler()`
  (graceful SIGINT/SIGTERM), `sleep(ms)`, `adaptiveSleep({...})` (3-tier
  busy/normal/idle), and `twoTierSleep({...})` (2-tier work/idle). Imported
  by all four worker scripts as the single shared runtime surface.
- **`scripts/lib/shared/article-body.mjs`** — Fetches article HTML and
  extracts a ≤500-char excerpt for description-less feeds. Wired to the
  `body_excerpt` column (worker integration is a follow-up).
- **`scripts/lib/shared/circuit-breaker.mjs`** — Generic circuit breaker.
  3 consecutive failures → configurable cooldown (default 30 min). Keyed
  by hostname or slug. Used by `rss-worker` and `image-worker`.
- **`scripts/lib/shared/llm-headlines.mjs`** — Calls `claude-haiku-4-5`
  via the Anthropic REST API to neutralize cluster headlines. Used by
  `headline-worker`. Cost discipline baked in (batch=5).
- **`scripts/lib/shared/og-image.mjs`** — Fetches `og:image` from article
  HTML. 5s timeout. Returns URL or `null`. Used by `rss-worker` (haberler
  hook) and `image-worker`.
- **`scripts/lib/shared/pool.mjs`** — Bounded-concurrency work pool.
  Queues tasks and runs up to N in parallel. Used for batched HTTP work.
- **`scripts/lib/shared/supabase.mjs`** — Creates the service-role
  Supabase client for worker scripts. Reads `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`.

## 4. Clustering feature

### Data layer

- **`src/lib/clusters/cluster-detail-query.ts`** — Fetches cluster detail
  data via a single embedded PostgREST select
  (`clusters → cluster_articles → articles → sources`). Wrapped in
  `unstable_cache` (30s TTL per cluster id). Exports `ClusterDetail` shape:
  cluster metadata + members array + all sources for `<MediaDna>`.
- **`src/lib/clusters/politics-query.ts`** — Fetches the politics feed
  (home `/clusters` page) via a single embedded PostgREST select. Filters
  in JS for politics-dominant clusters. Wrapped in `unstable_cache` (30s
  TTL). Sorts by importance-weighted ranker (post-A7). Candidate limit
  widened from 60 → 200; display limit 30.

### Components

- **`src/components/story/cluster-card.tsx`** — Pure presentational
  cluster card for `/clusters`. Renders title, summary, bias spectrum,
  first member with hero image, metadata badges. Composition-ready props
  (`cluster`, `articles`, `sources`). The metadata-pill row component
  (`ClusterMetaBadges`) is now defined as a local function inside this
  file rather than its own module — it was only ever consumed here.
- **`src/components/story/cluster-card-image.tsx`** — `"use client"` child
  for the cluster card image. Handles `onError` for broken remote URLs.
  Selection priority: most-recent-published, first-with-image, or no image
  block.
- **`src/components/story/cluster-stance.tsx`** — Renders a per-story
  stance row from `story_stances`
  (`destekliyor / tarafsiz / elestiriyor / sessiz`) with source chips.
  Used in story detail cards.
- **`src/components/story/cross-spectrum-caption.tsx`** — Renders Turkish
  surprise captions via `summarizeSurprises`
  (e.g. *"⚡ Sözcü (muhalefet) bu iktidara yakın habere yer verdi"*).
  Capped at max lines.
- **`src/components/story/media-dna.tsx`** — Renders the 3-zone Medya DNA
  grid (`iktidar` / `bagimsiz` / `muhalefet`) with per-zone source chips.
  Uses `ZONE_META` presentation tokens.

### Routes

- **`src/app/cluster/[id]/page.tsx`** — Cluster detail page. Awaits
  `params.id` (Next.js 16 Promise). Calls `getClusterDetail`. Renders hero
  image, title + summary, bias spectrum, members list with source chips,
  cross-spectrum captions, share button. Dynamic metadata via
  `generateMetadata`. `revalidate = 30`.
- **`src/app/cluster/[id]/error.tsx`** — Client error boundary for the
  cluster detail page.
- **`src/app/cluster/[id]/loading.tsx`** — Suspense fallback skeleton.
- **`src/app/cluster/[id]/opengraph-image.tsx`** — Dynamic OG image
  generator for share cards. Renders cluster title + source count + hero
  image as PNG.

## 5. New site pages & routing surface

- **`src/app/blindspots/page.tsx`** — `/blindspots` page rendering
  *"kör noktalar"* — stories where ≥85% of outlets sit in one Medya DNA
  zone, opposite spectrum absent. Filters in JS post-fetch for dominant
  zone ≥ 0.85 + `article_count >= 3`. `revalidate = 30`.
- **`src/app/saved/page.tsx`** — `/saved` page (*"Kaydedilenler"*) showing
  bookmarked cluster IDs from `localStorage`. Client component using the
  `useBookmarks` hook. Renders as a list of `/cluster/{id}` links;
  detail pages fetch titles lazily.
- **`src/app/sources/page.tsx`** — `/sources` directory of all 144 active
  sources grouped by bias category. Shows logo, bias badge, 7-day article
  count, last-seen timestamp. Two cached round-trips (sources + 7d
  articles aggregated in-memory). `revalidate = 300`.
- **`src/app/source/[slug]/page.tsx`** — Individual source profile page
  (277 lines). Server Component using `unstable_cache` (300s TTL). Loads
  the source by slug, its 7-day article count, and 20 most recent
  articles in parallel. Exports `generateMetadata` for dynamic SEO with
  bias label and article count in the OpenGraph card. Used as the
  destination for source-chip clicks.
- **`src/app/timeline/page.tsx`** — `/timeline` chronological feed of
  every cluster minted in the last 24h, grouped by hour. `first_published`
  bucketing in JS. Renders as hourly sections newest-first. 100-row LIMIT.
  `revalidate = 60`.
- **`src/app/trends/page.tsx`** — `/trends` page (335 lines). Renders a
  custom 30-day stacked bar chart in inline SVG (no chart library, no
  client JS) showing daily article volume per Medya DNA zone. Uses
  paginated PostgREST fetch (`.range()` in 1000-row chunks) to bypass
  the default `max-rows` cap and pull the full ~22k-article window.
  `revalidate = 3600`.
- **`src/app/sitemap.ts`** — Next.js 16 `sitemap.xml` generator. Static
  routes (`/`, `/blindspots`, `/sources`) + top-1000 clusters
  (`updated_at DESC` where `article_count >= 2`). Includes Google's
  image-sitemap extension (hero image per cluster). `revalidate = 3600`.
- **`src/app/robots.ts`** — `robots.txt` config. Allows all user-agents on
  public routes, disallows `/admin` and `/api/`. Points to `sitemap.xml`.
- **`src/app/manifest.ts`** — PWA manifest
  (`name: "Tayf — Türkiye Haber Analizi"`, `start_url: "/"`,
  `display: "standalone"`, `theme_color: "#0a0a0a"`).
- **`src/app/rss.xml/route.ts`** — `/rss.xml` feed generator (58 lines).
  Pulls the top 30 politics clusters from `getPoliticsClusters()` and
  emits a valid RSS 2.0 channel with per-cluster `title`, `link`,
  `pubDate`, and `description`. `Cache-Control: max-age=300`.
- **`src/app/error.tsx`** — Root-level error boundary catching unhandled
  errors across the app.
- **`src/app/loading.tsx`** — Root-level Suspense fallback.
- **`src/app/not-found.tsx`** — 404 page for unmatched routes.
- **`src/components/layout/nav-links.tsx`** — Navigation link component
  reused across header and sidebar. Renders links to `/`, `/blindspots`,
  `/sources`, `/timeline`, `/trends`, `/saved`.
- **`src/components/kbd-shortcuts.tsx`** — Global keyboard shortcuts
  dialog (105 lines). Listens for two-key sequences (`g h` → home,
  `g b` → blindspots, `g s` → sources, `g a` → admin), `?` to open the
  help dialog, and `Escape` to close it. Ignores key events while a text
  input or contenteditable is focused.
- **`src/components/ui/page-hero.tsx`** — Reusable page-header component
  (icon + title + description). Used by `/blindspots`, `/sources`,
  `/timeline`.

## 6. Admin refactor

The admin dashboard was decomposed from one giant file into a set of
focused components.

- **`src/components/admin/action-result-banner.tsx`** — Toast/banner UI
  for displaying action results (success / error).
- **`src/components/admin/action-row.tsx`** — Row component for admin
  action forms (add source, toggle active, manual cron trigger).
- **`src/components/admin/bias-map.ts`** — Helper mapping bias categories
  to display labels + colors. Used in admin stats rendering.
- **`src/components/admin/quick-actions-card.tsx`** — Card grouping the
  quick admin actions.
- **`src/components/admin/source-dialog.tsx`** — Modal dialog for
  adding/editing sources. Collects `name`, `url`, `rss_url`, `bias`,
  `active`. POSTs to `/api/admin`.
- **`src/components/admin/source-row.tsx`** — Table row component for the
  sources list. Shows name, bias, active toggle, edit/delete buttons.
- **`src/components/admin/stat-card.tsx`** — Card displaying a single
  stat (articles total, clusters, active sources, etc.).
- **`src/components/admin/stats-grid.tsx`** — Grid layout for admin stat
  cards. Fetches metrics from `/api/metrics`.
- **`src/components/admin/worker-stats.tsx`** — Display of worker status
  (last cycle time, cycle count, errors) read from operational logs.

## 7. Operational APIs + newsletter

- **`src/app/api/health/route.ts`** — `GET /api/health` lightweight health
  check. Returns `200 + {status, checks}` when all subsystems are
  reachable, or `503 + details` on critical failure. Checks: database
  (`select 1`), env (required keys present), ingestion (last article age
  < 10 min). 2s per-check timeout.
- **`src/app/api/metrics/route.ts`** — `GET /api/metrics` operational
  metrics. Returns counts for articles (total, last 24h, last hour,
  politics null-image, with-image), clusters (total, multi-article,
  blindspots, avg/cluster), sources (total, active). Queries run in
  parallel. `Cache-Control: max-age=60`.
- **`src/app/api/newsletter/route.ts`** — `POST /api/newsletter` signup.
  Rate-limited (5-token bucket refilling at 1/30s per IP). Validates
  email pragmatically, dedupes via `newsletter_subscribers.email UNIQUE`,
  silently treats duplicates as success (so existence isn't leaked).
  Returns `200 + {success, alreadySubscribed}`.

## 8. Misc UX + docs

- **`src/components/bookmark/use-bookmarks.ts`** — `"use client"` hook
  managing bookmarked cluster IDs in `localStorage`. Exports `ids` set,
  `count`, `toggle(id)`, `clear()` for the `/saved` page.
- **`src/components/filters/search-bar.tsx`** — Debounced search bar
  (60 lines). Syncs the input value to a `?q=` query string parameter
  with a 300 ms debounce wrapped in `startTransition`. Listens for the
  global `/` shortcut to focus the input. Renders a `kbd` hint on the
  right edge for that shortcut.
- **`src/components/source/source-chips.tsx`** — Renders factuality +
  ownership chips per source slug. Reads `SOURCE_METADATA`. Shows no chip
  for unknown slugs (safe partial coverage).
- **`src/components/story/share-button.tsx`** — Share button for cluster
  pages. Copies share URL or opens native share dialog on mobile.
- **`src/components/story/source-chip.tsx`** — Renders a single source
  chip with logo, name, bias badge. Used in cluster cards + detail pages.
- **`docs/README.md`** — Consolidated engineering documentation.
  Combines what used to be four separate files (`docs/API.md`,
  `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, root `CONTRIBUTING.md`)
  into a single document with a table of contents covering: (1) system
  architecture and data flow, (2) HTTP API reference for every
  `/api/*` route, (3) operational runbook (start the stack, add a
  source, recluster, debug a feed, log rotation, …), and (4) the
  contributor guide.

## 9. Modified tracked files

> For brevity these are summarized rather than diffed line-by-line. Run
> `git diff HEAD -- <file>` for the exact change.

- **`.env.local.example`** — Updated environment variable template.
  Reflects new service endpoints; old OpenRouter keys removed.
- **`README.md`** — Updated setup guide. References the clustering worker
  + new pages and adds `scripts/check.sh`.
- **`next.config.ts`** — Updated for Next.js 16. Image domain allowlist
  expanded for `og:image` fetching across the new sources.
- **`package.json`** — Added Vitest, Anthropic SDK, clustering libraries.
  Removed OpenRouter SDK + unused AI libs.
- **`tsconfig.json`** — Tightened strict mode and added path aliases for
  the new module structure.
- **`scripts/check.sh`** — *(modified during the consolidation pass)*
  Added a "Cluster lib self-tests" step that runs each algorithm file
  with `node` to exercise its inline self-test block (replaces the
  deleted Vitest `*.test.mjs` duplicates).
- **`src/app/admin/page.tsx`** — Refactored from one giant file into
  composition of the new `src/components/admin/*` components. Adds the
  worker status display.
- **`src/app/api/admin/route.ts`** — Refactored to use error helpers from
  `src/lib/api/errors.ts` and validate the action enum. Adds `POST`
  actions (add_source, toggle_active, etc.) with proper error responses.
- **`src/app/api/cron/backfill-images/route.ts`** — Adds Cron secret
  validation and improved error logging. Now serves as a manual trigger;
  the actual work runs in `image-worker.mjs`.
- **`src/app/api/cron/ingest/route.ts`** — Same pattern: Cron secret
  validation, manual trigger only. Continuous ingest runs in
  `rss-worker.mjs`.
- **`src/app/globals.css`** — Updated Tailwind 4 `@theme` block with the
  3-zone Medya DNA colors (red / zinc / emerald) and the 10-bias spectrum
  palette. Removed `tailwind.config.js`.
- **`src/app/layout.tsx`** — Updated root layout. Includes new nav links,
  metadata, PWA manifest link. Adds error + loading boundaries.
- **`src/app/page.tsx`** — Home page refactored to use
  `politics-query.ts` + `<ClusterCard>`. Renders 30-cluster list with
  `revalidate = 30`. Adds `<NavLinks>` header.
- **`src/components/layout/header.tsx`** — Updated to include
  `<NavLinks>`. Adds search-bar slot.
- **`src/components/story/bias-badge.tsx`** — Updated to use the new
  10-category `BiasCategory` type and `BIAS_LABELS` / `BIAS_COLORS` from
  `bias/config.ts`. Old `AlignmentCategory` + `TraditionCategory` badges
  removed.
- **`src/components/story/bias-spectrum.tsx`** — Refactored to render a
  10-segment spectrum (was 3 or 5) using `BIAS_ORDER` + `BIAS_COLORS`.
  Shows per-bias count + color legend.
- **`src/lib/bias/analyzer.ts`** — Renamed `AlignmentCategory` →
  `BiasCategory`, `AlignmentDistribution` → `BiasDistribution`
  (`Record<BiasCategory, number>`). Function renamed
  `calculateAlignmentDistribution` → `calculateBiasDistribution`. Exports
  `emptyBiasDistribution()` factory.
- **`src/lib/rss/fetcher.ts`** — Conditional GET handling via
  `ETag` / `Last-Modified`. The old haberler-com `og:image` hook moved
  into `rss-worker.mjs`.
- **`src/lib/rss/normalize.ts`** — Added second HTML entity decode pass
  to clean up the stray `&amp;apos;` patterns caught by migration 018.
- **`src/lib/rss/og-image.ts`** — Refactored og:image extraction.
  Delegates to `scripts/lib/shared/og-image.mjs` where appropriate.
- **`src/types/index.ts`** — **The biggest type-level change.** Replaces
  `AlignmentCategory` (5 values) + `TraditionCategory` (7 values) +
  `SourceType` with a single `BiasCategory` (10 values). Adds
  `MediaDnaZone` (`iktidar` / `bagimsiz` / `muhalefet`). Adds `Stance`
  (`destekliyor` / `tarafsiz` / `elestiriyor` / `sessiz`). Removes
  `ALIGNMENT_META` / `TRADITION_META` / `SOURCE_TYPE_META`. Updates
  `Source` interface (`alignment` / `tradition` / `source_type` → `bias`).
  Updates `Cluster` interface (adds `title_tr_neutral`,
  `title_tr_original`).
- **`supabase/migrations/001_create_sources.sql`** — Updated `sources`
  table schema to use the new `BiasCategory` CHECK (10 values). Adds
  `logo_url` column definition.
- **`supabase/seed_sources.sql`** — Updated seed data to assign each
  source a `BiasCategory` from the 10-value taxonomy (replaces the old
  `alignment + tradition + source_type` triple).
- **`package-lock.json`** — Regenerated by `package.json` changes.

## 10. Deleted tracked files

### Deleted by the working tree refactor

- **`src/app/api/stories/route.ts`** — DELETE endpoint removed; the
  functionality moved to the SQL seed + admin UI.
- **`src/app/design/1/page.tsx`**, **`src/app/design/2/page.tsx`**,
  **`src/app/design/page.tsx`** — Design system showcase pages removed.
  Style guidance lives in `team/style-guide.md` (gitignored).
- **`src/components/story/article-card.tsx`** — Replaced by
  `cluster-card.tsx`, which renders clusters instead of individual
  articles.
- **`src/components/story/article-feed.tsx`** — Feed layout logic folded
  into the cluster-based pages
  (`politics-query.ts` + page components).
- **`src/components/story/category-badge.tsx`**,
  **`src/components/story/category-filter.tsx`** — Category filtering
  removed from the UI. The category column still exists in the DB but is
  not surfaced (politics-only clustering means category is implicit).
- **`src/lib/ai/openrouter.ts`** — OpenRouter SDK dependency removed.
  Headline rewriting now uses the Anthropic SDK via
  `scripts/lib/shared/llm-headlines.mjs`.
- **`src/lib/supabase/client.ts`** — Client-side Supabase logic removed.
  All reads now happen in Server Components via `createServerClient`.

### Deleted during the consolidation pass

These came in via the upstream merge (`65cd2ba`) but were dead code in
the new direction — they referenced types and modules that no longer
exist (`AlignmentCategory`, `TraditionCategory`, `category-badge.tsx`)
and were removed during the cleanup pass:

- **`src/app/design/3/page.tsx`**, **`src/app/design/4/page.tsx`** —
  Last two design-system showcase pages, the same pattern as `design/1`
  and `design/2` which were already removed by the refactor.
- **`src/components/story/article-detail-dialog.tsx`** — Per-article
  modal dialog. Imported `AlignmentBadge`, `TraditionBadge`,
  `category-badge`, and `AlignmentDistribution` — all of which had been
  deleted. The cluster detail page replaces its role.
- **`supabase/migrations/005_alignment_tradition_source_type.sql`**
  *(replaced)* — Was the original 005 migration creating the
  3-column bias schema. Replaced by `005_expand_bias_categories.sql`.
- **`turkish_news_rss_database_v2.xlsx - All News Outlets.csv`** —
  Stray spreadsheet export that shouldn't have been tracked.

---

## Suggested PR breakdown

To keep reviews tractable, this should land as 8 PRs in the following
order:

1. **PR 1 — Foundation: tests + lib helpers**
   `vitest.config.ts`, `tests/`, `src/lib/api/errors.ts`,
   `src/lib/{rate-limit,time}.ts`, `src/lib/bias/config.ts` (now also
   contains the zone mapping), `src/lib/sources/factuality.ts`,
   `tsconfig.json`.
2. **PR 2 — Database schema**
   The 17 new migrations + `supabase/config.toml` + `seed_stories.sql` +
   the modified `001_create_sources.sql` + `seed_sources.sql`.
3. **PR 3 — Background workers**
   All of `scripts/`, including the consolidated
   `scripts/lib/shared/runtime.mjs`. Touches `.env.local.example` and
   `src/app/api/cron/*` (which now just trigger the workers). The
   modified `scripts/check.sh` ships here too.
4. **PR 4 — Clustering feature**
   `src/lib/clusters/`, `src/lib/bias/cross-spectrum.{ts,test.ts}`,
   `src/components/story/cluster-*` (cluster-card now contains the
   inlined `ClusterMetaBadges`), `cross-spectrum-caption`, `media-dna`,
   `src/app/cluster/[id]/`, modified `src/app/page.tsx`.
5. **PR 5 — New site pages + routing**
   `blindspots`, `saved`, `sources`, `source/[slug]`, `timeline`,
   `trends`, `sitemap.ts`, `robots.ts`, `manifest.ts`, `rss.xml`,
   `error.tsx`, `loading.tsx`, `not-found.tsx`, `nav-links`,
   `kbd-shortcuts`, `page-hero`, modified `header.tsx`, `layout.tsx`,
   `globals.css`.
6. **PR 6 — Admin refactor**
   `src/components/admin/*`, modified `src/app/admin/page.tsx` and
   `api/admin/route.ts`.
7. **PR 7 — Operational APIs + newsletter**
   `api/health`, `api/metrics`, `api/newsletter` (the
   `021_newsletter.sql` migration ships in PR 2).
8. **PR 8 — Misc UX + docs**
   `bookmark`, `share-button`, `source-chip`, `source-chips`,
   `search-bar`, `docs/README.md` (consolidated). Plus the bias taxonomy
   ripple: `bias-badge.tsx`, `bias-spectrum.tsx`, `analyzer.ts`,
   `types/index.ts`.
   *(The bias taxonomy change is foundational and could alternatively
   move to PR 1 if you want the rest of the stack to assume it from the
   start.)*

The deletions can hitch a ride with whichever PR replaces them
(e.g. `article-card.tsx` deletion goes with PR 4 since
`cluster-card.tsx` replaces it). The 3 dead-upstream deletions
(`design/3`, `design/4`, `article-detail-dialog.tsx`) can go with PR 5
since they're routing/component cleanup.
