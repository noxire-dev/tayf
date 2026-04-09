-- Expand bias categories from 3 to 10 to match the full Turkish media landscape

alter table sources drop constraint if exists sources_bias_check;
alter table sources add constraint sources_bias_check
  check (bias in (
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
  ));

-- Migrate old 'independent' rows to 'center' (same meaning, new name)
update sources set bias = 'center' where bias = 'independent';
