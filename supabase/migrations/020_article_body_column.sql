-- 020: Article body excerpt column for enriching empty-description feeds.
-- Many RSS sources ship title-only items, starving the cluster worker's
-- token-overlap + embedding paths. A background worker (see
-- scripts/lib/shared/article-body.mjs) fetches the article HTML and
-- extracts a ≤500-char excerpt into this column; the cluster worker then
-- reads it as a description fallback. C1 adds only the column + index
-- here; wiring into rss-worker.mjs is intentionally out of scope and will
-- land in a follow-up agent pass.

alter table articles
  add column if not exists body_excerpt text;

-- Partial index for the backfill worker's "next batch to enrich" query.
-- Scoped to the two categories where clustering quality matters most
-- (politika / son_dakika) so the index stays small and writes to other
-- categories aren't amplified. The index is dropped from consideration
-- as soon as body_excerpt is populated, so it naturally shrinks over time.
create index if not exists idx_articles_body_excerpt_backfill
  on articles (published_at desc)
  where body_excerpt is null and category in ('politika', 'son_dakika');

analyze articles;
