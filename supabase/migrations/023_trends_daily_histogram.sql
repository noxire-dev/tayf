-- 023_trends_daily_histogram.sql
--
-- Pre-aggregated view that powers the /trends page.
--
-- Before: /trends pulled every (created_at, sources.bias) pair for the last
-- 30 days via paginated .range() calls, often 15-25k rows, only to fold them
-- into a 30 × 3 histogram in JS. ~99.5 % of those bytes were wasted egress.
--
-- After: PostgREST returns the histogram directly (≤ WINDOW_DAYS * 3 = 90
-- rows per render). Same chart, ~1/250th the payload.
--
-- The zone mapping below MUST stay in sync with `BIAS_TO_ZONE` in
-- `src/lib/bias/config.ts`. If you add/rename a BiasCategory, update both.

create or replace view trends_daily_bias_counts as
select
  -- Truncate to UTC day so the key matches the `YYYY-MM-DD` slice used by
  -- the TS bucket builder. timestamptz → (utc) timestamp → date.
  (date_trunc('day', a.created_at at time zone 'utc'))::date as day,
  case s.bias
    when 'pro_government'        then 'iktidar'
    when 'gov_leaning'           then 'iktidar'
    when 'state_media'           then 'iktidar'
    when 'islamist_conservative' then 'iktidar'
    when 'nationalist'           then 'iktidar'
    when 'center'                then 'bagimsiz'
    when 'international'         then 'bagimsiz'
    when 'pro_kurdish'           then 'bagimsiz'
    when 'opposition_leaning'    then 'muhalefet'
    when 'opposition'            then 'muhalefet'
  end as zone,
  count(*)::int as count
from articles a
join sources s on s.id = a.source_id
group by 1, 2;

comment on view trends_daily_bias_counts is
  'Daily article counts per Medya DNA zone. Powers /trends. Keep zone '
  'mapping in sync with BIAS_TO_ZONE in src/lib/bias/config.ts.';

-- PostgREST needs explicit grants to expose a view. RLS on the underlying
-- `articles` and `sources` tables still governs what rows are visible —
-- this grant just allows the roles to read the aggregated projection.
grant select on trends_daily_bias_counts to anon, authenticated, service_role;
