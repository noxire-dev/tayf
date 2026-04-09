-- 007_clustering_columns.sql
--
-- Adds ensemble-clustering support columns to `articles` and updates the
-- `clusters.blindspot_side` CHECK constraint + `bias_distribution` default
-- to match the 10-value BiasCategory taxonomy installed by migration 005.
--
-- Idempotent: safe to re-run.

-- 1. Articles: fingerprint + entities -------------------------------------------------

alter table articles
  add column if not exists fingerprint text;

alter table articles
  add column if not exists entities text[] not null default '{}';

create index if not exists idx_articles_fingerprint
  on articles (fingerprint);

create index if not exists idx_articles_entities
  on articles using gin (entities);

-- 2. Clusters: widen blindspot_side to 10 BiasCategory values -------------------------

-- Drop the legacy 3-value constraint (named or anonymous — discover by pattern).
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.clusters'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%blindspot_side%'
  loop
    execute format('alter table public.clusters drop constraint %I', con.conname);
  end loop;
end
$$;

alter table clusters
  add constraint clusters_blindspot_side_check
  check (
    blindspot_side is null
    or blindspot_side in (
      'pro_government',
      'gov_leaning',
      'state_media',
      'center',
      'opposition_leaning',
      'opposition',
      'nationalist',
      'islamist_conservative',
      'pro_kurdish',
      'international'
    )
  );

-- 3. Clusters: update bias_distribution default to the 10-key shape -------------------

alter table clusters
  alter column bias_distribution
  set default jsonb_build_object(
    'pro_government', 0,
    'gov_leaning', 0,
    'state_media', 0,
    'center', 0,
    'opposition_leaning', 0,
    'opposition', 0,
    'nationalist', 0,
    'islamist_conservative', 0,
    'pro_kurdish', 0,
    'international', 0
  );
