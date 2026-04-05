create table if not exists clusters (
  id uuid primary key default gen_random_uuid(),
  title_tr text not null,
  title_en text not null,
  summary_tr text not null,
  summary_en text not null,
  bias_distribution jsonb not null default '{"pro_government": 0, "opposition": 0, "independent": 0}',
  is_blindspot boolean not null default false,
  blindspot_side text check (blindspot_side in ('pro_government', 'opposition', 'independent')),
  article_count integer not null default 0,
  first_published timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cluster_articles (
  cluster_id uuid not null references clusters(id) on delete cascade,
  article_id uuid not null references articles(id) on delete cascade,
  primary key (cluster_id, article_id)
);

create index idx_clusters_is_blindspot on clusters (is_blindspot) where is_blindspot = true;
create index idx_clusters_first_published on clusters (first_published desc);
create index idx_clusters_updated_at on clusters (updated_at desc);
create index idx_cluster_articles_article_id on cluster_articles (article_id);
