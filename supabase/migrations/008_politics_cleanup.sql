-- 008_politics_cleanup.sql
--
-- Cleanup migration: prior to the politics filter being added to the cluster
-- worker (refactor-C), clusters were built over ALL articles. Most of those
-- rows are non-political dead data that slow down queries.
--
-- This migration:
--   1. Adds two partial indexes on `articles` scoped to political categories
--      to speed up worker + feed queries.
--   2. Deletes cluster_articles rows whose parent article is non-political.
--   3. Deletes clusters left orphaned (no remaining cluster_articles).
--   4. Recomputes `article_count` and `bias_distribution` on surviving clusters
--      from the current membership in cluster_articles.
--
-- Non-destructive wrt schema: no tables are dropped. Idempotent-ish: indexes
-- use IF NOT EXISTS; deletes / recomputes are safe to re-run (they would just
-- become no-ops once the worker is running with the politics filter).

begin;

-- 1. Partial indexes for perf ---------------------------------------------------------

create index if not exists idx_articles_politics_published
  on articles (published_at desc)
  where category in ('politika', 'son_dakika');

create index if not exists idx_articles_politics_unclustered
  on articles (id)
  where category in ('politika', 'son_dakika');

-- 2. Drop non-political cluster memberships -------------------------------------------

delete from cluster_articles
where article_id in (
  select id
  from articles
  where category not in ('politika', 'son_dakika')
);

-- 3. Drop clusters that are now empty -------------------------------------------------

delete from clusters
where id not in (
  select distinct cluster_id
  from cluster_articles
);

-- 4. Recompute article_count + bias_distribution on surviving clusters ----------------

update clusters c set
  article_count = sub.cnt,
  bias_distribution = sub.dist,
  updated_at = now()
from (
  select
    bb.cluster_id,
    sum(bb.bias_count)::int as cnt,
    jsonb_object_agg(bb.bias, bb.bias_count) as dist
  from (
    select
      ca.cluster_id,
      s.bias,
      count(*)::int as bias_count
    from cluster_articles ca
    join articles a on a.id = ca.article_id
    join sources s on s.id = a.source_id
    group by ca.cluster_id, s.bias
  ) bb
  group by bb.cluster_id
) sub
where c.id = sub.cluster_id;

commit;
