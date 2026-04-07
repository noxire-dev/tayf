-- Replace single "bias" field with alignment + tradition + source_type
-- alignment: 5-point political proximity scale
-- tradition: ideological worldview of the outlet
-- source_type: content category (general, sports, finance, niche)

-- 1. Drop old constraint
alter table sources drop constraint if exists sources_bias_check;

-- 2. Rename column
alter table sources rename column bias to alignment;

-- 3. Update existing data (independent → center)
update sources set alignment = 'center' where alignment = 'independent';

-- 4. Add new alignment constraint
alter table sources add constraint sources_alignment_check
  check (alignment in ('pro_government', 'gov_leaning', 'center', 'opposition_leaning', 'opposition'));

-- 5. Add tradition column
alter table sources add column tradition text not null default 'mainstream'
  check (tradition in ('mainstream', 'islamist', 'nationalist', 'secular', 'left', 'kurdish', 'state', 'international'));

-- 6. Add source_type column
alter table sources add column source_type text not null default 'general'
  check (source_type in ('general', 'sports', 'finance', 'niche'));

-- 7. Update indexes
drop index if exists idx_sources_bias;
create index idx_sources_alignment on sources (alignment);
create index idx_sources_tradition on sources (tradition);
create index idx_sources_source_type on sources (source_type);

-- 8. Update clusters bias_distribution default to 5-point
alter table clusters alter column bias_distribution
  set default '{"pro_government": 0, "gov_leaning": 0, "center": 0, "opposition_leaning": 0, "opposition": 0}';

-- 9. Update blindspot_side constraint for 5-point alignment
alter table clusters drop constraint if exists clusters_blindspot_side_check;
alter table clusters add constraint clusters_blindspot_side_check
  check (blindspot_side in ('pro_government', 'gov_leaning', 'center', 'opposition_leaning', 'opposition'));
