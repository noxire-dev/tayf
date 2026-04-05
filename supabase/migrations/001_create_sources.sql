create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  url text not null,
  rss_url text not null,
  bias text not null check (bias in ('pro_government', 'opposition', 'independent')),
  logo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_sources_bias on sources (bias);
create index idx_sources_active on sources (active);
