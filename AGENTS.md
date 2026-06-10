<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Worker stream pattern

Tayf no longer uses long-running tmux workers. Ingestion, clustering, and image backfill run as an event-driven stream. A `pg_cron` `ingest-drain` job pokes the `ingest` Edge Function every 3 minutes; an `AFTER INSERT ON articles` trigger fans work onto two `pgmq` queues (`cluster_work`, `image_backfill`); parallel `pg_cron` `cluster-drain` (every minute) and `image-drain` (every 5 minutes) jobs drain those queues into the co-located `cluster-consumer` and `image-consumer` Edge Functions (Deno 2.x). The only Vercel cron in the new pipeline is `/api/cron/headline`, which writes neutral Turkish cluster titles via an LLM call. The ported worker libraries live in `supabase/functions/_shared/` (TypeScript/Deno); the legacy `scripts/*-worker.mjs` runners have been deleted, but the reference libraries under `scripts/lib/cluster/*.mjs` are intentionally retained because `tests/functions/_shared/cluster.test.ts` uses them as the golden-vector parity benchmark for the Deno port. Full design in [`docs/architecture.md`](docs/architecture.md) and [`docs/adr/001-worker-stream-system.md`](docs/adr/001-worker-stream-system.md); operator cutover steps in [`docs/runbook.md`](docs/runbook.md).
