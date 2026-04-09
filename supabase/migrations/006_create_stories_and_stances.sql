-- Hand-curated stories and per-outlet stances for the surprise-detection demo

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_tr text not null,
  summary_tr text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists story_stances (
  story_id uuid not null references stories(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  stance text not null check (stance in ('destekliyor', 'tarafsiz', 'elestiriyor', 'sessiz')),
  note text,
  primary key (story_id, source_id)
);

create index idx_story_stances_story_id on story_stances (story_id);
create index idx_story_stances_source_id on story_stances (source_id);
create index idx_stories_display_order on stories (display_order);
