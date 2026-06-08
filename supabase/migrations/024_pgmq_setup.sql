-- 024_pgmq_setup.sql
--
-- Stand up the pgmq-based worker stream system (see
-- docs/adr/001-worker-stream-system.md). This migration owns ONLY
-- the queue plumbing and access control; the per-table INSERT/UPDATE
-- triggers that enqueue work live in 025_worker_triggers.sql and the
-- content_hash unification in 026_unify_content_hash_v2.sql.
--
-- What this installs:
--   1. The pgmq extension (Supabase ships it pre-built; CASCADE pulls in
--      pg_partman, pgcrypto, etc. as needed).
--   2. Two durable message queues:
--        - cluster_work     : one message per newly-ingested article;
--                             drained by the cluster-consumer Edge Function
--                             on a pg_cron */1 schedule.
--        - image_backfill   : one message per article whose image_url is
--                             still NULL; drained by the image-consumer
--                             Edge Function on a pg_cron */5 schedule.
--      pgmq.create() builds both the live (pgmq.q_<name>) and the archive
--      (pgmq.a_<name>) tables and is a NOTICE-emitting no-op if the queue
--      already exists, so this migration is safe to re-run.
--   3. (deleted in Round-6 P1) The original migration also created a
--      worker_checkpoint table as a safety-net resume marker for a
--      Vercel-cron fallback consumer (R5 in ADR-001). Nothing wired it,
--      so it shipped as dead schema — removed here. Migration 028 will
--      drop the table on databases that already applied the original
--      024 if any are deployed.
--   4. A worker_metrics view that exposes the pgmq.metrics_all() output
--      filtered to tayf's two queues. /api/health and /api/metrics read
--      this view without needing the raw pgmq schema grants — which lets
--      us keep pgmq.* locked down to service_role.
--
-- Access model:
--   - pgmq.send / read / delete / archive are revoked from anon and
--     authenticated. Only service_role (used by Edge Functions and by
--     the Next.js API routes via createServerClient) can enqueue or
--     dequeue. The trigger in 025 runs as table owner and bypasses this
--     check by design.
--   - worker_metrics is a view; service_role can read it. We do NOT
--     grant it to anon/authenticated because queue depths are operational
--     data, not public.
--
-- Idempotency:
--   - CREATE EXTENSION IF NOT EXISTS — safe.
--   - pgmq.create — internal IF NOT EXISTS, safe.
--   - REVOKE / GRANT are declarative — safe to re-run.
--   - CREATE OR REPLACE VIEW worker_metrics — safe.

begin;

-- 1. Extension. CASCADE so any prerequisite extensions (pgmq depends on
-- pg_partman on newer builds) get pulled in transparently.
create extension if not exists pgmq cascade;

-- 2. Queues. pgmq.create raises a NOTICE if the queue already exists and
-- is otherwise a no-op, so wrapping in a DO block here is purely cosmetic
-- — but it also lets us guard against an older pgmq build where create
-- might have raised. The IF NOT EXISTS-style check is portable.
do $$
begin
  if not exists (
    select 1 from pgmq.list_queues() q where q.queue_name = 'cluster_work'
  ) then
    perform pgmq.create('cluster_work');
  end if;

  if not exists (
    select 1 from pgmq.list_queues() q where q.queue_name = 'image_backfill'
  ) then
    perform pgmq.create('image_backfill');
  end if;
end
$$;

-- 3. (Removed) worker_checkpoint — Round-6 P1 cleanup.
--
-- The original migration created a public.worker_checkpoint table as a
-- safety-net resume marker for a Vercel-cron fallback consumer (the R5
-- variant in ADR-001). That fallback path was never wired and no
-- consumer ever wrote to the table — the happy-path Edge Function
-- consumers rely entirely on pgmq archive semantics. Shipping a table
-- whose documented semantics nothing implements is worse than no table,
-- so the worker_checkpoint table, its updated_at trigger, and the
-- supporting trigger function are removed here. If a fallback path is
-- ever needed, a follow-up migration can reintroduce the table with
-- the timestamptz cursor (last_seen_created_at) that the R3 follow-up
-- in ADR-001 §6 suggested.
--
-- The migration is otherwise idempotent — applying it on an existing
-- database that DID create worker_checkpoint will leave the table in
-- place (no destructive change here). A separate cleanup migration can
-- handle drop-if-exists once the branch has been deployed.

-- 4. Lock pgmq surface area to service_role.
-- Revoke first (idempotent), then grant. We revoke from PUBLIC as well to
-- close the default-privilege gap on the pgmq schema usage.
revoke all on schema pgmq from public, anon, authenticated;
grant usage on schema pgmq to service_role;

revoke all on all tables    in schema pgmq from public, anon, authenticated;
revoke all on all sequences in schema pgmq from public, anon, authenticated;
revoke all on all functions in schema pgmq from public, anon, authenticated;

-- The four functions tayf actually calls. Granting EXECUTE on each
-- signature individually is more surgical than GRANT ALL ON ALL FUNCTIONS
-- because pgmq ships internal helpers we don't want exposed.
--   pgmq.send(queue_name text, msg jsonb)                      -> bigint
--   pgmq.send(queue_name text, msg jsonb, delay integer)       -> bigint
--   pgmq.read(queue_name text, vt integer, qty integer)        -> setof pgmq.message_record
--   pgmq.delete(queue_name text, msg_id bigint)                -> boolean
--   pgmq.delete(queue_name text, msg_ids bigint[])             -> setof bigint
--   pgmq.archive(queue_name text, msg_id bigint)               -> boolean
--   pgmq.archive(queue_name text, msg_ids bigint[])            -> setof bigint
-- Granting EXECUTE on all overloads of each name keeps us forward
-- compatible with minor pgmq version drift.
do $$
declare
  fn_oid oid;
begin
  for fn_oid in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pgmq'
      and p.proname in ('send', 'read', 'delete', 'archive', 'metrics', 'metrics_all', 'list_queues')
  loop
    execute format(
      'grant execute on function %s to service_role',
      fn_oid::regprocedure
    );
  end loop;
end
$$;

-- 5. Filtered metrics view — exposes only tayf's two queues so that
-- /api/health and /api/metrics can read queue depth without needing
-- direct pgmq schema access.
create or replace view public.worker_metrics as
  select
    queue_name,
    queue_length,
    newest_msg_age_sec,
    oldest_msg_age_sec,
    total_messages,
    scrape_time
  from pgmq.metrics_all()
  where queue_name in ('cluster_work', 'image_backfill');

comment on view public.worker_metrics is
  'pgmq queue depth + age, filtered to tayf queues. Read by '
  '/api/health (alerts when queue_length or oldest_msg_age_sec grows '
  'monotonically beyond the threshold defined in B8). Granting select '
  'on this view to service_role only — queue metrics are operational '
  'data, not public.';

-- Strip anon/authenticated even though the view inherits the underlying
-- pgmq.metrics_all() execute privilege, which we already locked down.
revoke all on public.worker_metrics from public, anon, authenticated;
grant select on public.worker_metrics to service_role;

commit;
