-- 027_cluster_link_atomic.sql
--
-- Round-6 audit P1 fix: serialize cluster_articles INSERT + clusters
-- recompute under a per-cluster advisory lock so two concurrent
-- cluster-consumer Edge Function invocations cannot:
--
--   1. Both INSERT the same article into the same cluster (caught by
--      the existing (cluster_id, article_id) PRIMARY KEY today, but
--      the lock means the INSERT no longer needs to race-then-fail).
--   2. Both read the member set as [A, B], INSERT [C] and [D] in
--      parallel, then both UPDATE clusters.article_count to 3 — the
--      pre-fix shape — leaving the row permanently undercounted.
--
-- The lock is `pg_advisory_xact_lock(hashtext(cluster_id::text))`,
-- which is released automatically at commit / rollback of the
-- containing transaction. Because this function IS the transaction
-- boundary on the consumer side, the lock holds for exactly the
-- duration we need it.
--
-- The cluster-consumer Edge Function calls this via
-- `supabase.rpc('cluster_link_atomic', {...})` from
-- supabase/functions/cluster-consumer/index.ts.

begin;

drop function if exists public.cluster_link_atomic(
  uuid, uuid, jsonb, boolean, text, timestamptz
);

create function public.cluster_link_atomic(
  p_cluster_id uuid,
  p_article_id uuid,
  p_bias_distribution jsonb,
  p_is_blindspot boolean,
  p_blindspot_side text,
  p_first_published timestamptz
) returns boolean
language plpgsql
security definer
-- Mirror the Round-6 P1 hardening on the migration-025 trigger
-- functions: empty search_path + schema-qualified identifiers so a
-- session role with CREATE on pg_temp cannot shadow an unqualified
-- call inside this SECURITY DEFINER body.
set search_path = ''
as $$
declare
  v_inserted_rows int;
  v_count int;
begin
  -- Per-cluster serialization. `hashtext` is stable enough that two
  -- requests for the same cluster_id always collide on the same lock
  -- key, and collisions between different cluster_ids only cost a
  -- transient wait — never correctness.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_cluster_id::text)
  );

  -- Idempotent link insert. ON CONFLICT DO NOTHING leans on the
  -- (cluster_id, article_id) PRIMARY KEY from migration 003.
  insert into public.cluster_articles (cluster_id, article_id)
       values (p_cluster_id, p_article_id)
  on conflict do nothing;
  get diagnostics v_inserted_rows = row_count;

  -- Recompute under the lock so this caller's COUNT(*) reflects the
  -- INSERT it just did (or that it skipped) without any race against
  -- another caller for the same cluster. A different cluster_id is
  -- on a different lock key and runs in parallel.
  select pg_catalog.count(*) into v_count
    from public.cluster_articles
   where cluster_id = p_cluster_id;

  -- updated_at is the consumer-liveness signal: /api/health reads
  -- MAX(clusters.updated_at) to decide whether the pipeline is alive.
  -- Stamp it with the wall clock of this write, never the member
  -- articles' max published_at — a republished old article would
  -- otherwise make a fresh write look stale.
  update public.clusters
     set article_count   = v_count,
         bias_distribution = p_bias_distribution,
         is_blindspot      = p_is_blindspot,
         blindspot_side    = p_blindspot_side,
         first_published   = p_first_published,
         updated_at        = pg_catalog.now()
   where id = p_cluster_id;

  return v_inserted_rows > 0;
end;
$$;

comment on function public.cluster_link_atomic(
  uuid, uuid, jsonb, boolean, text, timestamptz
) is
  'Atomic per-cluster cluster_articles insert + clusters recompute. '
  'Serialized via pg_advisory_xact_lock(hashtext(cluster_id::text)). '
  'Returns true if a new link was inserted, false if the article was '
  'already a member. Sets clusters.updated_at to now() — the '
  '/api/health liveness signal — not member published_at. Round-6 P1 '
  'fix for the concurrent cluster-write race; see '
  'docs/adr/001-worker-stream-system.md and migration 027.';

-- Service role calls this from the cluster-consumer Edge Function;
-- no anon / authenticated access is granted (the function reads + writes
-- gameplay tables that are already revoked from those roles). Supabase
-- auto-grants EXECUTE to anon + authenticated on creation, so naming them
-- explicitly here (alongside public) is required to actually close the
-- PostgREST /rest/v1/rpc/cluster_link_atomic exposure — revoking from
-- public alone does not strip the role-direct grants.
revoke execute on function public.cluster_link_atomic(
  uuid, uuid, jsonb, boolean, text, timestamptz
) from anon, authenticated, public;
grant execute on function public.cluster_link_atomic(
  uuid, uuid, jsonb, boolean, text, timestamptz
) to service_role;

commit;
