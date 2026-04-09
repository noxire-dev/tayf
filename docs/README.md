# Tayf — Engineering Documentation

This is the consolidated docs index. Four separate files used to live here
(`API.md`, `ARCHITECTURE.md`, `RUNBOOK.md`, and root-level `CONTRIBUTING.md`);
they were merged into this single document because the cross-references
between them were tighter than the file boundaries justified, and four files
of ~200–350 lines each was too much filesystem ceremony for a project this
size.

## Table of contents

1. [Architecture](#1-architecture)
2. [HTTP API reference](#2-http-api-reference)
3. [Runbook](#3-runbook)
4. [Contributing](#4-contributing)

---

# 1. Architecture

Audience: an engineer who needs to modify the system. The root `README.md`
explains how to *run* it; this section explains how the pieces fit and
where to cut.

## The data flow

```
  144 active RSS feeds (10 bias categories)
            │
            ▼
  scripts/rss-worker.mjs ─────────► articles                (sources FK)
   60s cycle, pool=8                 (id, source_id, title,
   ETag/IMS conditional GET           url, published_at,
   dead-feed circuit breaker          content_hash, category,
   per-source haberler-com hook       image_url, fingerprint,
            │                         entities, image_backfill_attempted_at)
            │                            │
            │                            ▼
            │                  scripts/image-worker.mjs
            │                  30s/120s adaptive cycle
            │                  attempted_at NULLS FIRST rotation
            │                  per-host circuit breaker
            │                  source blocklist (haberler-com, …)
            ▼
  scripts/cluster-worker.mjs (politics-only)
   30s/15s/60s adaptive cycle
   enrich → fingerprint + entities
   ensemble score vs 48h rolling clusters
   per-source dedupe guard + next-best fallback
            │
            ▼
   cluster_articles ⋈ clusters
   (article_count, bias_distribution jsonb,
    is_blindspot, blindspot_side, updated_at)
            │
            ▼
  Next.js 16 app/ server components
   src/lib/clusters/politics-query.ts        (home list,  unstable_cache 30s)
   src/lib/clusters/cluster-detail-query.ts  (detail,     unstable_cache 30s, per-id wrapper)
            │  createServerClient (service role)
            ▼
   src/app/page.tsx                  →  ClusterCard list
   src/app/cluster/[id]/page.tsx     →  Hero, BiasSpectrum, ClusterStance, MediaDna
```

The frontend never round-trips through `app/api/*` for read paths. It uses
`createServerClient` directly inside server components — there is no
self-fetch hop.

## The three workers

All three are ESM, Node 20, no TypeScript, share helpers from
`scripts/lib/shared/runtime.mjs` (env loader, log, signal, sleep helpers)
plus `circuit-breaker`, `pool`, `og-image`, `supabase`. Run under tmux
panes; `DRY_RUN=1` exits after one cycle.

### scripts/rss-worker.mjs (1010 lines)

- Fixed 60s cycle, bounded-concurrency pool of 8 (`RSS_CONCURRENCY` env).
- Drives HTTP via global `fetch` + `AbortSignal.timeout(10_000)` (W4-Q5
  dropped 15s → 10s) so it can read response headers for ETag /
  Last-Modified conditional GETs. `parser.parseString` is used, never
  `parseURL`.
- Conditional-GET cache: per-source `{etag, lastModified}` map. ~25-30
  cond-304 short-circuits per cycle in steady state, cycle median 6.3s.
- Seen-hash cache: `Set<sourceId\x1fcontent_hash>` refreshed every 5
  cycles from a 7-day lookback. Skips per-source pre-check round-trips
  (~105 queries removed from the hot path). DB UNIQUE constraint
  `articles_source_content_hash_key` is the authoritative backstop.
- Dead-feed breaker (`createCircuitBreaker`): 3 consecutive failures →
  30 min cooldown, keyed by source slug.
- Per-source hook for `haberler-com`: after parse, items still missing
  `image_url` get a focused 8-way concurrent og:image fetch (50KB HTML
  read, 5s timeout) BEFORE the batched upsert so first-insert rows
  already carry their hero image. This source is ~25% of corpus and
  ships zero RSS image fields.
- Output: rows into `articles` (title, url, description, image_url,
  content_hash, category, source_id, published_at). `category` is
  classified by `src/lib/rss/normalize.ts`.

### scripts/cluster-worker.mjs (985 lines)

- Adaptive cycle (`adaptiveSleep` from `scripts/lib/shared/runtime.mjs`):
  `processed===0`→60s idle, `1..10`→30s normal, `>10`→15s busy.
- Politics filter at the source: only `category IN ('politika','son_dakika')`
  is read. Non-politics is ingested but never clustered.
- Per cycle:
  1. Pages every `cluster_articles.article_id` into a `Set` of assigned ids
     (works around PostgREST 1000-row cap).
  2. Pages politics articles newest-first, picks the first `BATCH_SIZE=500`
     unassigned.
  3. **Enrich**: `fingerprint(title, description)` returns
     `{strict, shingles, signature}`. Strict SHA-1 is persisted to
     `articles.fingerprint`; the `Uint32Array(64)` MinHash signature lives
     only in memory (no DB column). Entities pulled via `extractEntities`.
     Bulk `upsert(onConflict:"id")` with chunked-50 fallback.
  4. **Cluster context** (cached 60s): all `clusters` with
     `updated_at >= now() - 48h`, joined to politics member articles.
     Builds `seedByCluster` (oldest member as seed, signature recomputed
     fresh) and `sourceIdsByCluster: Map<clusterId, Set<sourceId>>` for
     the dedupe guard.
  5. **Candidate gen** (`findCandidateClusters`): inverted indices on
     fingerprint and entity tokens. Fingerprint hits go first (Infinity
     priority), then clusters sharing `>= MIN_SHARED_ENTITIES (=2)` tokens.
     Capped at `MAX_CANDIDATE_CLUSTERS=20`.
  6. **TF-IDF index** (`scripts/lib/cluster/tfidf.mjs`): in-memory,
     smoothed idf `log((N+1)/(df+1))+1`, cosine over batch + seeds.
  7. **Score** every candidate via `ensemble.score(...)` (see below) and
     keep all that clear `MATCH_THRESHOLD * 0.9` for the next-best
     fallback (W5-A1).
  8. **Assign**: best candidate ≥ `MATCH_THRESHOLD (0.48)` wins. If the
     per-source guard blocks it, mark blocked and try the next candidate
     ≥ floor; only spawn a singleton when every viable cluster is
     blocked (`scripts/cluster-worker.mjs:815-847`).
- `addArticleToCluster` recomputes `bias_distribution`, `is_blindspot`,
  `blindspot_side`, `article_count`, `first_published`, `updated_at`
  from DB truth after every insert.

### scripts/image-worker.mjs (457 lines)

- Adaptive sleep: 30s after a productive cycle, 120s when idle
  (`twoTierSleep` from `runtime.mjs`).
- Candidate query: `image_url IS NULL AND category IN ('politika','son_dakika')`,
  excluding `SKIP_SOURCES` (haberler-com, anadolu-ajansi, trt-haber,
  sol-haber, aa.com.tr, cnn-turk — proven 0% og:image presence by
  audit), ordered `image_backfill_attempted_at NULLS FIRST` so the tail
  drains. Slugs resolved to ids once at startup.
- `BATCH_LIMIT=50`, pool concurrency 5. Each row: `fetchOgImage(url,
  {timeoutMs:5000})` (50KB HTML read, parses `<meta property="og:image">`).
- Per-host circuit breaker keyed on hostname: 3 fails → 30 min cooldown.
  Null result (site responded but no og:image) does NOT trip the breaker.
- `markAttempted` always bumps the rotation timestamp; on success the
  `image_url + attempted_at` write is one round-trip.
- Backed by migration `015_image_attempted_at.sql`.

## The clustering algorithm (ensemble)

All in `scripts/lib/cluster/`. Constants live in `constants.mjs`; touch
them, not the code, to retune.

### Stage 1 — Strict fingerprint (auto-accept)

`fingerprint.mjs::strictFingerprint(title, description)` Turkish-folds
(`ş→s`, `İ/ı→i`, `ğ→g`, …), drops stopwords, **preserves digits** (R2
finding), then computes a SHA-1 over the sorted unique 4-character
shingle set of the canonical token stream. Two articles whose 4-gram
sets are identical hash equal → ensemble returns `score=1.0`
unconditionally. Used for wire-copy near-duplicates (AA/DHA reshuffles).

### Stage 2 — MinHash Jaccard soft-accept

`fingerprint.mjs::minhashSignature` builds a `Uint32Array(64)` via the
universal-hash trick `h_i(x) = ((a_i * h(x) + b_i) mod p) mod 2^32` over
the same shingle set, with deterministic per-index coefficients seeded
from `sha256("a:i")`/`"b:i"` so signatures are comparable across
processes. `jaccardFromSignatures(a, b) = (matching_slots / k)` with std
dev ~12.5% at k=64. Soft-accept lane in `ensemble.mjs`:
`jaccardScore = J >= 0.5 ? 0.6 + 0.4*J : 0.5*J` (W5-A3 dropped the
floor 0.6 → 0.5).

### Stage 3 — Primary lane (TF-IDF + entities)

- TF-IDF: `tfidf.mjs::TfidfIndex` (in-memory, smoothed idf, cosine).
- Entities: `entities.mjs::extractEntities` matches single-token canonical
  forms against the 85-token Turkish political whitelist (parties,
  institutions, top-14 cities, frequent foreign actors, named figures);
  also harvests 4-digit years 1950-2099 and `pct\d+` percentages.
  Critically does NOT capture multi-word capitalized phrases — that
  inflated the denominator and capped MHP-fesh entity score at 0.25.
- Entity ratio: `shared / max(ENTITY_DENOM_MIN=3, min(|A|, |B|))`. The
  `min` denominator and noise floor of 3 are the R2 fix.
- Primary score: `TFIDF_WEIGHT(0.40)*tfidf + ENTITY_WEIGHT(0.60)*entityRatio`.
- Final raw: `max(jaccardScore, primary)`. The MinHash lane is a parallel
  ceiling, not a third weighted lane — either path can carry the pair.
- Time decay: `final = raw * max(0, 1 - hoursDelta/TIME_WINDOW_HOURS)`
  with `TIME_WINDOW_HOURS=48`.

### Stage 4 — Per-source dedupe guard with next-best fallback

`addArticleToCluster` (`scripts/cluster-worker.mjs:548-644`) checks
`sourceIdsByCluster.get(clusterId).has(article.source_id)` before
inserting (cold-cache fallback hits a targeted DB query and backfills).
On block, `runCycleBody` (lines 815-847) iterates the scored candidate
list to the next cluster scoring `>= MATCH_THRESHOLD * 0.9 (=0.432)`,
only spawning a singleton if every viable cluster is already blocked.
This is the W5-A1 fix to the singleton-fragmentation regression.

## The bias taxonomy

10 categories (`src/types/index.ts::BiasCategory`) collapse to 3 Medya
DNA zones (`src/lib/bias/config.ts::BIAS_TO_ZONE`):

| Zone | Categories |
|---|---|
| `iktidar` | `pro_government`, `gov_leaning`, `state_media`, `islamist_conservative`, `nationalist` |
| `bagimsiz` | `center`, `international`, `pro_kurdish` |
| `muhalefet` | `opposition_leaning`, `opposition` |

`ZONE_META` carries the 3-zone Tailwind tokens. The 10-hue palette
(`BIAS_COLORS`) is restricted to the spectrum bar and the MediaDNA chip
wall. DB CHECK constraints on `sources.bias` (migration 005) and
`clusters.blindspot_side` (migration 007) enforce the 10-value enum.

## The frontend composition

- **Server Component by default.** Next.js 16.2.2, React 19.2.4. Routes
  declare `export const revalidate = 30` so the SSR shell evicts in
  lockstep with the data layer.
- **Direct Supabase reads.** `src/app/page.tsx` calls
  `getPoliticsClusters()`; `src/app/cluster/[id]/page.tsx` calls
  `getClusterDetail(id)`. Both use `createServerClient` (service role).
  `app/api/*` is admin/cron only — never used by the UI.
- **One round-trip per page.** `politics-query.ts` issues a single
  PostgREST embedded select walking `clusters → cluster_articles →
  articles → sources` (collapsed from 4 sequential queries). Detail
  page fires three queries in parallel via `Promise.all`: cluster row,
  embedded members tree, full sources directory for MediaDna.
- **`unstable_cache` with 30s TTL.** Both queries are wrapped, keyed by
  version (`clusters:politics:v3`) or per-id (`["cluster-detail", id]`).
  Detail wrapper is memoized in a per-id `Map` because `unstable_cache`
  bakes `tags` at wrap-time. Workers can `revalidateTag(...)` to push
  fresh data without waiting for the TTL.
- **Server-side dedupe (defense in depth).** Both query files do
  `seenSources.has(source.id)` after sorting members ASC by
  `published_at`, keeping the earliest article per source. This is the
  third dedupe layer behind the worker guard and the DB UNIQUE
  constraint.
- **Client islands** (`"use client"`) only where state or DOM events
  exist:
  - `cluster-card-image.tsx` — img onError fallback to gradient placeholder
  - `media-dna.tsx` — show-all toggle for the 144-source grid
  - `kbd-shortcuts.tsx` — global keyboard shortcut handler
  - `search-bar.tsx` — debounced URL-sync search

## Database schema + migrations

`supabase/migrations/`:

| File | What it does |
|---|---|
| `001_create_sources.sql` | `sources` table; PK uuid, UNIQUE slug, bias CHECK |
| `002_create_articles.sql` | `articles` table; FK source_id, indexes on source_id, published_at, content_hash, created_at |
| `003_create_clusters.sql` | `clusters` + `cluster_articles` join; bias_distribution jsonb, is_blindspot, blindspot_side |
| `004_add_article_category.sql` | `articles.category` text + `idx_articles_category` |
| `005_expand_bias_categories.sql` | bias CHECK 3 → 10 values; migrates `independent` → `center` |
| `006_create_stories_and_stances.sql` | `stories` + `story_stances` (legacy hand-curated demo, mostly dead) |
| `007_clustering_columns.sql` | `articles.fingerprint` text + `articles.entities` jsonb; `clusters.blindspot_side` CHECK lifted to 10 values; `bias_distribution` default updated |
| `008_politics_cleanup.sql` | One-shot DELETE of non-politics clusters (~5,949 rows) before the politics filter shipped |
| `009_db_hygiene.sql` | `VACUUM FULL clusters` after the 008 delete; tightens autovacuum thresholds |
| `011_source_logos.sql` | Backfills `sources.logo_url` from Google S2 favicon service |
| `012_fix_relative_urls.sql` | Repairs `articles.url` rows that stored a path instead of an absolute URL |
| `013_dedupe_and_hygiene.sql` | Removes 800 duplicate `cluster_articles`; adds `articles_source_content_hash_key` UNIQUE; drops 5 zero-scan indexes |
| `014_query_perf.sql` | Adds `idx_clusters_active_updated_at`, `idx_cluster_articles_article_id` (anti-join); drops 2 dead indexes |
| `015_image_attempted_at.sql` | `articles.image_backfill_attempted_at` timestamptz + index for image-worker rotation |
| `016_unify_content_hash.sql` | D10: unifies cross-regime sha256/sha1 hash twins, repoints `cluster_articles` at survivors, deletes losers |
| `017_rls_policies.sql` | Public-read RLS on every table |
| `018_decode_title_entities.sql` | One-shot HTML-entity decode pass on titles + summaries |
| `019_neutral_headlines.sql` | `clusters.title_tr_neutral` + index for the headline-worker |
| `020_article_body_column.sql` | `articles.body_excerpt` text for description-less feeds |
| `021_newsletter.sql` | `newsletter_subscribers` table |
| `022_image_backfill_attempts.sql` | `articles.image_backfill_attempts` int — escalation guard for dead URLs |

(`010` is intentionally absent — number burned during a rollback.)

## The status.log swarm protocol

Every long-running script appends a single line to `team/status.log`
shaped as `HH:MM:SS <agent>: <msg>`. Tailers `grep cycle=` for the
structured worker summaries. The convention is purely social — no file
lock, no schema, no rotation beyond what `scripts/rotate-logs.sh` does.

Workers emit one structured cycle line via `formatCycleSummary`:
`cycle=N processed=N match=N new=N skipped-same-source=N duration=Ns sleep=Nms`
— field order is fixed so column-aware tailers stay stable.

---

# 2. HTTP API reference

This section describes every HTTP route exposed under `src/app/api/` in
the Tayf Next.js app. The codebase contains the following route files:

| File | Methods |
| --- | --- |
| `src/app/api/admin/route.ts` | `GET`, `POST` |
| `src/app/api/cron/ingest/route.ts` | `GET` |
| `src/app/api/cron/backfill-images/route.ts` | `GET` |
| `src/app/api/health/route.ts` | `GET` |
| `src/app/api/metrics/route.ts` | `GET` |
| `src/app/api/newsletter/route.ts` | `POST` |

All routes return JSON. All examples assume the dev server is running on
`http://localhost:3000` (the default for `npm run dev`).

## Cross-cutting concerns

### Error envelope

The canonical error shape lives in `src/lib/api/errors.ts` and is used
by every route. Clients can rely on `error` always being a
human-readable string; `code` and `details` are optional and intended
for programmatic handling.

```ts
interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
```

The module exports a small set of helpers that all return a
`NextResponse` with the appropriate HTTP status:

| Helper | Status | Notes |
| --- | --- | --- |
| `apiError(status, message, opts?)` | _custom_ | Base builder used by everything below. |
| `apiBadRequest(reason, details?)` | `400` | Validation / malformed input. |
| `apiUnauthorized(reason?)` | `401` | Missing or invalid `CRON_SECRET`. |
| `apiNotFound(what?)` | `404` | Resource not found. |
| `apiServerError(err, code?)` | `500` | Logs the error to stderr with an `[api]` prefix and returns the message to the caller. |

### `withApiErrors` wrapper

Every route handler is wrapped in `withApiErrors`, also from
`src/lib/api/errors.ts`. The wrapper catches any thrown error and
converts it into a uniform `500` response via `apiServerError`, instead
of letting Next.js render its default HTML error page.

```ts
export const GET = withApiErrors(async (request: Request) => {
  // ... handler body. Anything thrown here becomes a 500 JSON error.
});
```

### Authentication

| Route | Auth |
| --- | --- |
| `GET /api/admin` | **None.** Unprotected. |
| `POST /api/admin` | **None.** Unprotected. Allows destructive actions (`nuke_clusters`, `delete_source`). |
| `GET /api/cron/ingest` | `Bearer ${CRON_SECRET}` in `Authorization` header — **but only if `CRON_SECRET` is set in the environment**. With no env var the route is open. |
| `GET /api/cron/backfill-images` | Same conditional `CRON_SECRET` check as above. |
| `GET /api/health` | None. |
| `GET /api/metrics` | None. |
| `POST /api/newsletter` | None — but rate-limited (5 tokens / 30s per IP). |

> **Security note (not fixed here):** the `/api/admin` routes are
> completely unauthenticated. In a non-local deployment any caller can
> list sources, add/update/delete sources, wipe all clusters, and
> trigger ingest / backfill jobs. The two cron routes only require auth
> if `CRON_SECRET` is defined; an unset env var silently disables the
> check. Both behaviours should be revisited before any public
> deployment.

## `GET /api/admin`

**Purpose**: Dashboard stats plus the full source list rendered by the
admin panel at `/admin`.

**Response shape** (`200 OK`):

```json
{
  "articles": 11808,
  "sources": 144,
  "clusters": 2552,
  "missingImages": 2512,
  "sourcesList": [
    {
      "id": "8d401d96-d585-470a-bdd8-3d13a5e5220c",
      "name": "Karar",
      "slug": "karar",
      "url": "https://www.karar.com",
      "rss_url": "https://www.karar.com/service/rss.php",
      "bias": "center",
      "active": true
    }
  ]
}
```

`sourcesList` is ordered by `bias` ascending. The four count fields come
from `count: "exact", head: true` queries against Supabase and default
to `0` if the count is null.

## `POST /api/admin`

**Purpose**: Multiplexed admin action endpoint. The `action` field on
the JSON body selects one of nine sub-operations.

| `action` | Other required fields | Effect |
| --- | --- | --- |
| `nuke_articles` | _(none)_ | Deletes every row from `cluster_articles`, `clusters`, and `articles`. Irreversible. |
| `nuke_clusters` | _(none)_ | Deletes every row from `cluster_articles` and `clusters`. Articles preserved. |
| `ingest` | _(none)_ | Server-side `fetch` to `/api/cron/ingest`, proxies the JSON response back. |
| `backfill_images` | _(none)_ | Server-side `fetch` to `/api/cron/backfill-images`, proxies the response. |
| `toggle_source` | `slug`, `active` | `UPDATE sources SET active = $active WHERE slug = $slug`. |
| `add_source` | `name`, `slug`, `url`, `rss_url`, `bias` | Inserts a new row in `sources` with `active: true`. |
| `update_source` | `id` (plus any of `name`, `slug`, `url`, `rss_url`, `bias`, `active`) | Sparse update by id. |
| `delete_source` | `id` | `DELETE FROM sources WHERE id = $id`. |

**Status codes**: `200` success, `400` unknown action / missing fields,
`500` Supabase or thrown error.

```bash
# Trigger an RSS ingest from the admin panel
curl -X POST -H "Content-Type: application/json" \
  -d '{"action":"ingest"}' \
  http://localhost:3000/api/admin

# Add a new source
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "action":"add_source",
    "name":"Example",
    "slug":"example",
    "url":"https://example.com",
    "rss_url":"https://example.com/rss",
    "bias":"center"
  }' \
  http://localhost:3000/api/admin
```

## `GET /api/cron/ingest`

**Purpose**: Manual / fallback RSS ingestion trigger. The primary path
is the long-running tmux worker (`scripts/rss-worker.mjs`); this route
exists for the admin panel "Çek" button and Vercel Cron when the project
is deployed without a background worker. `maxDuration` is 120s.

**Worker-collision guard**: before doing anything the route counts rows
inserted into `articles` in the last 30s. If any are found, the tmux
worker is presumed live and this invocation short-circuits with a
`{"skipped": true}` payload instead of re-fetching every feed.

```bash
curl http://localhost:3000/api/cron/ingest

# With cron secret
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/ingest
```

## `GET /api/cron/backfill-images`

**Purpose**: Pulls the 30 most recently published image-less articles
and fetches an `og:image` for each one with bounded concurrency (`5`),
updating rows in place. The tmux RSS worker deliberately does **not** do
this; this endpoint is the single source of truth for og:image backfill.
Run repeatedly until `remaining` reads `"all done"`. `maxDuration` is
120s.

## `GET /api/health`

Lightweight liveness check. Returns `200 + {status: "ok", checks: {…}}`
when database, env, and ingestion freshness are all healthy, or `503 +
details` on critical failure. Each subcheck has a 2s timeout.

## `GET /api/metrics`

Operational metrics for the admin dashboard and external monitoring.
Returns counts in three buckets: articles (total / 24h / 1h /
politics-with-image / politics-no-image), clusters (total / multi-article /
blindspots / avg-per-cluster), sources (total / active). All queries run
in parallel; `Cache-Control: max-age=60`.

## `POST /api/newsletter`

Email signup endpoint. Rate-limited (5 tokens, refills at 1 token per
30s, keyed by IP). Validates email pragmatically, dedupes via
`newsletter_subscribers.email UNIQUE`, silently treats duplicates as
success so existence isn't leaked. Returns `{success, alreadySubscribed}`.

## Follow-ups

- **Auth.** `/api/admin` has no authentication. The two cron routes only
  enforce `CRON_SECRET` when the env var happens to be set.
- **Rate limiting.** Only `/api/newsletter` is rate-limited.
- **Destructive POST actions.** `nuke_articles`, `nuke_clusters`, and
  `delete_source` are reachable by any caller of `POST /api/admin`.
- **Origin trust.** The `ingest` and `backfill_images` admin actions
  build their internal fetch URL from the request `Origin` header (with
  a `http://localhost:3000` fallback). A spoofed `Origin` would redirect
  the internal call.

---

# 3. Runbook

Operational guide for everyday tasks on Tayf. Every command here is
copy-pasteable and assumes you are at the repo root with `supabase`,
`node@20`, `psql`, and `tmux` on your `PATH`. The local DB connection
string is exported below as `PSQL` for brevity.

```bash
export PSQL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
```

## 3.1 Start the whole local stack from scratch

Boot Postgres + API, apply schema, seed sources, launch the three
workers in tmux, and start Next.

```bash
# 1. Local Supabase (Postgres on :54322, Studio on :54323)
supabase start

# 2. Apply every migration in order
ls supabase/migrations/*.sql | sort | xargs -I{} psql "$PSQL" -f {}

# 3. Seed the 144 sources (idempotent insert)
psql "$PSQL" -f supabase/seed_sources.sql

# 4. Bootstrap tmux session with one window per worker.
tmux kill-session -t tayf-app 2>/dev/null
tmux new-session  -d -s tayf-app -n app
tmux new-window   -t tayf-app   -n rss-worker
tmux new-window   -t tayf-app   -n cluster-worker
tmux new-window   -t tayf-app   -n image-worker

# 5. Launch the dev server
tmux send-keys -t tayf-app:app 'npm run dev 2>&1 | tee /tmp/tayf-dev.log' Enter

# 6. Launch each worker
tmux send-keys -t tayf-app:rss-worker     'PATH=/opt/homebrew/opt/node@20/bin:$PATH node scripts/rss-worker.mjs'     Enter
tmux send-keys -t tayf-app:cluster-worker 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node scripts/cluster-worker.mjs' Enter
tmux send-keys -t tayf-app:image-worker   'PATH=/opt/homebrew/opt/node@20/bin:$PATH node scripts/image-worker.mjs'   Enter

# 7. Attach
tmux attach -t tayf-app
```

Open <http://localhost:3000> for the homepage and <http://127.0.0.1:54323>
for Supabase Studio. The first cycle of `rss-worker` lands articles
within ~60s; `cluster-worker` picks them up on its next 30s tick.

## 3.2 Add a new source

### Admin UI (preferred)

1. Open <http://localhost:3000/admin>.
2. Click **Kaynak Ekle** in the *Kaynaklar* card.
3. Fill the dialog: **name**, **slug** (auto-generated from name if
   blank), **url**, **rss_url**, **bias**, **active**.
4. Save. The new row appears immediately, and the next `rss-worker`
   cycle (≤60s) will fetch its feed.

### SQL fallback

```sql
insert into sources (name, slug, url, rss_url, bias, active) values
  ('Example Outlet', 'example-outlet',
   'https://example.com', 'https://example.com/rss.xml',
   'center', true);
```

`bias` must be one of: `pro_government`, `gov_leaning`, `state_media`,
`center`, `opposition_leaning`, `opposition`, `nationalist`,
`islamist_conservative`, `pro_kurdish`, `international` — enforced by
`sources_bias_check` (migration 005).

## 3.3 Re-cluster everything from scratch

When to do this: after tuning anything in
`scripts/lib/cluster/constants.mjs` (thresholds / weights), or to repair
clusters built by an older algorithm version.

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
  node scripts/recluster.mjs 2>&1 | tee /tmp/recluster.log
```

The script sends `C-c` to `tayf-app:cluster-worker`, snapshots counts,
truncates `cluster_articles` + `clusters` (paged delete), streams every
politics article in chronological order in chunks of 500, recomputes
fingerprint + entities and re-runs the ensemble, then restarts the live
worker. ~3–8 minutes for ~10k politics articles on the dev box.

Knobs:
- `RECLUSTER_DRY_RUN=1` — score and count, do not write.
- `RECLUSTER_PAUSE_TMUX=0` — skip the pause/resume dance.
- `RECLUSTER_TMUX_PANE=tayf-app:5.0` — override the pane id.

## 3.4 Investigate a broken feed

Read the rss-worker log for the dead-feed breaker:

```bash
tmux capture-pane -p -t tayf-app:rss-worker -S -2000 \
  | grep -E "circuit open|consecutive failures|\[<slug>\]"
```

After 3 consecutive failures the worker logs
`reached 3 consecutive failures — circuit open for 30 min` and skips
the source until the cooldown elapses.

Manual fetch to see what the upstream is returning:

```bash
RSS_URL='https://www.example.com/rss.xml'
curl -sSI -A 'Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)' "$RSS_URL"
curl -sS  -A 'Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)' "$RSS_URL" | head -40
```

Permanent URL change — patch `sources` and let the breaker self-recover:

```sql
update sources
   set rss_url = 'https://www.example.com/new/feed.xml'
 where slug = 'example-outlet';
```

No restart required; the worker re-reads the sources table on every cycle.

## 3.5 Fix a "duplicate source in cluster" report

```sql
-- Diagnose
select ca.cluster_id, a.source_id, count(*) as dupes
  from cluster_articles ca
  join articles a on a.id = ca.article_id
 group by ca.cluster_id, a.source_id
having count(*) > 1
 order by dupes desc;
```

Fix: re-run migration `013_dedupe_and_hygiene.sql` (it's idempotent).
Re-run the diagnostic query — it should return zero rows.

## 3.6 Tune the clustering ensemble

Edit `scripts/lib/cluster/constants.mjs`:

| Constant | Default | Effect |
|---|---|---|
| `MATCH_THRESHOLD` | `0.48` | Final score required to merge an article into a cluster. Lower = more recall, less precision. |
| `TIME_WINDOW_HOURS` | `48` | Articles older than this can never match. |
| `MIN_SHARED_ENTITIES` | `2` | Floor for entity-vote candidacy in `findCandidateClusters`. |
| `MINHASH_SOFT_ACCEPT_JACCARD` | `0.5` | Below this, the MinHash lane decays linearly. |
| `TFIDF_WEIGHT` / `ENTITY_WEIGHT` | `0.40` / `0.60` | Primary lane weights. Must sum to 1.0. |
| `MAX_CANDIDATE_CLUSTERS` | `20` | Hard cap on candidates scored per article. |
| `ENTITY_DENOM_MIN` | `3` | Noise floor for `shared / max(3, min(|A|,|B|))`. |

After editing, run §3.3 (recluster) and sample 50 random clusters:

```sql
select id, article_count, title_tr
  from clusters
 where article_count >= 3
 order by random()
 limit 50;
```

Open <http://localhost:3000/cluster/{id}> for each, judge precision and
recall, repeat.

## 3.7 Kill and restart a worker

```bash
tmux send-keys -t tayf-app:rss-worker C-c
tmux send-keys -t tayf-app:rss-worker 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node scripts/rss-worker.mjs' Enter
```

Each worker installs a graceful shutdown handler and finishes its
in-flight cycle before exiting (≤5s typical). `DRY_RUN=1` in front of
the command runs a single cycle for smoke testing.

## 3.8 Reset the whole DB (nuclear)

**Warning: this destroys every article, cluster, and image_url. Sources
will repopulate from the seed file; everything else has to re-ingest
from scratch.**

```bash
supabase db reset
ls supabase/migrations/*.sql | sort | xargs -I{} psql "$PSQL" -f {}
psql "$PSQL" -f supabase/seed_sources.sql
```

Then bounce the workers (§3.7) so they start with a clean seen-hash
cache.

## 3.9 VACUUM

When: after large deletes (the nuclear reset, big dedupe migrations, or
manually pruning stale clusters). Postgres' autovacuum does the routine
work; you only need to do this manually after a one-shot purge.

```bash
psql "$PSQL" -c 'vacuum (analyze, verbose) public.articles;'
psql "$PSQL" -c 'vacuum (analyze, verbose) public.clusters;'
psql "$PSQL" -c 'vacuum (analyze, verbose) public.cluster_articles;'
```

The `ANALYZE` half is the more important payoff — it refreshes the
planner stats so `/` and `/cluster/[id]` queries stay on the right
indexes.

## 3.10 Update a source's bias label

```sql
update sources set bias = 'opposition_leaning' where slug = 'example-outlet';
```

The change is picked up immediately by `rss-worker` for new articles,
but `clusters.bias_distribution` is computed at cluster-build time, so
existing clusters keep their old distribution until the next full
recluster (§3.3) recomputes them.

## 3.11 Log rotation

`team/status.log` and the per-worker logs under `team/logs/*.log` are
append-only. Without rotation they grow without bound.

**When**: whenever `team/status.log` exceeds ~1 MB, or once a day as
routine housekeeping.

**Command**: `bash scripts/rotate-logs.sh` (idempotent).

The script copies anything larger than 1024 KB to
`team/logs/archive/<name>-YYYYMMDD-HHMMSS.log`, **truncates in place**
with `: > file` (so any `tail -F` session keeps writing without missing
a beat — a `rm` + recreate would orphan their fds), gzips archives older
than 1 day, and deletes `*.log.gz` archives older than 30 days.

```cron
# rotate every day at 04:00
0 4 * * * cd /path/to/tayf && bash scripts/rotate-logs.sh >> team/logs/rotate.log 2>&1
```

---

# 4. Contributing

Welcome. This section is for someone making their first change to Tayf.

## Before you start

- Read `AGENTS.md` (or `CLAUDE.md`) — it explains that this is Next.js
  16 with breaking changes. Do not trust your training-data knowledge
  about Next.js. When in doubt, consult `node_modules/next/dist/docs/`.
- Read §1 (Architecture) above if you are touching the clustering or
  data pipeline.
- Read the root `README.md` for setup, env vars, and how to run the dev
  server.

## Code conventions

### TypeScript

- `strict` mode is on, including `noUncheckedIndexedAccess`. Index access
  returns `T | undefined` — handle it.
- No `any`. Use `unknown` plus narrowing where you genuinely don't know
  the shape.
- Every exported function needs an explicit return type.
- Prefer `type` for unions and intersections, `interface` for object
  shapes consumed by other modules.

### File organization

- Server Components by default. Do not add `"use client"` unless you
  need state, effects, or browser APIs.
- Data fetching happens in the Server Component itself, NOT in a `/api`
  route that the component then self-fetches. Self-fetching a route
  from the page that owns it is an antipattern here.
- Use `createServerClient` from `@/lib/supabase/server` for SSR queries.
- Wrap query functions in `unstable_cache` with a 30-second revalidation
  window unless you have a documented reason not to.
- Keep server-only modules out of client bundles. If a module imports
  `server-only`, do not import it from a client component.

### Styling

- Tailwind 4 with the `@theme` block in `src/app/globals.css`. Do not
  reintroduce a `tailwind.config.js`.
- shadcn primitives live in `src/components/ui/*`. Compose from these —
  do not fork them inline.
- The 3-zone Medya DNA palette (red / zinc / emerald) is canonical for
  member chips.
- The 10-hue bias palette is ONLY for the spectrum bar and the Medya DNA
  chip wall. Do not reuse it elsewhere.

### Workers (`scripts/*.mjs`)

- ESM only, Node 20.
- Always use the shared helpers in `scripts/lib/shared/`:
  `runtime.mjs` (env, log, signal, sleep), `supabase.mjs`,
  `circuit-breaker.mjs`, `pool.mjs`, `og-image.mjs`.
- Support `DRY_RUN=1` for a single-cycle test run with no writes.
- Always handle `SIGINT`/`SIGTERM` via `installShutdownHandler` from
  `runtime.mjs`. Workers must drain in-flight work, then exit cleanly.
- Append progress to `team/status.log` with a stable prefix, e.g.
  `HH:MM:SS CLUSTER: <msg>`.
- Clustering algorithm constants live in
  `scripts/lib/cluster/constants.mjs`. Tune there, not at call sites.

## Making a change

### 1. Understand the scope

Identify which layer you are touching:
- A UI tweak — `src/components/`, `src/app/`
- A data layer fix — `scripts/`, `supabase/` migrations
- An algorithm tuning — `scripts/lib/cluster/constants.mjs` and friends
- A shared lib — `src/lib/` (touching this affects many call sites; tread
  carefully)

### 2. Write the code

- Keep changes minimal. No drive-by refactors.
- Preserve all Turkish copy verbatim unless the change is explicitly to
  Turkish copy.
- Match the surrounding style. Do not reformat files you are not editing.

### 3. Verify locally

Run `bash scripts/check.sh` — it runs `tsc`, `eslint`, `node --check` on
every worker, the cluster lib self-tests, and Vitest.

If you touched a UI file, also `curl -I http://localhost:3000/<route>`
and confirm 200.

If you touched the clustering algorithm, run `node scripts/recluster.mjs`
and manually sample 50 clusters for sanity.

### 4. Measure impact

- Perf changes — capture before/after metrics: TTFB, worker cycle time,
  DB query milliseconds.
- Algorithm changes — sample precision and recall on a fixed set.
- UI changes — visual spot check on the affected route at desktop and
  mobile widths.

"I think it's faster" is not a measurement.

## What NOT to do

- Don't add TypeScript `any`.
- Don't use `NextResponse.json({ error: "..." })` directly — use
  `apiBadRequest()` / `apiServerError()` from `src/lib/api/errors.ts`.
- Don't add a Next.js API route just so a page can self-fetch it. Query
  Supabase directly in the Server Component.
- Don't break strict mode or `noUncheckedIndexedAccess`.
- Don't add a new UI library. Use shadcn primitives.
- Don't change `BIAS_LABELS`, `BIAS_ORDER`, or `BIAS_TO_ZONE` in
  `src/lib/bias/config.ts`. They are the single source of truth for
  many consumers downstream.
- Don't disable lint or type rules to make a build pass. Fix the
  underlying issue.
- Don't commit secrets. `.env.local` only — never `.env` checked in.

## When you're stuck

- Re-read `AGENTS.md`. Most surprises come from assuming Next.js 15
  behavior.
- Check `node_modules/next/dist/docs/` for the actual current API.
- Leave a note in `team/board.md` (gitignored) and move on rather than
  guessing.
