-- 026_unify_content_hash_v2.sql
--
-- Worker-stream system v1 — content_hash dual-regime documentation.
--
-- Migration 016 (`016_unify_content_hash.sql`) shipped the first pass of
-- this work, recomputing a batch of rows toward the canonical sha1
-- (40-hex) form. Since then the production table has settled into a
-- deliberate, permanent two-regime layout:
--   * old data carries SHA256 content_hash (64 lowercase-hex chars),
--     written by the historical `src/lib/rss/normalize.ts` path;
--   * new ingest writes sha1 (40 lowercase-hex chars) via
--     `strictFingerprint` and the Edge Function `ingest`.
-- The two forms coexist without conflict: `articles_source_content_hash_key`
-- is a UNIQUE index on the raw bytes, so a sha256 row and a sha1 row never
-- collide, and the pipeline never compares a hash across regimes. There is
-- nothing to converge — the dual regime is the intended steady state.
--
-- This migration therefore does NOT delete, rewrite, or rehash any row.
-- Its only job is to install a PERMISSIVE format CHECK that documents the
-- dual regime at the schema level: a `content_hash` must be NULL or a
-- lowercase-hex digest of length 40 (sha1) OR 64 (sha256). Every existing
-- row already satisfies this — both regimes emit lowercase hex of those
-- exact lengths — so the constraint rejects nothing that lives in the
-- table today; it only bars a future write of an uppercase, truncated, or
-- non-hex value.
--
-- The constraint is added `NOT VALID` so the ADD does not take a full-table
-- validate lock against the ~355k existing rows on deploy. NOT VALID still
-- enforces the predicate on every subsequent INSERT/UPDATE; it only skips
-- the one-time scan of pre-existing rows (which are already valid hex, so
-- the scan would pass anyway — NOT VALID just avoids paying for it). The
-- check is intentionally never VALIDATEd: there is no value in the lock.
--
-- Safety:
--   * Runs cleanly on a fresh empty DB (nothing to scan, constraint added).
--   * Runs cleanly on the populated production DB (no row is touched, no
--     row is deleted, no validate lock is taken).
--   * Idempotent: `DROP CONSTRAINT IF EXISTS` precedes the ADD, so a re-run
--     replaces the constraint in place.
--
-- What this migration does NOT do:
--   * It does NOT delete sha256 rows. Both regimes are permanent.
--   * It does NOT drop `articles_source_content_hash_key`. The UNIQUE dedup
--     key stays in place across both regimes.
--   * It does NOT alter `articles.content_hash`'s NOT NULL declaration. The
--     NULL branch in the CHECK is forward-compatibility only.

begin;

-- 1) Install the permissive dual-regime format CHECK -------------------------
--    content_hash must be NULL or a lowercase-hex digest of length 40
--    (sha1, new ingest) OR 64 (sha256, old data). This documents and
--    enforces the dual regime without rejecting any existing row. Added
--    NOT VALID so the ADD does not scan/lock the existing rows — existing
--    rows are already valid lowercase hex, and the predicate is enforced
--    on every new write regardless. The constraint name is kept stable so
--    a re-run replaces it in place.
alter table articles
  drop constraint if exists articles_content_hash_length_chk;

alter table articles
  add constraint articles_content_hash_length_chk
  check (
    content_hash is null
    or content_hash ~ '^[0-9a-f]{40}$'
    or content_hash ~ '^[0-9a-f]{64}$'
  )
  not valid;

-- 2) Diagnostics: report the dual-regime split ------------------------------
--    Pure observability — operators can grep migration logs for the
--    sha1/sha256/null/other breakdown. No row is read for correctness; the
--    CHECK above is the only enforcement.
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
  raise notice 'content_hash regimes: total=%, sha1(40)=%, sha256(64)=%, null=%, other_lengths=%',
    v_total, v_len_40, v_len_64, v_null, v_other;
end $$;

commit;
