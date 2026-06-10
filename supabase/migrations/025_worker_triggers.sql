-- 025_worker_triggers.sql
--
-- Worker-stream system v1 — article event triggers.
--
-- This migration wires the `articles` table to the two pgmq queues created
-- in 024_pgmq_setup.sql (`cluster_work`, `image_backfill`). Each INSERT
-- on `articles` becomes a per-article event that fans out to the relevant
-- consumer Edge Function via pg_cron-driven drains.
--
-- Migration order: 024 (pgmq install + queues) → 025 (these triggers) →
-- 026 (content_hash dual-regime CHECK). The migration is idempotent: triggers and
-- their backing functions are dropped before recreate, so re-running this
-- file against a database where 025 has already been applied is safe.
--
-- pg_cron schedules that drain the queues live in the Supabase Dashboard
-- SQL editor (not portable; see docs/migration-guide.md).

begin;

-- ---------------------------------------------------------------------------
-- 0. EXECUTE grants for the SECURITY DEFINER trigger owners.
--
-- The enqueue_cluster_work() and enqueue_image_backfill() functions defined
-- below are SECURITY DEFINER. When they call pgmq.send(...) they do so under
-- the function-owner identity, NOT under the role that issued the INSERT
-- on `articles`. Migration 024 grants pgmq.send EXECUTE only to
-- service_role, so the trigger would fail with "permission denied for
-- function pgmq.send" whenever the owner is anyone other than service_role
-- (which is the common case: Supabase migrations run as `postgres`, so
-- functions created here are typically owned by `postgres` /
-- `supabase_admin`).
--
-- Grant EXECUTE on every pgmq.send overload to both `postgres` and
-- `supabase_admin` so that whichever role owns the SECURITY DEFINER
-- functions below can actually invoke pgmq.send. The DO block is defensive:
-- if a role does not exist on a given environment (e.g. a vanilla local
-- Postgres without the Supabase role bundle), the grant is silently
-- skipped rather than failing the migration.
--
-- Ownership of the two functions is pinned to `postgres` right after each
-- CREATE FUNCTION below, so "whichever role owns" is deterministic rather
-- than an accident of which role ran the migration. The dual-role grant
-- here stays as defence in depth for environments where the pin is
-- skipped (no `postgres` role).
do $$
declare
  fn_oid oid;
  target_role text;
begin
  foreach target_role in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = target_role) then
      for fn_oid in
        select p.oid
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'pgmq' and p.proname = 'send'
      loop
        execute format(
          'grant execute on function %s to %I',
          fn_oid::regprocedure,
          target_role
        );
      end loop;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. cluster_work enqueue
--
-- Fires after INSERT on `articles`. Only politics-category rows are
-- enqueued because the cluster ensemble is scoped to political news
-- (see migration 008_politics_cleanup.sql for the original whitelist
-- and the rationale: clustering non-political articles was dead work
-- that wasted compute and polluted the cluster table).
--
-- The category predicate lives in the trigger's WHEN clause, so the
-- SECURITY DEFINER function is never even invoked for the ~majority of
-- inserts that fall outside the whitelist — the same check repeated
-- inside the function body is belt-and-braces in case the trigger is
-- ever recreated without the WHEN clause.
--
-- The whitelist is hardcoded here intentionally — `src/lib/categories.ts`
-- does not exist in this codebase, and even if it did, a SQL trigger
-- cannot read a TypeScript module at runtime. If the application-layer
-- whitelist ever grows beyond `politika` + `son_dakika`, a follow-up
-- migration must update this trigger.
--
-- The payload is the minimum needed by `cluster-consumer`: just the
-- article id. The consumer re-fetches the row inside its transaction
-- so it always sees the latest title/description/category, never a
-- snapshot of the row at insert time.
-- ---------------------------------------------------------------------------

drop trigger if exists articles_cluster_enqueue on articles;
drop function if exists enqueue_cluster_work();

create function enqueue_cluster_work()
returns trigger
language plpgsql
security definer
-- Round-6 P1 fix: lock search_path to empty and fully qualify every
-- identifier. The previous `public, pgmq, pg_temp` setting let any
-- session role with CREATE on pg_temp shadow an unqualified call from
-- inside this SECURITY DEFINER function (e.g. a hostile pgmq.send) and
-- execute under the function-owner identity. Empty search_path + schema
-- qualification removes that footgun.
set search_path = ''
as $$
begin
  -- Skip non-politics rows. The whitelist mirrors migration 008's
  -- partial-index predicate so a row that lands in the index also
  -- lands in the queue, and vice versa. Redundant with the trigger's
  -- WHEN clause by design (belt-and-braces, see section comment).
  if NEW.category is null or NEW.category not in ('politika', 'son_dakika') then
    return NEW;
  end if;

  perform pgmq.send(
    'cluster_work',
    pg_catalog.jsonb_build_object('article_id', NEW.id)
  );

  return NEW;
end;
$$;

