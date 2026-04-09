-- 022_image_backfill_attempts.sql
--
-- Adds a per-row attempt counter for the og:image backfill worker
-- (scripts/image-worker.mjs) so that rows which have failed N times in a
-- row are escalated out of the active candidate pool instead of being
-- retried forever.
--
-- Background:
--   The wave-4 perf benchmark (team/logs/quality/v4-perf.md) found that
--   IMAGE-CYCLE retries the same ~70 articles every 120s, burning ~8.6
--   min/hr for 0 results. With migration 015 the worker rotates by
--   image_backfill_attempted_at NULLS FIRST, but for sources that simply
--   don't expose og:image (and aren't on the SKIP_SOURCES blocklist
--   because their slug isn't known to the audit) the rows just cycle
--   forever — every attempt bumps attempted_at to "now", so all 70 sit
--   together at the back of the rotation, then come right back to the
--   front when the 24h stale-reset (RESET_STALE_AGE_MS) re-NULLs them.
--
-- Fix:
--   Track the number of consecutive failed attempts on each row. The
--   worker increments image_backfill_attempts after every "not found"
--   or "errored" outcome. Once a row reaches IMG_BACKFILL_MAX_ATTEMPTS
--   (5), the worker pushes its image_backfill_attempted_at 7 days into
--   the future, taking it out of the rotation until it ages back in.
--   On a successful fetch image_backfill_attempts is reset to 0 (the
--   row is also no longer image_url IS NULL, so it leaves the pool
--   anyway, but resetting keeps the column accurate for any future
--   re-clear).
--
-- Schema changes:
--   1. Add column articles.image_backfill_attempts int NOT NULL DEFAULT 0.
--      Existing rows backfill to 0 (the worker has no prior attempt
--      history to reconstruct, and 0 is the correct "fresh" starting
--      value — they'll get up to 5 more retries before being parked).
--
-- Idempotency:
--   ADD COLUMN IF NOT EXISTS makes this re-runnable.
--
-- Note: no new index. The column is read/written by id, never used as a
-- query predicate — escalation is enforced by writing a future
-- image_backfill_attempted_at, which the existing
-- idx_articles_image_backfill_attempted partial index already covers.

begin;

alter table articles
  add column if not exists image_backfill_attempts int not null default 0;

commit;

analyze public.articles;
