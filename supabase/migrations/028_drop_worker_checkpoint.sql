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
-- Safe to run unconditionally: every DROP is guarded by IF EXISTS, so
-- a database that never created the table is a no-op.

begin;

drop trigger if exists worker_checkpoint_set_updated_at
  on public.worker_checkpoint;

drop function if exists public.worker_checkpoint_set_updated_at();

drop table if exists public.worker_checkpoint;

commit;
