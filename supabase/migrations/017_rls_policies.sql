-- 017: Row Level Security — public read on everything, no public write.
-- The service_role key bypasses these policies by design, so the Next.js
-- app's existing createServerClient() flow is unaffected. This is defense
-- in depth for any future anon-key exposure.

-- Enable RLS on all tables
alter table sources enable row level security;
alter table articles enable row level security;
alter table clusters enable row level security;
alter table cluster_articles enable row level security;
alter table stories enable row level security;
alter table story_stances enable row level security;

-- Read policies (anon + authenticated)
create policy "public read sources" on sources
  for select to anon, authenticated using (true);

create policy "public read articles" on articles
  for select to anon, authenticated using (true);

create policy "public read clusters" on clusters
  for select to anon, authenticated using (true);

create policy "public read cluster_articles" on cluster_articles
  for select to anon, authenticated using (true);

create policy "public read stories" on stories
  for select to anon, authenticated using (true);

create policy "public read story_stances" on story_stances
  for select to anon, authenticated using (true);

-- No INSERT/UPDATE/DELETE policies = no one can write via anon.
-- service_role bypasses RLS entirely, so the worker scripts + API routes
-- using createServerClient() continue to write normally.
