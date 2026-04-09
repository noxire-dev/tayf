-- 013_dedupe_and_hygiene.sql
--
-- Schema hardening migration. Cleans up two stacked dedupe debts the
-- ingest + cluster pipeline has been accumulating, then garbage-collects
-- five never-scanned indexes flagged in the wave-1 perf baseline.
--
-- Sections:
--   1. Dedupe `cluster_articles`: keep one row per (cluster_id, source_id),
--      preferring the earliest article (oldest published_at, lowest id).
--   2. Recompute `clusters.article_count` and `clusters.bias_distribution`
--      from the surviving membership in `cluster_articles`.
--   3. Pre-delete `articles` rows that would violate the new
--      `(source_id, content_hash) UNIQUE` constraint, keeping the oldest
--      `created_at` per (source_id, content_hash) group.
--   3b. Re-run the cluster recompute in case section 3 dropped any
--       member rows via cascade.
--   4. Add the `(source_id, content_hash) UNIQUE` constraint.
--   5. Drop five unused indexes the wave-1 baseline saw with zero scans.
--   6. VACUUM (ANALYZE) the affected tables.
--
-- Sections 1-5 run inside a single explicit transaction so a partial
-- failure rolls back cleanly. Section 6 runs OUTSIDE any transaction
-- because VACUUM cannot run inside a transaction block. psql in
-- ON_ERROR_STOP=1 mode executes each top-level statement in autocommit
-- after the COMMIT, so the trailing VACUUM statements are valid.
--
-- Idempotency:
--   - Sections 1, 2, 3, 3b are no-ops on re-run once the data is clean.
--   - Section 4 uses `drop constraint if exists` before adding.
--   - Section 5 uses `drop index if exists`.
--   - Section 6 is always safe to re-run.

begin;

-- 1) Delete duplicate cluster_articles rows ----------------------------------
--    Keep the earliest article per (cluster_id, source_id) pair. Tie-break
--    by article_id so the result is fully deterministic.

with ranked as (
  select ca.cluster_id,
         ca.article_id,
         a.source_id,
         row_number() over (
           partition by ca.cluster_id, a.source_id
           order by a.published_at asc nulls last, a.id asc
         ) as rn
  from cluster_articles ca
  join articles a on a.id = ca.article_id
),
losers as (
  select cluster_id, article_id from ranked where rn > 1
)
delete from cluster_articles ca
using losers l
where ca.cluster_id = l.cluster_id
  and ca.article_id = l.article_id;

-- 2) Recompute article_count + bias_distribution -----------------------------
--    Mirrors the pattern from migration 008.

update clusters c set
  article_count = sub.cnt,
  bias_distribution = sub.dist,
  updated_at = now()
from (
  select bb.cluster_id,
         sum(bb.bias_count)::int as cnt,
         jsonb_object_agg(bb.bias, bb.bias_count) as dist
  from (
    select ca.cluster_id,
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

-- 3) Pre-delete article duplicates that would violate the new unique key ----
--    Keep the oldest `created_at` per (source_id, content_hash) group.
--    Tie-break on id so the choice is deterministic.

with ranked as (
  select id,
         source_id,
         content_hash,
         row_number() over (
           partition by source_id, content_hash
           order by created_at asc nulls last, id asc
         ) as rn
  from articles
  where content_hash is not null
),
losers as (
  select id from ranked where rn > 1
)
delete from articles a
using losers l
where a.id = l.id;

-- 3b) Re-run the cluster recompute. Cheap and keeps article_count +
--     bias_distribution truthful if section 3 cascaded any deletes.

update clusters c set
  article_count = sub.cnt,
  bias_distribution = sub.dist,
  updated_at = now()
from (
  select bb.cluster_id,
         sum(bb.bias_count)::int as cnt,
         jsonb_object_agg(bb.bias, bb.bias_count) as dist
  from (
    select ca.cluster_id,
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

-- 4) Add the (source_id, content_hash) UNIQUE constraint --------------------

alter table articles
  drop constraint if exists articles_source_content_hash_key;

alter table articles
  add constraint articles_source_content_hash_key
  unique (source_id, content_hash);

-- 5) Drop the five never-scanned indexes flagged in perf-baseline.md --------

drop index if exists idx_story_stances_story_id;
drop index if exists idx_story_stances_source_id;
drop index if exists idx_stories_display_order;
drop index if exists idx_sources_active;
drop index if exists idx_articles_content_hash;

commit;

-- 6) VACUUM (ANALYZE) -- one statement per table; outside any txn -----------
vacuum (analyze) public.clusters;
vacuum (analyze) public.cluster_articles;
vacuum (analyze) public.articles;
