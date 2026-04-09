-- 015_image_attempted_at.sql
--
-- Adds a "last attempted" timestamp column for the og:image backfill worker
-- (scripts/image-worker.mjs) so it can rotate through the backlog of
-- image-less politics articles instead of re-picking the newest 50 every
-- cycle.
--
-- Background:
--   The wave-1 perf baseline (team/logs/perf-baseline.md, section 5.3) flagged
--   the image worker as the single biggest observability red flag in the
--   system: ~0.2% found-rate, picking the same 50 newest null-image rows on
--   every cycle and almost always coming back empty because the top-of-list
--   sources (haberler-com, cnn-turk, anadolu-ajansi, trt-haber) have zero
--   og:image presence according to img-1's source-level audit
--   (team/logs/image-audit.md, section 3b).
--
-- Fix:
--   Track the last attempt time on each row. The worker orders candidates
--   by image_backfill_attempted_at NULLS FIRST so unattempted rows get
--   processed first, then the worker rotates through the tail by attempted
--   age. The column is bumped after every attempt regardless of outcome,
--   which means the worker drains the backlog instead of looping on the
--   same head.
--
-- Schema changes:
--   1. Add column articles.image_backfill_attempted_at timestamptz NULL
--      (default NULL so existing rows sort first under NULLS FIRST).
--   2. Add a partial index on (image_backfill_attempted_at NULLS FIRST)
--      scoped to image_url IS NULL AND politics categories — that's the
--      exact predicate the worker query uses, so the index lets the
--      planner avoid a full sort over the 982-row null-set on every cycle.
--
-- Idempotency:
--   ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS make this
--   re-runnable without errors.
--
-- No data backfill: NULL == "never attempted", which is what the worker
-- needs to bias unattempted rows to the front of the queue.

begin;

alter table articles
  add column if not exists image_backfill_attempted_at timestamptz;

create index if not exists idx_articles_image_backfill_attempted
  on articles (image_backfill_attempted_at nulls first)
  where image_url is null
    and category in ('politika', 'son_dakika');

commit;

analyze public.articles;
