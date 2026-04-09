-- 018: Decode stray HTML entities in existing article titles, descriptions,
-- and cluster title_tr. Some RSS feeds (haberler.com especially) double-encode:
-- the raw feed contains `&amp;apos;`, rss-parser decodes `&amp;` → `&`, and
-- the literal string `&apos;` ends up in the DB. This one-shot pass cleans
-- the ~1,844 articles + ~422 clusters already affected. Going forward, the
-- rss-worker + src/lib/rss/normalize.ts now run a second decode pass on ingest.

-- Articles: title
update articles set title = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(title,
                '&amp;', '&', 'g'),
              '&lt;', '<', 'g'),
            '&gt;', '>', 'g'),
          '&quot;', '"', 'g'),
        '&apos;', '''', 'g'),
      '&#39;', '''', 'g'),
    '&#34;', '"', 'g'),
  '&nbsp;', ' ', 'g')
where title ~ '&(amp|lt|gt|quot|apos|nbsp|#34|#39);';

-- Articles: description
update articles set description = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(description,
                '&amp;', '&', 'g'),
              '&lt;', '<', 'g'),
            '&gt;', '>', 'g'),
          '&quot;', '"', 'g'),
        '&apos;', '''', 'g'),
      '&#39;', '''', 'g'),
    '&#34;', '"', 'g'),
  '&nbsp;', ' ', 'g')
where description is not null and description ~ '&(amp|lt|gt|quot|apos|nbsp|#34|#39);';

-- Clusters: title_tr (the cluster inherits its seed article's title, so it
-- has the same pollution pattern)
update clusters set title_tr = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(title_tr,
                '&amp;', '&', 'g'),
              '&lt;', '<', 'g'),
            '&gt;', '>', 'g'),
          '&quot;', '"', 'g'),
        '&apos;', '''', 'g'),
      '&#39;', '''', 'g'),
    '&#34;', '"', 'g'),
  '&nbsp;', ' ', 'g')
where title_tr ~ '&(amp|lt|gt|quot|apos|nbsp|#34|#39);';

-- Clusters: summary_tr (same treatment)
update clusters set summary_tr = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(summary_tr,
                '&amp;', '&', 'g'),
              '&lt;', '<', 'g'),
            '&gt;', '>', 'g'),
          '&quot;', '"', 'g'),
        '&apos;', '''', 'g'),
      '&#39;', '''', 'g'),
    '&#34;', '"', 'g'),
  '&nbsp;', ' ', 'g')
where summary_tr ~ '&(amp|lt|gt|quot|apos|nbsp|#34|#39);';
