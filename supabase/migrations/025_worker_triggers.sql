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
-- 026 (content_hash rehash). The migration is idempotent: triggers and
-- their backing functions are dropped before recreate, so re-running this
-- file against a database where 025 has already been applied is safe.
--
-- pg_cron schedules that drain the queues live in the Supabase Dashboard
-- SQL editor (not portable; see docs/migration-guide.md).

begin;

-- ---------------------------------------------------------------------------
-- 1. cluster_work enqueue
--
-- Fires after INSERT on `articles`. Only politics-category rows are
-- enqueued because the cluster ensemble is scoped to political news
-- (see migration 008_politics_cleanup.sql for the original whitelist
-- and the rationale: clustering non-political articles was dead work
-- that wasted compute and polluted the cluster table).
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
set search_path = public, pgmq, pg_temp
as $$
begin
  -- Skip non-politics rows. The whitelist mirrors migration 008's
  -- partial-index predicate so a row that lands in the index also
  -- lands in the queue, and vice versa.
  if NEW.category is null or NEW.category not in ('politika', 'son_dakika') then
    return NEW;
  end if;

  perform pgmq.send(
    'cluster_work',
    jsonb_build_object('article_id', NEW.id)
  );

  return NEW;
end;
$$;

comment on function enqueue_cluster_work() is
  'Trigger fn: enqueues a cluster_work message for each newly inserted '
  'politics article. Payload: {article_id: uuid}. See migration 025.';

create trigger articles_cluster_enqueue
  after insert on articles
  for each row
  execute function enqueue_cluster_work();

comment on trigger articles_cluster_enqueue on articles is
  'Fires after INSERT on articles for category in (politika, son_dakika). '
  'Enqueues a cluster_work message consumed by the cluster-consumer '
  'Edge Function via pg_cron. Non-politics rows are skipped because '
  'clustering is scoped to political news (migration 008).';

-- ---------------------------------------------------------------------------
-- 2. image_backfill enqueue
--
-- Fires after INSERT on `articles` when the row arrives without an
-- `image_url`. The image-consumer Edge Function dequeues these, fetches
-- the article's HTML, scrapes `og:image` / `twitter:image`, and updates
-- the row. Validation (SSRF allowlist) is done in the consumer.
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
set search_path = public, pgmq, pg_temp
as $$
begin
  -- Only enqueue if the new row lacks an image. Rows that already carry
  -- an `image_url` from the RSS feed or the Edge Function's inline
  -- og:image extraction do not need a backfill pass.
  if NEW.image_url is not null then
    return NEW;
  end if;

  perform pgmq.send(
    'image_backfill',
    jsonb_build_object('article_id', NEW.id)
  );

  return NEW;
end;
$$;

comment on function enqueue_image_backfill() is
  'Trigger fn: enqueues an image_backfill message for each newly '
  'inserted article that lacks image_url. Payload: {article_id: uuid}. '
  'See migration 025.';

create trigger articles_image_enqueue
  after insert on articles
  for each row
  execute function enqueue_image_backfill();

comment on trigger articles_image_enqueue on articles is
  'Fires after INSERT on articles when image_url IS NULL. Enqueues an '
  'image_backfill message consumed by the image-consumer Edge Function '
  'via pg_cron. INSERT-only (not UPDATE) to avoid a re-enqueue loop '
  'when the consumer writes the resolved image back to the row.';

commit;
