-- Demo stories with hand-placed stances for the surprise-detection showcase.
-- Run after seed_sources.sql so source slugs exist.

-- 1) Predictable story: no surprises expected
insert into stories (slug, title_tr, summary_tr, display_order) values
  ('merkez-bankasi-faiz', 'Merkez Bankası faiz kararını 250 baz puan indirdi',
   'TCMB politika faizini yüzde 47,5''ten yüzde 45''e çekti. Pro-government outlets karara destek verirken muhalefet eleştirel yaklaştı. Alışılmış kamplaşma.', 0),
  ('suriye-sinir-operasyonu', 'Türk Silahlı Kuvvetleri Suriye''de yeni sınır operasyonu başlattı',
   'TSK, kuzey Suriye''de PKK/YPG hedeflerine yönelik hava ve kara harekatı başlattı. Milliyetçi muhalefet bile hükümetin yanında saf tuttu — Sözcü gibi tipik olarak eleştirel outletler bu kez destekleyici.', 1),
  ('afad-deprem-elestirileri', 'Deprem sonrası AFAD''a yönelik eleştiriler artıyor',
   'Depremin ilk 48 saatinde AFAD''ın koordinasyon eksikliği ve yardım malzemelerinin geç ulaşması tartışma yarattı. Bazı hükümet yanlısı outletler alışılmadık biçimde eleştirel bir tona büründü.', 2)
on conflict (slug) do update set
  title_tr = excluded.title_tr,
  summary_tr = excluded.summary_tr,
  display_order = excluded.display_order;

-- Wipe and reinsert stances so re-runs are clean
delete from story_stances where story_id in (
  select id from stories where slug in ('merkez-bankasi-faiz', 'suriye-sinir-operasyonu', 'afad-deprem-elestirileri')
);

-- ───────── STORY 1: Merkez Bankası faiz (PREDICTABLE) ─────────
insert into story_stances (story_id, source_id, stance, note)
select s.id, src.id, v.stance, v.note
from stories s
cross join lateral (values
  -- Pro-gov: supportive as expected
  ('sabah', 'destekliyor', 'Faiz indirimi ekonomiye nefes aldıracak'),
  ('a-haber', 'destekliyor', 'Kararlı ekonomi yönetimi'),
  ('yeni-safak', 'destekliyor', 'Enflasyonla mücadelede yeni aşama'),
  ('star', 'destekliyor', null),
  ('takvim', 'destekliyor', null),
  ('turkiye-gazetesi', 'destekliyor', null),
  -- State media: neutral/supportive
  ('trt-haber', 'tarafsiz', 'Kararın detayları'),
  ('anadolu-ajansi', 'tarafsiz', 'TCMB açıklaması'),
  ('daily-sabah', 'destekliyor', null),
  -- Gov-leaning: neutral-ish
  ('haberturk', 'tarafsiz', null),
  ('hurriyet', 'tarafsiz', null),
  ('cnn-turk', 'tarafsiz', null),
  ('ntv', 'tarafsiz', null),
  ('milliyet', 'tarafsiz', null),
  -- Center: neutral analysis
  ('t24', 'tarafsiz', 'Piyasa reaksiyonu karışık'),
  ('gazete-duvar', 'tarafsiz', null),
  ('karar', 'tarafsiz', null),
  ('ekonomim', 'tarafsiz', 'Ekonomist görüşleri'),
  ('bloomberg-ht', 'tarafsiz', null),
  -- Opposition-leaning: critical as expected
  ('sozcu', 'elestiriyor', 'Halkın alım gücü düşerken faiz indirimi kime yaradı?'),
  ('cumhuriyet', 'elestiriyor', 'Enflasyon hâlâ yüksek, karar erken'),
  ('halk-tv', 'elestiriyor', null),
  ('tele1', 'elestiriyor', null),
  -- Opposition: highly critical
  ('birgun', 'elestiriyor', 'Sermaye lehine karar'),
  ('evrensel', 'elestiriyor', null),
  -- Nationalist: neutral
  ('yenicag', 'tarafsiz', null),
  ('aydinlik', 'tarafsiz', null),
  -- Islamist: supportive of government
  ('milli-gazete', 'destekliyor', null),
  -- International: neutral
  ('bbc-turkce', 'tarafsiz', null),
  ('dw-turkce', 'tarafsiz', null),
  ('euronews-turkce', 'tarafsiz', null)
) as v(slug, stance, note)
join sources src on src.slug = v.slug
where s.slug = 'merkez-bankasi-faiz';

