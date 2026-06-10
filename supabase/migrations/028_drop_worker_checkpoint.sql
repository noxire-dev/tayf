-- 028_drop_worker_checkpoint.sql
--
-- Round-6 audit P1 follow-up: clean drop of the worker_checkpoint table,
-- its updated_at trigger, and the supporting trigger function. The
-- table was created by an earlier version of migration 024 as a
-- safety-net resume marker for a Vercel-cron fallback consumer (R5 in
-- ADR-001) that was never wired. Migration 024 has since been edited
-- to no longer create the table, but databases that already applied
-- the original 024 still carry it — this migration removes it cleanly.
--
-- Safe to run unconditionally on any database, fresh or populated.
--
-- `drop trigger if exists ... on public.worker_checkpoint` only treats the
-- TRIGGER as optional — it still raises 42P01 ("relation does not exist")
-- when the worker_checkpoint TABLE is absent, which is the case on every
-- fresh DB (migration 024 no longer creates it). Guard the trigger + table
-- drops behind a table-existence check so the migration is a clean no-op
-- there. The function drop stays outside the guard: `drop function if
-- exists` is safe standalone regardless of whether the table ever existed.

begin;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'worker_checkpoint'
  ) then
    drop trigger if exists worker_checkpoint_set_updated_at
      on public.worker_checkpoint;
    drop table public.worker_checkpoint;
  end if;
end $$;

drop function if exists public.worker_checkpoint_set_updated_at();

commit;
