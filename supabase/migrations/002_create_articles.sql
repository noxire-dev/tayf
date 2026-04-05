create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  title text not null,
  description text,
  url text not null unique,
  image_url text,
  published_at timestamptz not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);

create index idx_articles_source_id on articles (source_id);
create index idx_articles_published_at on articles (published_at desc);
create index idx_articles_content_hash on articles (content_hash);
create index idx_articles_created_at on articles (created_at desc);