-- ───────── STORY 2: Suriye sınır operasyonu (SURPRISES EXPECTED) ─────────
insert into story_stances (story_id, source_id, stance, note)
select s.id, src.id, v.stance, v.note
from stories s
cross join lateral (values
  -- Pro-gov: supportive as expected
  ('sabah', 'destekliyor', 'Kahraman Mehmetçik teröre geçit vermiyor'),
  ('a-haber', 'destekliyor', null),
  ('yeni-safak', 'destekliyor', null),
  ('star', 'destekliyor', null),
  ('takvim', 'destekliyor', null),
  ('turkiye-gazetesi', 'destekliyor', null),
  -- State media: supportive
  ('trt-haber', 'destekliyor', null),
  ('anadolu-ajansi', 'destekliyor', null),
  ('daily-sabah', 'destekliyor', null),
  -- Gov-leaning: supportive
  ('haberturk', 'destekliyor', null),
  ('hurriyet', 'destekliyor', null),
  ('cnn-turk', 'destekliyor', null),
  ('ntv', 'destekliyor', null),
  ('milliyet', 'destekliyor', null),
  -- Center: neutral
  ('t24', 'tarafsiz', 'Operasyonun sahadaki sonuçları'),
  ('gazete-duvar', 'tarafsiz', null),
  ('karar', 'tarafsiz', null),
  ('bbc-turkce', 'tarafsiz', null),
  ('dw-turkce', 'tarafsiz', null),
  -- ⚡ SURPRISE: opposition-leaning outlets supporting!
  ('sozcu', 'destekliyor', 'Terörle mücadelede tam destek — normalde hükümeti eleştiren Sözcü bu kez yanında'),
  ('cumhuriyet', 'destekliyor', 'Ulusal birlik vurgusu'),
  -- Opposition: still neutral/critical
  ('halk-tv', 'tarafsiz', null),
  ('tele1', 'elestiriyor', 'Operasyonun siyasi zamanlaması şüpheli'),
  ('birgun', 'elestiriyor', 'Savaş politikalarına karşı'),
  ('evrensel', 'elestiriyor', null),
  -- Nationalist: strong support
  ('yenicag', 'destekliyor', null),
  ('aydinlik', 'destekliyor', null),
  ('benguturk', 'destekliyor', null),
  -- Islamist: supportive
  ('milli-gazete', 'destekliyor', null),
  -- Pro-Kurdish: critical
  ('rudaw-turkce', 'elestiriyor', 'Kuzey Suriye''de sivil kayıp endişesi'),
  -- International: neutral coverage
  ('euronews-turkce', 'tarafsiz', null)
) as v(slug, stance, note)
join sources src on src.slug = v.slug
where s.slug = 'suriye-sinir-operasyonu';

-- ───────── STORY 3: AFAD eleştirileri (SURPRISES EXPECTED) ─────────
insert into story_stances (story_id, source_id, stance, note)
select s.id, src.id, v.stance, v.note
from stories s
cross join lateral (values
  -- Pro-gov: mostly defensive, but some surprises
  ('sabah', 'destekliyor', 'AFAD sahada 7/24 çalışıyor'),
  ('a-haber', 'destekliyor', null),
  ('yeni-safak', 'destekliyor', null),
  ('star', 'tarafsiz', null),
  -- ⚡ SURPRISE: Takvim (pro-gov tabloid) going critical
  ('takvim', 'elestiriyor', 'Koordinasyon sorunu kabul edilmeli — tabloid bile kabul ediyor'),
  -- ⚡ SURPRISE: Türkiye Gazetesi staying silent
  ('turkiye-gazetesi', 'sessiz', 'Haberi görmezden geldi'),
  -- State media: silent / minimal
  ('trt-haber', 'tarafsiz', 'Resmi açıklamalar'),
  ('anadolu-ajansi', 'tarafsiz', null),
  ('daily-sabah', 'destekliyor', null),
  -- Gov-leaning: mixed
  ('haberturk', 'tarafsiz', null),
  ('hurriyet', 'elestiriyor', 'Yardımlar neden geç ulaştı?'),
  ('cnn-turk', 'tarafsiz', null),
  ('ntv', 'tarafsiz', null),
  ('milliyet', 'tarafsiz', null),
  -- Center: critical analysis
  ('t24', 'elestiriyor', 'Saha raporları eksikliği ortaya koyuyor'),
  ('gazete-duvar', 'elestiriyor', null),
  ('karar', 'elestiriyor', null),
  ('bianet', 'elestiriyor', null),
  ('diken', 'elestiriyor', null),
  -- Opposition-leaning: highly critical
  ('sozcu', 'elestiriyor', 'AFAD yönetimi sorumlu'),
  ('cumhuriyet', 'elestiriyor', null),
  ('halk-tv', 'elestiriyor', null),
  ('tele1', 'elestiriyor', null),
  -- Opposition: brutal
  ('birgun', 'elestiriyor', 'Devletin iflası'),
  ('evrensel', 'elestiriyor', null),
  -- Nationalist: critical of AFAD leadership
  ('yenicag', 'elestiriyor', null),
  -- Islamist: defensive
  ('milli-gazete', 'destekliyor', null),
  -- International: critical coverage
  ('bbc-turkce', 'elestiriyor', null),
  ('dw-turkce', 'elestiriyor', null),
  ('euronews-turkce', 'tarafsiz', null)
) as v(slug, stance, note)
join sources src on src.slug = v.slug
where s.slug = 'afad-deprem-elestirileri';
