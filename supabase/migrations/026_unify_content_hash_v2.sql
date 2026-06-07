-- 026_unify_content_hash_v2.sql
--
-- Worker-stream system v1 — second-wave content_hash unification.
--
-- Migration 016 (`016_unify_content_hash.sql`) shipped the first pass of
-- this work: it recomputed every sha256(64-hex) row using
-- `strictFingerprint(title, description)` and added the canonical sha1
-- form (40-hex) as the One True Hash. That migration carried an embedded
-- JS-precomputed lookup table of ~10,668 rows and was a one-shot fix.
--
-- Between then and now the live ingest pipeline was running on two code
-- paths simultaneously:
--   * `scripts/rss-worker.mjs:606`   → strictFingerprint (sha1, 40 hex)
--   * `src/lib/rss/normalize.ts:49`  → SHA256(title + url) (64 hex)
-- The TS path is the Vercel cron fallback; whenever the tmux worker was
-- stopped or hit its circuit-breaker, the fallback would re-introduce
-- sha256 rows. Because `articles_source_content_hash_key` is a UNIQUE
-- index on the raw bytes — not on a normalised form — those rows do not
-- collide with their sha1 twins and the silent drift kept growing.
--
-- The worker-stream refactor (ADR-001) replaces both paths with the
-- Edge Function `ingest`, which writes sha1 only. This migration
-- (a) eliminates any sha256 stragglers left in `articles.content_hash`
-- so the table converges on the canonical regime, and (b) installs a
-- CHECK constraint that physically prevents the regime from drifting
-- again.
--
-- Strategy: hard-delete the sha256 stragglers (Option C from
-- migration-safety F1; matches the audit's T7 P1-21 framing that the
-- sha256 rows are silent duplicates of their sha1 twins).
--
-- Why hard-delete instead of NULL-out-and-rehash:
--   The earlier draft of this migration NULL-ed the hash and relied on
--   the Edge Function ingest to refill it on the next cycle. Two problems
--   killed that strategy:
--     1) `articles.content_hash` is declared `text not null` back in
--        `002_create_articles.sql:9` and that constraint was never
--        relaxed, so the UPDATE would raise 23502 and roll the whole
--        transaction back (migration-safety F1).
--     2) The Edge Function ingest upserts with
--        `onConflict: "url", ignoreDuplicates: true`. The article URL
--        already exists in the table (that's why content_hash was being
--        invalidated in the first place), so `ignoreDuplicates: true`
--        makes the upsert a silent no-op. The NULL hash would sit in
--        the column forever (migration-safety F2).
--   Hard-delete sidesteps both problems: no NOT NULL violation, no
--   dependency on the Edge Function ever running for the table to reach
--   a consistent state, and no need to port `strictFingerprint`
--   (sha1-of-shingles over Turkish-normalised token-4-grams) into
--   PL/pgSQL — that port would duplicate a complex algorithm in a
--   second language and re-introduce the very TS↔SQL drift this
--   refactor is removing (audit T7 P1-3).
--
-- Why hard-delete is safe:
--   The audit's T7 P1-21 framing ("hash divergence") establishes that
--   the sha256 rows are duplicates: every sha256 row was inserted by
--   the Vercel cron fallback for an URL whose canonical sha1 twin was
--   already (or would be) written by the tmux worker. The sha1 twin
--   stayed in `articles_source_content_hash_key` (the UNIQUE on
--   `(source_id, content_hash)`); the sha256 row sat alongside as a
--   silent dupe. Deleting the sha256 rows removes only the silent dupe;
--   the canonical row stays. Any cluster_articles row pointing at a
--   sha256 article is cleaned up by the existing
--   `cluster_articles_article_id_fkey ON DELETE CASCADE`
--   (migration 003).
--
-- Idempotency:
--   * Section 1 filters `WHERE length(content_hash) = 64`, so a re-run
--     after the delete has happened touches zero rows.
--   * Section 2 uses `DROP CONSTRAINT IF EXISTS` before `ADD`. After
--     section 1 every remaining row carries a 40-hex hash, so the ADD
--     succeeds on first run and on every re-run.
--   * Section 3 is a diagnostic and is always safe.
--
-- What this migration does NOT do:
--   * It does NOT drop `articles_source_content_hash_key`. The UNIQUE
--     constraint stays in place; with the sha256 rows gone, every
--     remaining row participates in it.
--   * It does NOT alter `articles.content_hash`'s NOT NULL declaration.
--     The hard-delete strategy never writes NULL, so the existing
--     NOT NULL stays consistent with the new CHECK.
--   * It does NOT touch the TS sha256 code path. That code becomes
--     dead with the B4 (`supabase/functions/ingest`) port + the B7
--     deletion sweep; killing it from migration land would be the wrong
--     layer.