-- Deterministic ownership: SECURITY DEFINER executes as the function
-- owner, and the section-0 pgmq.send grants target `postgres` /
-- `supabase_admin` specifically — so pin the owner to `postgres` rather
-- than inheriting whatever role happened to run the migration. Guarded
-- so a vanilla local Postgres without the role skips the pin instead of
-- failing the migration.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    alter function enqueue_cluster_work() owner to postgres;
  end if;
end
$$;

comment on function enqueue_cluster_work() is
  'Trigger fn: enqueues a cluster_work message for each newly inserted '
  'politics article. Payload: {article_id: uuid}. See migration 025.';

-- Supabase auto-grants EXECUTE on new public functions to anon +
-- authenticated, which would expose this SECURITY DEFINER function via
-- PostgREST (POST /rest/v1/rpc/enqueue_cluster_work) to unauthenticated
-- callers. It is a trigger function and has no business being callable
-- over the REST API; revoke EXECUTE from every client-facing role. The
-- table trigger still invokes it under the function-owner identity.
revoke execute on function enqueue_cluster_work() from anon, authenticated, public;

create trigger articles_cluster_enqueue
  after insert on articles
  for each row
  when (NEW.category in ('politika', 'son_dakika'))
  execute function enqueue_cluster_work();

comment on trigger articles_cluster_enqueue on articles is
  'Fires after INSERT on articles for category in (politika, son_dakika), '
  'filtered at the trigger level via the WHEN clause so the SECURITY '
  'DEFINER function never runs for non-politics rows. Enqueues a '
  'cluster_work message consumed by the cluster-consumer Edge Function '
  'via pg_cron. Clustering is scoped to political news (migration 008).';

-- ---------------------------------------------------------------------------
-- 2. image_backfill enqueue
--
-- Fires after INSERT on `articles` when the row arrives without an
-- `image_url`. The image-consumer Edge Function dequeues these, fetches
-- the article's HTML, scrapes `og:image` / `twitter:image`, and updates
-- the row. Validation (SSRF allowlist) is done in the consumer.
--
-- As with the cluster trigger above, the image_url predicate lives in
-- the trigger's WHEN clause so rows that already carry an image never
-- invoke the SECURITY DEFINER function; the in-function check is kept
-- as belt-and-braces.
--
-- We enqueue on INSERT (not UPDATE) because:
--   - articles arrive image-less ~24 % of the time across the source mix;
--     the consumer's job is to fill them in.
--   - chasing UPDATE events would re-enqueue every row each time the
--     consumer wrote back a result, causing an infinite loop. The
--     consumer issues a targeted UPDATE that does NOT re-trigger this
--     function (no trigger on UPDATE here).
--
-- All categories are eligible — image backfill is useful for the entire
-- corpus, not just politics.
-- ---------------------------------------------------------------------------

drop trigger if exists articles_image_enqueue on articles;
drop function if exists enqueue_image_backfill();

create function enqueue_image_backfill()
returns trigger
language plpgsql
security definer
-- Round-6 P1 fix (mirrors enqueue_cluster_work above): empty search_path
-- + schema-qualified identifiers so pg_temp shadowing cannot reach the
-- SECURITY DEFINER body.
set search_path = ''
as $$
begin
  -- Only enqueue if the new row lacks an image. Rows that already carry
  -- an `image_url` from the RSS feed or the Edge Function's inline
  -- og:image extraction do not need a backfill pass. Redundant with the
  -- trigger's WHEN clause by design (belt-and-braces).
  if NEW.image_url is not null then
    return NEW;
  end if;

  perform pgmq.send(
    'image_backfill',
    pg_catalog.jsonb_build_object('article_id', NEW.id)
  );

  return NEW;
end;
$$;

-- Deterministic ownership — same rationale as enqueue_cluster_work
-- above: pin the SECURITY DEFINER owner to `postgres` so the section-0
-- grant set always covers the executing identity; skip gracefully on
-- environments without the role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    alter function enqueue_image_backfill() owner to postgres;
  end if;
end
$$;

comment on function enqueue_image_backfill() is
  'Trigger fn: enqueues an image_backfill message for each newly '
  'inserted article that lacks image_url. Payload: {article_id: uuid}. '
  'See migration 025.';

-- Same exposure as enqueue_cluster_work above: Supabase auto-grants
-- EXECUTE to anon + authenticated on creation, making this trigger
-- function callable via PostgREST. Revoke it from every client-facing
-- role; only the table trigger invokes it.
revoke execute on function enqueue_image_backfill() from anon, authenticated, public;

create trigger articles_image_enqueue
  after insert on articles
  for each row
  when (NEW.image_url is null)
  execute function enqueue_image_backfill();

comment on trigger articles_image_enqueue on articles is
  'Fires after INSERT on articles when image_url IS NULL, filtered at '
  'the trigger level via the WHEN clause so rows that already carry an '
  'image never invoke the function. Enqueues an image_backfill message '
  'consumed by the image-consumer Edge Function via pg_cron. INSERT-only '
  '(not UPDATE) to avoid a re-enqueue loop when the consumer writes the '
  'resolved image back to the row.';

commit;
