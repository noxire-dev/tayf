-- 019: Neutral LLM-rewritten cluster headlines (per A3 audit).
-- Preserves the original seed-inherited title for transparency while letting
-- the UI render a tone-neutralized version.

-- Add columns
alter table clusters
  add column if not exists title_tr_original text,
  add column if not exists title_tr_neutral text,
  add column if not exists title_neutral_at timestamptz;

-- Backfill: copy current title_tr → title_tr_original for any rows where it isn't set yet.
-- The current title_tr stays as-is until the rewrite worker runs and overwrites it
-- with title_tr_neutral.
update clusters set title_tr_original = title_tr where title_tr_original is null;

-- Index for the rewrite worker's "find clusters needing rewrite" query
create index if not exists idx_clusters_needs_rewrite on clusters (title_neutral_at)
  where title_neutral_at is null and article_count >= 3;

-- VACUUM ANALYZE to refresh planner stats
analyze clusters;
