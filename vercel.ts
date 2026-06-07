import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project configuration (replaces `vercel.json`).
 *
 * Docs: https://vercel.com/docs/project-configuration/vercel-ts
 *
 * CRONS
 * -----
 * Ingestion, clustering and image backfill now run as an event-driven
 * stream out of Supabase: a pg_cron job pokes the `ingest` Edge Function,
 * an `AFTER INSERT ON articles` trigger fans work onto two `pgmq` queues
 * (`cluster_work`, `image_backfill`), and `pg_cron` drains them into the
 * co-located `cluster-consumer` and `image-consumer` Edge Functions. None
 * of those steps live on Vercel anymore.
 *
 * The single remaining Vercel cron is the neutral-headline rewriter:
 *
 *   - `/api/cron/headline` — Walks clusters that still lack
 *     `title_tr_neutral` and asks Claude Haiku for a tarafsız başlık.
 *     Stateless and bounded (5 clusters per tick) so LLM spend stays
 *     predictable and a transient Anthropic 5xx never blows a whole
 *     batch. Fail-closed against a missing `CRON_SECRET`. See
 *     `src/app/api/cron/headline/route.ts`.
 *
 * Full architecture in
 * `tayf-refactor/architecture/ADR-001-worker-stream-system.md`.
 */
const config: VercelConfig = {
  crons: [
    { path: "/api/cron/headline", schedule: "*/5 * * * *" },
  ],
};

export default config;
