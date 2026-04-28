import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project configuration (replaces `vercel.json`).
 *
 * Docs: https://vercel.com/docs/project-configuration/vercel-ts
 *
 * CRONS
 * -----
 * Two paths are scheduled, both following the same dual-path pattern:
 * a primary tmux worker (started via `scripts/dev.mjs`) plus a Vercel
 * cron fallback that no-ops when the tmux worker is alive.
 *
 *   - `/api/cron/ingest` — RSS ingestion fallback for `rss-worker.mjs`.
 *     Bails if the worker inserted anything in the last 30 seconds. See
 *     `src/app/api/cron/ingest/route.ts` for the full architecture note.
 *
 *   - `/api/cron/cluster` — Clustering fallback for `cluster-worker.mjs`.
 *     Bails if any cluster was created in the last 60 seconds. See
 *     `src/app/api/cron/cluster/route.ts`.
 *
 * Cluster runs every 3 minutes — slower than ingest because each cycle is
 * heavier (300s maxDuration on Pro) and the dual-path guard handles the
 * common case of "tmux is up". Three-minute spacing also keeps the cron's
 * own previous run well outside the 60s skip window.
 *
 * `/api/cron/backfill-images` intentionally has no cron schedule: it is a
 * manual-only endpoint triggered from the admin panel's "Kapak Resimleri"
 * button or ad-hoc curl.
 */
const config: VercelConfig = {
  crons: [
    { path: "/api/cron/ingest", schedule: "0,30 * * * *" },
    { path: "/api/cron/cluster", schedule: "*/3 * * * *" },
  ],
};

export default config;