begin;

-- 1) Hard-delete sha256 stragglers ------------------------------------------
--    Any row whose `content_hash` is exactly 64 hex chars is the sha256
--    regime. Per the audit (T7 P1-21) these are silent duplicates of
--    their sha1 twins already present in the table. Deleting them
--    cascades through `cluster_articles_article_id_fkey ON DELETE
--    CASCADE` (migration 003), which is the desired behaviour: any
--    cluster membership row pointing at the dupe is removed; the
--    canonical sha1 article keeps its cluster membership.
do $$
declare
  v_deleted bigint;
  v_before_64 bigint;
  v_before_total bigint;
begin
  select count(*) into v_before_total from articles;
  select count(*) into v_before_64
    from articles
    where length(content_hash) = 64;
  raise notice
    'BEFORE: articles total=%, rows with sha256-length (64) content_hash=%',
    v_before_total, v_before_64;

  delete from articles
    where length(content_hash) = 64;
  get diagnostics v_deleted = row_count;
  raise notice
    'articles deleted (sha256 stragglers removed as silent dupes of sha1 twins): %',
    v_deleted;
end $$;

-- 2) Install the length-40 CHECK constraint ---------------------------------
--    Belt-and-braces: even if a future code path tries to write a
--    sha256 (64-char) or any other non-canonical length, the DB rejects
--    it. The constraint also tolerates NULL so it is forward-compatible
--    with a hypothetical future migration that wants to relax NOT NULL
--    — but in the current schema, `articles.content_hash` is
--    `text not null` (per `002_create_articles.sql:9`) so the NULL
--    branch is unreachable in practice. The redundancy is intentional:
--    if a later migration drops NOT NULL, this CHECK still holds.
alter table articles
  drop constraint if exists articles_content_hash_length_chk;

alter table articles
  add constraint articles_content_hash_length_chk
  check (content_hash is null or length(content_hash) = 40);

-- 3) Diagnostics: confirm the after-state -----------------------------------
--    Note: by the time this block runs, section 2's ADD CONSTRAINT has
--    already validated every existing row. If any row had a non-{40,
--    null} hash, the ADD would have failed and the transaction would
--    have rolled back before we got here. The counters below are
--    therefore guaranteed to satisfy the invariant — they exist for
--    observability (operators can grep migration logs for the AFTER
--    counts) rather than as a safety net.
do $$
declare
  v_total bigint;
  v_len_40 bigint;
  v_len_64 bigint;
  v_null bigint;
  v_other bigint;
begin
  select count(*)                                          into v_total   from articles;
  select count(*) filter (where length(content_hash) = 40) into v_len_40  from articles;
  select count(*) filter (where length(content_hash) = 64) into v_len_64  from articles;
  select count(*) filter (where content_hash is null)      into v_null    from articles;
  select count(*)                                          into v_other
    from articles
    where content_hash is not null
      and length(content_hash) not in (40, 64);
  raise notice 'AFTER: total=%, sha1(40)=%, sha256(64)=%, null=%, other_lengths=%',
    v_total, v_len_40, v_len_64, v_null, v_other;
end $$;

commit;
