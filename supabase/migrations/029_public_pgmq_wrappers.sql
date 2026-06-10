-- 029_public_pgmq_wrappers.sql
--
-- Production cutover fix. The Edge Function consumers reach pgmq through the
-- service-role supabase-js client, which routes through PostgREST — and
-- PostgREST only sees the `public` schema. The `pgmq` schema is deliberately
-- NOT exposed (the Round-6 audit flagged pgmq-over-PostgREST as a standing
-- leak risk). So `client.schema('pgmq').rpc('read', ...)` returned nothing and
-- the consumers drained zero messages.
--
-- Rather than expose pgmq (which would also affect the other apps sharing this
-- database), we proxy the handful of pgmq functions the consumers call through
-- public SECURITY DEFINER shims. EXECUTE on each shim is granted to
-- service_role only and revoked from anon / authenticated / public, so the
-- queue surface stays locked down. `_shared/pgmq.ts` calls these via
-- `client.rpc('pgmq_<fn>', ...)`; the shim parameter names match the client's
-- argument object.
--
-- search_path is locked to '' and every identifier is schema-qualified so a
-- pg_temp shadow cannot reach the SECURITY DEFINER body (same hardening as the
-- migration-025 trigger functions).

begin;

create or replace function public.pgmq_read_msgs(queue_name text, vt int, qty int)
returns setof pgmq.message_record
language sql security definer set search_path = ''
as $$ select * from pgmq.read(queue_name, vt, qty); $$;

create or replace function public.pgmq_archive_msg(queue_name text, msg_id bigint)
returns boolean
language sql security definer set search_path = ''
as $$ select pgmq.archive(queue_name, msg_id); $$;

create or replace function public.pgmq_delete_msg(queue_name text, msg_id bigint)
returns boolean
language sql security definer set search_path = ''
as $$ select pgmq.delete(queue_name, msg_id); $$;

create or replace function public.pgmq_send_msg(queue_name text, message jsonb)
returns bigint
language sql security definer set search_path = ''
as $$ select pgmq.send(queue_name, message); $$;

create or replace function public.pgmq_metrics_one(queue_name text)
returns table(queue_length bigint, oldest_msg_age_sec int, newest_msg_age_sec int, total_messages bigint)
language sql security definer set search_path = ''
as $$
  select m.queue_length, m.oldest_msg_age_sec, m.newest_msg_age_sec, m.total_messages
  from pgmq.metrics(queue_name) m;
$$;

-- service_role only: revoke the PostgREST-default anon/authenticated EXECUTE,
-- then grant explicitly. Looped so the signature list stays the single source
-- of truth.
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.pgmq_read_msgs(text,int,int)',
    'public.pgmq_archive_msg(text,bigint)',
    'public.pgmq_delete_msg(text,bigint)',
    'public.pgmq_send_msg(text,jsonb)',
    'public.pgmq_metrics_one(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;

commit;
