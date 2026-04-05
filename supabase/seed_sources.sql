-- Seed Turkish news sources with bias labels and RSS URLs
-- Run this after creating the sources table

insert into sources (name, slug, url, rss_url, bias) values
  -- Pro-government sources
  ('Sabah', 'sabah', 'https://www.sabah.com.tr', 'https://www.sabah.com.tr/rss/anasayfa.xml', 'pro_government'),
  ('Yeni Şafak', 'yeni-safak', 'https://www.yenisafak.com', 'https://www.yenisafak.com/rss', 'pro_government'),
  ('Star', 'star', 'https://www.star.com.tr', 'https://www.star.com.tr/rss/rss.asp', 'pro_government'),
  ('A Haber', 'a-haber', 'https://www.ahaber.com.tr', 'https://www.ahaber.com.tr/rss/anasayfa.xml', 'pro_government'),
  ('TRT Haber', 'trt-haber', 'https://www.trthaber.com', 'https://www.trthaber.com/sondakika.rss', 'pro_government'),

  -- Opposition / secular sources
  ('Sözcü', 'sozcu', 'https://www.sozcu.com.tr', 'https://www.sozcu.com.tr/rss/tum-haberler.xml', 'opposition'),
  ('Cumhuriyet', 'cumhuriyet', 'https://www.cumhuriyet.com.tr', 'https://www.cumhuriyet.com.tr/rss', 'opposition'),
  ('Halk TV', 'halk-tv', 'https://halktv.com.tr', 'https://halktv.com.tr/service/rss.php', 'opposition'),
  ('Tele1', 'tele1', 'https://tele1.com.tr', 'https://tele1.com.tr/feed/', 'opposition'),

  -- Independent / digital-native sources
  ('Medyascope', 'medyascope', 'https://medyascope.tv', 'https://medyascope.tv/feed/', 'independent'),
  ('T24', 't24', 'https://t24.com.tr', 'https://t24.com.tr/rss', 'independent'),
  ('Bianet', 'bianet', 'https://bianet.org', 'https://bianet.org/rss/bianet', 'independent'),
  ('Diken', 'diken', 'https://www.diken.com.tr', 'https://www.diken.com.tr/feed/', 'independent')
on conflict (slug) do nothing;
