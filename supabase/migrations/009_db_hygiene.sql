-- 009_db_hygiene.sql
--
-- DB hygiene migration following the benchmark findings (perf-1):
--   1. `clusters` heap is ~9.8 MB for ~2,010 live rows (≈ 5 KB/row on disk)
--      because migration 008 DELETEd ~5,949 rows and plain autovacuum only
--      marks the space reusable — it doesn't release it back to the OS.
--      VACUUM FULL rewrites the heap and reclaims the disk.
--   2. Re-ANALYZE post-migration tables so the planner has fresh stats.
--   3. Keep `idx_articles_politics_published` and `idx_articles_politics_unclustered`.
--      Despite their low historical scan counts, EXPLAIN shows the planner
--      DOES pick them over `idx_articles_category`:
--        - `idx_articles_politics_published` serves the politics feed
--          `ORDER BY published_at DESC LIMIT N` as an Index Scan, avoiding
--          a bitmap heap scan + sort on `idx_articles_category`.
--        - `idx_articles_politics_unclustered` enables an Index Only Scan
--          for the cluster worker's "fetch unclustered politics article ids"
--          hot path. Dropping either would regress those queries.
--
-- IMPORTANT: this file must NOT contain BEGIN/COMMIT because VACUUM (and
-- VACUUM FULL in particular) cannot run inside a transaction block. psql
-- executes each top-level statement in autocommit mode when no explicit
-- BEGIN is present, so plain back-to-back statements are safe.
--
-- Re-running this migration is safe: VACUUM / ANALYZE are idempotent and
-- no schema changes are made.

-- 1. Reclaim disk for the `clusters` heap. Takes an AccessExclusiveLock,
--    but at ~2,010 rows it finishes in milliseconds. If the cluster worker
--    is mid-write, lock_timeout makes us fail fast instead of blocking.
SET lock_timeout = '5s';

VACUUM (FULL, ANALYZE) public.clusters;

-- 2. Refresh planner stats on the high-churn tables from 008. Non-FULL
--    VACUUM also clears any lingering dead tuples and updates the
--    visibility map so Index Only Scans on partials stay efficient.
VACUUM (ANALYZE) public.articles;

VACUUM (ANALYZE) public.cluster_articles;

-- 3. Small tables: stats-only refresh.
ANALYZE public.sources;

ANALYZE public.story_stances;
