-- 014_query_perf.sql
--
-- Query-plan tuning follow-up to 013_dedupe_and_hygiene.sql.
--
-- Baseline profiling with EXPLAIN (ANALYZE, BUFFERS), median of 3 runs,
-- revealed two hot paths still missing an index and two indexes that
-- the app never actually uses. The measurements were taken after
-- migration 013 + VACUUM ANALYZE on a dataset of ~16.5k articles,
-- ~3.8k clusters, ~4.4k cluster_articles.
--
-- Findings:
--
--   Q1 (home politics list, clusters WHERE article_count >= 2
--       ORDER BY updated_at DESC LIMIT 60)
--     -> Index Scan on idx_clusters_updated_at, then discarded 534
--        rows via filter to produce 60. 675 buffer hits, ~0.95 ms.
--
--   Q6 (home badge, clusters WHERE article_count >= 2 AND
--       updated_at > now() - interval '7 days')
--     -> Seq Scan on clusters, 1036 buffer hits, ~2.14 ms. No index
--        combined article_count with updated_at, so the planner had
--        no other option.
--
--   Solution for Q1 + Q6: a single partial b-tree on
--   (updated_at DESC) WHERE article_count >= 2. Both queries already
--   express the same predicate so they share the index. Kept as a
--   partial index so it stays cheap to maintain (currently ~600 of
--   ~3800 cluster rows qualify, and that set is the only set the
--   home page ever asks about).
--
-- Indexes dropped as unused after the 013 dedupe migration:
--
--   idx_articles_entities (GIN on articles.entities, ~1.8 MB)
--     The cluster worker reads the entities column but builds its
--     own inverted index in JS (scripts/lib/cluster/entities.mjs) and
--     scores candidates in memory. No SQL query in the app uses the
--     `@>`, `&&`, or `<@` array operators on entities, so the GIN
--     index has had exactly 1 scan lifetime and cannot be reached by
--     any current code path. Safe to drop.
--
--   idx_clusters_is_blindspot (partial b-tree WHERE is_blindspot = true)
--     is_blindspot is always surfaced as a projected column; no
--     query ever filters on `is_blindspot = true`. The partial index
--     has had 1 scan lifetime. Safe to drop.
--
-- Indexes intentionally kept even though their scan counters look low:
--
--   idx_articles_politics_published (partial, used by Q5 image worker
--     and by the cluster worker unclustered fetch)
--   idx_articles_politics_unclustered (partial, used by the cluster
--     worker head+count query on politics)
--   idx_clusters_first_published (used by cluster recompute ordering)
--   idx_sources_bias (used by bias distribution aggregates)
--   idx_articles_fingerprint (used by the cluster worker fingerprint
--     lookup path)
--
-- Sections run in a single transaction, with ANALYZE statements
-- outside the transaction at the end (ANALYZE is fine inside txn
-- but running it at the bottom matches the layout of 013). No
-- VACUUM FULL: the locks are not worth the marginal gains.

begin;

-- 1) Add the composite partial index used by Q1 + Q6 ------------------------

create index if not exists idx_clusters_active_updated_at
  on clusters (updated_at desc)
  where article_count >= 2;

-- 2) Drop indexes confirmed unused by current app code ----------------------

drop index if exists idx_articles_entities;
drop index if exists idx_clusters_is_blindspot;

commit;

-- 3) Refresh planner statistics for affected tables -------------------------
analyze public.clusters;
analyze public.articles;
analyze public.cluster_articles;
analyze public.sources;
