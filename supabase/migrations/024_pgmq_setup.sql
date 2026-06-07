-- 024_pgmq_setup.sql
--
-- Stand up the pgmq-based worker stream system (see
-- architecture/ADR-001-worker-stream-system.md). This migration owns ONLY
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
--   3. A small worker_checkpoint table for safety-net consumer modes and
--      for observability ("last article id the consumer acked"). The
--      Edge Function consumers use pgmq's own visibility-timeout +
--      archive semantics for the happy path; this table only exists so a
--      Vercel-cron-based fallback consumer (R5 in ADR-001) could resume
--      where the Edge Function left off if pgmq had to be drained
--      manually.
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
--   - worker_checkpoint has RLS enabled with no policies — service_role
--     bypasses RLS, anon/authenticated are denied. This matches the
--     pattern set up in 017_rls_policies.sql.
--   - worker_metrics is a view; service_role can read it. We do NOT
--     grant it to anon/authenticated because queue depths are operational
--     data, not public.
--
-- Idempotency:
--   - CREATE EXTENSION IF NOT EXISTS — safe.
--   - pgmq.create — internal IF NOT EXISTS, safe.
--   - CREATE TABLE IF NOT EXISTS worker_checkpoint — safe.
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

-- 3. worker_checkpoint table — observability + safety-net resume marker.
--
-- Schema note (Round-2 fix): articles.id is uuid (see 002_create_articles.sql),
-- so the resume marker must store a uuid, not a bigint. We rename the column
-- to last_seen_article_id for clarity and type it as uuid; it is nullable
-- because a freshly-installed consumer row legitimately has no prior ack.
-- If a timestamptz cursor is preferred later (ordering by articles.created_at
-- is the more natural pattern for "resume from where we left off"), add a
-- second column last_seen_created_at in a follow-up migration — both shapes
-- are forward-compatible with the safety-net (R5) consumer described in
-- ADR-001.
create table if not exists public.worker_checkpoint (
  name                  text        primary key,
  last_seen_article_id  uuid,
  updated_at            timestamptz not null default now()
);

comment on table public.worker_checkpoint is
  'Resume markers for worker consumers. Each row is one logical consumer '
  '(e.g. cluster-consumer, image-consumer); last_seen_article_id stores the '
  'highest articles.id (uuid) the consumer has acked. Read by the safety-net '
  'Vercel cron paths (R5 in ADR-001) and exposed via /api/health for '
  'liveness checks. The happy-path Edge Function consumers do not write '
  'here — they rely on pgmq archive semantics — so a stale row here is '
  'not a fault.';

comment on column public.worker_checkpoint.name is
  'Logical consumer identifier (e.g. "cluster-consumer", "image-consumer").';
comment on column public.worker_checkpoint.last_seen_article_id is
  'Highest articles.id (uuid) the named consumer has acked. Nullable: a '
  'freshly-installed consumer has no prior ack.';
comment on column public.worker_checkpoint.updated_at is
  'Wall-clock timestamp of the last checkpoint write. Liveness signal.';

alter table public.worker_checkpoint enable row level security;

-- No policies — service_role bypasses RLS, anon/authenticated are denied.
-- Matches the pattern from 017_rls_policies.sql.

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
