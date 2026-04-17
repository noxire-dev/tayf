import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project configuration (replaces `vercel.json`).
 *
 * Docs: https://vercel.com/docs/project-configuration/vercel-ts
 *
 * CRONS
 * -----
 * Only `/api/cron/ingest` is scheduled. See
 * `src/app/api/cron/ingest/route.ts` for the full dual-path explanation —
 * the tmux `rss-worker.mjs` (started via `scripts/dev.mjs`) is the primary
 * ingestion path, and this cron is a hosted-deploy fallback that bails if
 * the worker inserted anything in the last 30 seconds.
 *
 * `/api/cron/backfill-images` intentionally has no cron schedule: it is a
 * manual-only endpoint triggered from the admin panel's "Kapak Resimleri"
 * button or ad-hoc curl.
 */
const config: VercelConfig = {
  crons: [
    { path: "/api/cron/ingest", schedule: "0,30 * * * *" },
  ],
};

export default config;
