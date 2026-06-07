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
-- (a) clears any sha256 stragglers left in `articles.content_hash` so
-- the next ingest cycle can re-insert the canonical sha1 row via
-- `ON CONFLICT (source_id, content_hash) DO NOTHING`, and (b) installs
-- a CHECK constraint that physically prevents the regime from drifting
-- again.
--
-- Why NULL-out instead of recomputing inline:
--   `strictFingerprint` is sha1 over the sorted set of character-4-gram
--   shingles of the Turkish-normalised token stream of `title` (and
--   `description`). Faithfully porting Turkish case-folding (`İ`→`i`,
--   `I`→`ı`, etc.), token segmentation, shingle generation, and the
--   exact sort-then-concat-then-sha1 pipeline into PL/pgSQL would
--   duplicate a complex algorithm in a second language and re-introduce
--   the very TS↔JS drift this refactor is removing (audit T7 P1-3).
--   Setting `content_hash = NULL` lets the next ingest cycle rehash the
--   row in a single canonical place (`supabase/functions/ingest`). The
--   row is preserved; only its hash is invalidated.
--
-- Idempotency:
--   * Section 1 filters `WHERE length(content_hash) = 64`, so a re-run
--     after the rehash has happened touches zero rows.
--   * Section 2 uses `DROP CONSTRAINT IF EXISTS` before `ADD`. The CHECK
--     allows NULL so the section-1 NULL-out is consistent with the
--     constraint; the UNIQUE constraint on `(source_id, content_hash)`
--     already tolerates NULL hashes because NULL never equals NULL.
--   * Section 3 is a diagnostic and is always safe.
--
-- What this migration does NOT do:
--   * It does NOT drop `articles_source_content_hash_key`. The UNIQUE
--     constraint stays in place; rows with NULL hashes simply do not
--     participate in it until the rehash backfills them.
--   * It does NOT touch `cluster_articles`. Cluster membership is by
--     `article_id`, not by hash, so unifying the hash regime cannot
--     orphan any cluster row.
--   * It does NOT touch the TS sha256 code path. That code becomes
--     dead with the B4 (`supabase/functions/ingest`) port + the B7
--     deletion sweep; killing it from migration land would be the wrong
--     layer.

begin;

-- 1) Clear sha256 stragglers ------------------------------------------------
--    Any row whose `content_hash` is exactly 64 hex chars is the sha256
--    regime. NULL them out so the next ingest cycle re-hashes via the
--    canonical sha1 algorithm. `published_at` is intentionally not
--    touched — only the hash is invalidated; the row stays visible to
--    the rest of the pipeline.
do $$
declare
  v_nulled bigint;
  v_before_64 bigint;
begin
  select count(*) into v_before_64
    from articles
    where length(content_hash) = 64;
  raise notice 'BEFORE: rows with sha256-length (64) content_hash = %', v_before_64;

  update articles
    set content_hash = null
    where length(content_hash) = 64;
  get diagnostics v_nulled = row_count;
  raise notice 'articles.content_hash nulled (sha256 → null for rehash): %', v_nulled;
end $$;

-- 2) Install the length-40-or-null CHECK constraint -------------------------
--    Belt-and-braces: even if a future code path tries to write a
--    sha256 (64-char) or any other non-canonical length, the DB rejects
--    it. NULL is allowed so the section-1 stragglers can sit in the
--    table for one ingest cycle before being rehashed. After the next
--    ingest cycle every row should once again carry a 40-hex value.
alter table articles
  drop constraint if exists articles_content_hash_length_chk;

alter table articles
  add constraint articles_content_hash_length_chk
  check (content_hash is null or length(content_hash) = 40);

-- 3) Diagnostics: confirm the after-state -----------------------------------
do $$
declare
  v_total bigint;
  v_len_40 bigint;
  v_len_64 bigint;
  v_null bigint;
  v_other bigint;
begin
  select count(*)                                       into v_total   from articles;
  select count(*) filter (where length(content_hash) = 40) into v_len_40 from articles;
  select count(*) filter (where length(content_hash) = 64) into v_len_64 from articles;
  select count(*) filter (where content_hash is null)      into v_null   from articles;
  select count(*)                                       into v_other
    from articles
    where content_hash is not null
      and length(content_hash) not in (40, 64);
  raise notice 'AFTER: total=%, sha1(40)=%, sha256(64)=%, null=%, other_lengths=%',
    v_total, v_len_40, v_len_64, v_null, v_other;
  if v_len_64 > 0 then
    raise exception
      'migration 026 invariant violated: % row(s) still carry a 64-char content_hash after the null-out step',
      v_len_64;
  end if;
  if v_other > 0 then
    raise exception
      'migration 026 invariant violated: % row(s) carry a non-{40,null} content_hash; CHECK constraint would have rejected the ADD',
      v_other;
  end if;
end $$;

commit;
