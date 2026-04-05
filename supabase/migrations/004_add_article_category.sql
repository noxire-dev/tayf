alter table articles add column if not exists category text not null default 'genel';

create index idx_articles_category on articles (category);
