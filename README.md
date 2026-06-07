# Tayf — Turkish News Bias Analysis

> Aynı haber, farklı dünyalar. Ground News for Turkey.

![Next.js 16](https://img.shields.io/badge/Next.js-16-black) ![React 19](https://img.shields.io/badge/React-19-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e) ![Tailwind 4](https://img.shields.io/badge/Tailwind-4-38bdf8)

## What is Tayf?

Tayf (Turkish for "spectrum") is a real-time Turkish news media bias analyzer. It continuously ingests RSS feeds from **144 Turkish news outlets** spanning the full political spectrum, clusters articles that cover the same story using a 3-method ensemble, and shows you how pro-government, opposition, nationalist, Kurdish, Islamist-conservative, state-media, and international outlets each frame the same event. Cards lead with a bias-distribution bar instead of a logo grid, "blindspots" call out stories covered by only one side, and a cross-spectrum surprise detector flags the editorially-interesting moments when an outlet breaks ranks with its bias bucket.

## Tech stack

- **Frontend:** Next.js 16 App Router (`src/app/`), React 19, Tailwind CSS 4 with OkLCh tokens, shadcn/ui + base-ui primitives, Lucide icons
- **Backend:** Supabase (Postgres + pgmq queues + Edge Functions on Deno 2.x), Vercel cron triggers, event-driven worker stream — no long-running workers
- **Clustering:** 3-method ensemble — Turkish character-4-gram fingerprint, TF-IDF cosine over a 48h window, and entity-overlap heuristic — executed inside the `cluster-consumer` Edge Function (`supabase/functions/_shared/cluster/`)
- **Ingestion:** Vercel cron pings the `ingest` Edge Function every 3 minutes; charset-aware RSS fan-out, ETag/If-Modified-Since caching, bounded concurrency, og:image backfill via a separate pgmq-driven consumer
- **Bias model:** 10 source-level bias categories (`src/lib/bias/config.ts`) rolled up to 3 Medya DNA zones (`src/lib/bias/zones.ts`)

## Worker stream architecture

Tayf no longer runs long-lived Node workers. The new pipeline is an event-driven stream built entirely from Vercel and Supabase primitives:

- **Vercel cron** `/api/cron/ingest` (every 3 min) invokes the **`ingest` Edge Function**, which fans out across the 144 RSS sources, normalizes items (charset-aware), and upserts into `articles`.
- An **`AFTER INSERT` trigger** on `articles` enqueues each new politics article onto the **pgmq `cluster_work`** queue. New articles with `image_url IS NULL` are also enqueued onto **`image_backfill`**.
- **pg_cron** schedules drain the queues by invoking the **`cluster-consumer`** and **`image-consumer`** Edge Functions co-located with the database. Per-message visibility timeouts give at-least-once semantics; archival happens on success, permanent failures (>3 reads) are dropped.
- **Vercel cron** `/api/cron/headline` (every 5 min) generates neutral Turkish titles for any cluster still missing one.

```
   144 RSS feeds ─▶  Vercel cron /api/cron/ingest  ─▶  Edge Function: ingest
                                                              │
                                                              ▼
                                                   Postgres: articles
                                                              │
                                       AFTER INSERT trigger ─▶ pgmq: cluster_work, image_backfill
                                                              │
                                                pg_cron ─▶ Edge Functions: cluster-consumer, image-consumer
                                                              │
                                                              ▼
                                                clusters / cluster_articles
                                                              │
                                              Vercel cron ─▶ /api/cron/headline (title_tr_neutral)
                                                              │
                                                              ▼
                                              Next.js 16 App Router (/, /cluster/[id], /admin)
```

Full design rationale, alternatives considered, and migration plan: [`tayf-refactor/architecture/ADR-001-worker-stream-system.md`](../tayf-refactor/architecture/ADR-001-worker-stream-system.md).

## Local development

### Prerequisites

- **Node.js 24+**
- **Docker** (for local Supabase)
- **`supabase` CLI** ([install](https://supabase.com/docs/guides/cli))

### Setup

1. Clone the repo and `cd tayf`
2. `npm install`
3. `supabase start` — boots local Postgres + API + Studio (Studio at http://127.0.0.1:54323)
4. Apply migrations:
   ```bash
   ls supabase/migrations/*.sql | sort | xargs -I{} \
     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f {}
   ```
5. Seed sources (144 outlets, full bias taxonomy):
   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -f supabase/seed_sources.sql
   ```
6. `cp .env.local.example .env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (printed by `supabase start`)
7. `npm run dev`
8. Open http://localhost:3000

### Running the worker stream

There are no long-running local workers. The full pipeline runs on Vercel cron + Supabase Edge Functions + pgmq once the migrations and functions are deployed:

| Trigger | Surface | Purpose |
|---|---|---|
| Vercel cron (`*/3 * * * *`) | `/api/cron/ingest` → Edge Function `ingest` | RSS fan-out, charset-aware normalize, upsert articles |
| pg_cron (`* * * * *`) | Edge Function `cluster-consumer` | Drains `cluster_work` pgmq, runs the 3-method ensemble, upserts clusters |
| pg_cron (`*/5 * * * *`) | Edge Function `image-consumer` | Drains `image_backfill` pgmq, SSRF-safe og:image backfill |
| Vercel cron (`*/5 * * * *`) | `/api/cron/headline` | LLM-generates neutral Turkish title for new clusters |

To exercise the pipeline locally: run `supabase start`, apply migrations through `026`, deploy the Edge Functions with `supabase functions serve`, and hit the cron routes directly with `curl` and a `CRON_SECRET` bearer. See [`docs/migration-guide.md`](docs/migration-guide.md) and [`tayf-refactor/architecture/ADR-001-worker-stream-system.md`](../tayf-refactor/architecture/ADR-001-worker-stream-system.md) for the full operator runbook.

## Routes

- **`/`** — home; real-time political clusters grouped by story (`src/app/page.tsx`). Cards lead with bias-distribution bar + source count + blindspot pill.
- **`/cluster/[id]`** — single story with hero, bias spectrum, `ClusterStance` (who-is-in-this-story by zone), `MediaDna` (all 144 outlets, this story's participants highlighted), and a `CrossSpectrumCaption` when an outlet breaks ranks (`src/app/cluster/[id]/page.tsx`).
- **`/admin`** — dev tools: live stats, source CRUD, manual ingest/backfill triggers, nuke actions (`src/app/admin/page.tsx`).

## Database schema

| Table | Purpose |
|---|---|
| `sources` | The 144 outlets — name, slug, url, rss_url, `bias` (10-value check), `logo_url`, `active` |
| `articles` | Normalized RSS items — title, url, image_url, published_at, content_hash, category, fingerprint/entities for clustering |
| `clusters` | A grouped story — title_tr, summary_tr, `bias_distribution` jsonb, `is_blindspot`, `article_count` |
| `cluster_articles` | M:N join between `clusters` and `articles` (with a per-source dedupe guard) |
| `stories` | Hand-curated demo stories (migration 006, optional) |
| `story_stances` | Per-outlet stance overrides for hand-curated stories |

Migration files in `supabase/migrations/`:

- `001_create_sources.sql` — `sources` table, 10-value bias check constraint
- `002_create_articles.sql` — `articles` table, FK to sources, base indexes
- `003_create_clusters.sql` — `clusters` + `cluster_articles` tables
- `004_add_article_category.sql` — adds `category` column to articles
- `005_expand_bias_categories.sql` — bias check 3 → 10 values, migrates `independent` → `center`
- `006_create_stories_and_stances.sql` — hand-curated stories tables (optional)
- `007_clustering_columns.sql` — adds fingerprint/entities columns for ensemble clustering
- `008_politics_cleanup.sql` — politics-scoped partial indexes + cleanup of non-political clusters
- `009_db_hygiene.sql` — index hygiene from perf baseline findings
- `011_source_logos.sql` — populates `sources.logo_url` via Google S2 favicon service
- `012_fix_relative_urls.sql` — prefixes relative article/image URLs with source base url
- `013_dedupe_and_hygiene.sql` — `(source_id, content_hash)` UNIQUE + dedupe backfill
- `014_query_perf.sql` — anti-join index for politics list, drops dead indexes
- `015_image_attempted_at.sql` — adds `image_backfill_attempted_at` for worker rotation
- `016_unify_content_hash.sql` — unifies sha1/sha256 cross-regime content_hash twins
- `024_pgmq_setup.sql` — installs `pgmq`, creates `cluster_work` + `image_backfill` queues, `worker_checkpoint` table, `worker_metrics` view
- `025_worker_triggers.sql` — `AFTER INSERT` triggers on `articles` that enqueue cluster/image work
- `026_unify_content_hash_v2.sql` — backfills any sha256 hashes to the canonical sha1-of-shingles form + `CHECK (length(content_hash) = 40)`

## Key files

- `src/lib/bias/config.ts` — single source of truth for the 10 bias categories (labels, colors, spectrum order)
- `src/lib/bias/zones.ts` — 10-bias → 3-zone (Hükümet / Bağımsız / Muhalefet) Medya DNA mapping
- `src/lib/bias/cross-spectrum.ts` — surprise detector ("opposition outlet ran with the government framing")
- `src/lib/clusters/cluster-detail-query.ts` / `politics-query.ts` — cached data layer with server-side dedupe
- `supabase/functions/ingest/` — RSS fan-out + normalize + upsert (charset-aware)
- `supabase/functions/cluster-consumer/` — pgmq drainer that runs the 3-method ensemble and upserts clusters
- `supabase/functions/image-consumer/` — pgmq drainer that backfills `og:image` with SSRF guards
- `supabase/functions/_shared/cluster/{fingerprint,entities,tfidf,ensemble,constants}.ts` — TypeScript port of the clustering libraries
- `supabase/functions/_shared/{supabase,pgmq,og-image,safe-fetch}.ts` — shared Edge Function primitives
- `src/app/api/cron/headline/route.ts` — Vercel cron handler that fills in neutral Turkish cluster titles

## Contributing

Read `AGENTS.md` first — **this is not stock Next.js**. The repo runs Next 16 + React 19, several App Router conventions have shifted (dynamic-route `params` is a `Promise` and must be awaited, `unstable_cache` shape changed, etc.). The project ships with a strict tsconfig (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`); `npm run lint` and `tsc` should both come back clean.

For codebase context including DB state, type system, ingestion flow, and the full file map, see `team/context.md`. UI conventions live in `team/style-guide.md`.

## License

TBD.
