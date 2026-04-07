-- Seed Turkish news sources with alignment, tradition, and source_type
-- Run this after migrations. Sports and unverified sources default to inactive.
--
-- alignment:  pro_government | gov_leaning | center | opposition_leaning | opposition
-- tradition:  mainstream | islamist | nationalist | secular | left | kurdish | state | international
-- source_type: general | sports | finance | niche

insert into sources (name, slug, url, rss_url, alignment, tradition, source_type, active) values

  -- ═══════════════════════════════════════════════════════════════
  -- PRO-GOVERNMENT
  -- ═══════════════════════════════════════════════════════════════
  ('Sabah',             'sabah',            'https://www.sabah.com.tr',          'https://www.sabah.com.tr/rss/gundem.xml',                  'pro_government', 'mainstream',  'general', true),
  ('A Haber',           'a-haber',          'https://www.ahaber.com.tr',         'https://www.ahaber.com.tr/rss/gundem.xml',                 'pro_government', 'mainstream',  'general', true),
  ('Yeni Şafak',        'yeni-safak',       'https://www.yenisafak.com',         'https://www.yenisafak.com/rss?xml=gundem',                 'pro_government', 'islamist',    'general', true),
  ('Yeni Akit',         'yeni-akit',        'https://www.yeniakit.com.tr',       'https://www.yeniakit.com.tr/rss/haber/gundem',             'pro_government', 'islamist',    'general', true),
  ('Star',              'star',             'https://www.star.com.tr',           'http://www.star.com.tr/rss/sondakika.xml',                 'pro_government', 'mainstream',  'general', true),
  ('Takvim',            'takvim',           'https://www.takvim.com.tr',         'https://www.takvim.com.tr/rss/anasayfa.xml',               'pro_government', 'mainstream',  'general', true),
  ('Diriliş Postası',   'dirilis-postasi',  'https://www.dirilispostasi.com',    'https://www.dirilispostasi.com/rss',                       'pro_government', 'islamist',    'general', true),
  ('Türkiye Gazetesi',  'turkiye-gazetesi', 'https://www.turkiyegazetesi.com.tr','https://www.turkiyegazetesi.com.tr/rss/rss.xml',           'pro_government', 'mainstream',  'general', true),
  ('GZT',               'gzt',              'https://www.gzt.com',               'https://www.gzt.com/rss',                                  'pro_government', 'islamist',    'general', true),
  ('Vahdet',            'vahdet',           'https://www.vahdet.com.tr',         'https://www.vahdet.com.tr/rss',                            'pro_government', 'islamist',    'general', false),
  ('Yenisöz',           'yenisoz',          'https://www.yenisoz.com.tr',        'https://www.yenisoz.com.tr/rss',                           'pro_government', 'mainstream',  'general', false),
  ('İstiklal',          'istiklal',         'https://www.istiklal.com.tr',       'https://www.istiklal.com.tr/rss',                          'pro_government', 'nationalist', 'general', false),

  -- ═══════════════════════════════════════════════════════════════
  -- GOV-LEANING
  -- ═══════════════════════════════════════════════════════════════
  ('Habertürk',         'haberturk',        'https://www.haberturk.com',         'https://www.haberturk.com/rss',                            'gov_leaning', 'mainstream',  'general', true),
  ('Hürriyet',          'hurriyet',         'https://www.hurriyet.com.tr',       'https://www.hurriyet.com.tr/rss/anasayfa',                 'gov_leaning', 'mainstream',  'general', true),
  ('Milliyet',          'milliyet',         'https://www.milliyet.com.tr',       'http://www.milliyet.com.tr/rss/rssNew/gundemRss.xml',      'gov_leaning', 'mainstream',  'general', true),
  ('CNN Türk',          'cnn-turk',         'https://www.cnnturk.com',           'https://www.cnnturk.com/feed/rss/all/news',                'gov_leaning', 'mainstream',  'general', true),
  ('NTV',               'ntv',              'https://www.ntv.com.tr',            'https://www.ntv.com.tr/gundem.rss',                        'gov_leaning', 'mainstream',  'general', true),
  ('Posta',             'posta',            'https://www.posta.com.tr',          'http://www.posta.com.tr/xml/rss/rss_3_0.xml',              'gov_leaning', 'mainstream',  'general', true),
  ('Akşam',             'aksam',            'https://www.aksam.com.tr',          'https://www.aksam.com.tr/rss/rss.asp',                     'gov_leaning', 'mainstream',  'general', true),
  ('Güneş',             'gunes',            'https://www.gunes.com',             'https://www.gunes.com/rss',                                'gov_leaning', 'mainstream',  'general', false),
  ('Yeni Asır',         'yeni-asir',        'https://www.yeniasir.com.tr',       'https://www.yeniasir.com.tr/rss/anasayfa.xml',             'gov_leaning', 'mainstream',  'general', true),
  ('Milat',             'milat',            'https://www.milatgazetesi.com',     'http://www.milatgazetesi.com/rss.php',                     'gov_leaning', 'islamist',    'general', true),
  ('Şok',               'sok',              'https://www.sok.com.tr',            'https://www.sok.com.tr/rss',                               'gov_leaning', 'mainstream',  'general', false),
  ('En Son Haber',      'en-son-haber',     'https://www.ensonhaber.com',        'https://www.ensonhaber.com/rss/ensonhaber.xml',            'gov_leaning', 'mainstream',  'general', true),
  ('Mynet',             'mynet',            'https://www.mynet.com',             'https://www.mynet.com/haber/rss/sondakika',                'gov_leaning', 'mainstream',  'general', true),
  ('Haber Global',      'haber-global',     'https://haberglobal.com.tr',        'https://haberglobal.com.tr/rss',                           'gov_leaning', 'mainstream',  'general', true),
  ('İnternet Haber',    'internet-haber',   'https://www.internethaber.com',     'https://www.internethaber.com/rss',                        'gov_leaning', 'mainstream',  'general', true),
  ('Haber7',            'haber7',           'https://www.haber7.com',            'https://i12.haber7.net/sondakika/newsstand/latest.xml',    'gov_leaning', 'mainstream',  'general', true),
  ('TGRT Haber',        'tgrt-haber',       'https://www.tgrthaber.com.tr',      'http://www.tgrthaber.com.tr/feed/index.rss',               'gov_leaning', 'mainstream',  'general', false),
  ('Haberler.com',      'haberler-com',     'https://www.haberler.com',          'https://rss.haberler.com/RssNew.aspx',                     'gov_leaning', 'mainstream',  'general', true),
  ('DHA',               'dha',              'https://www.dha.com.tr',            'http://www.dha.com.tr/rss.asp',                            'gov_leaning', 'mainstream',  'general', false),
  ('İHA',               'iha',              'https://www.iha.com.tr',            'http://www.iha.com.tr/rss.aspx',                           'gov_leaning', 'mainstream',  'general', false),

  -- ═══════════════════════════════════════════════════════════════
  -- STATE MEDIA
  -- ═══════════════════════════════════════════════════════════════
  ('Anadolu Ajansı',    'anadolu-ajansi',   'https://www.aa.com.tr',             'https://www.aa.com.tr/tr/rss/default?cat=guncel',          'pro_government', 'state', 'general', true),
  ('TRT Haber',         'trt-haber',        'https://www.trthaber.com',          'http://www.trthaber.com/sondakika.rss',                    'pro_government', 'state', 'general', true),
  ('TRT World',         'trt-world',        'https://www.trtworld.com',          'https://www.trtworld.com/news/rss',                        'pro_government', 'state', 'general', true),
  ('A News',            'a-news',           'https://www.anews.com.tr',          'https://www.anews.com.tr/rss/news.xml',                    'pro_government', 'state', 'general', true),
  ('Daily Sabah',       'daily-sabah',      'https://www.dailysabah.com',        'https://www.dailysabah.com/rss/home-page',                 'pro_government', 'mainstream', 'general', true),

  -- ═══════════════════════════════════════════════════════════════
  -- CENTER / INDEPENDENT
  -- ═══════════════════════════════════════════════════════════════
  ('T24',               't24',              'https://t24.com.tr',                'https://t24.com.tr/rss',                                   'center', 'mainstream',  'general', true),
  ('Diken',             'diken',            'https://www.diken.com.tr',          'https://www.diken.com.tr/feed/',                           'center', 'mainstream',  'general', true),
  ('Medyascope',        'medyascope',       'https://medyascope.tv',             'https://medyascope.tv/feed/',                              'center', 'mainstream',  'general', true),
  ('Journo',            'journo',           'https://journo.com.tr',             'https://journo.com.tr/feed',                               'center', 'mainstream',  'general', true),
  ('Gazete Duvar',      'gazete-duvar',     'https://www.gazeteduvar.com.tr',    'https://www.gazeteduvar.com.tr/export/rss',                'center', 'mainstream',  'general', true),
  ('Bianet',            'bianet',           'https://bianet.org',                'https://bianet.org/biamag.rss',                            'center', 'mainstream',  'general', true),
  ('Independent Türkçe','indyturk',         'https://www.indyturk.com',          'https://www.indyturk.com/rss.xml',                         'center', 'mainstream',  'general', true),
  ('Karar',             'karar',            'https://www.karar.com',             'https://www.karar.com/service/rss.php',                    'center', 'islamist',    'general', true),
  ('Dokuz8 Haber',      'dokuz8-haber',     'https://www.dokuz8haber.net',       'https://www.dokuz8haber.net/rss',                          'center', 'mainstream',  'general', true),
  ('Fayn',              'fayn',             'https://www.fayn.press',            'https://www.fayn.press/rss/',                              'center', 'mainstream',  'general', true),
  ('Gazete Oksijen',    'gazete-oksijen',   'https://gazeteoksijen.com',         'https://gazeteoksijen.com/export/rss',                     'center', 'mainstream',  'general', true),
  ('Gazete Pencere',    'gazete-pencere',   'https://www.gazetepencere.com',     'https://www.gazetepencere.com/service/rss.php',            'center', 'mainstream',  'general', true),
  ('Gerçek Gündem',     'gercek-gundem',    'https://www.gercekgundem.com',      'https://www.gercekgundem.com/rss',                         'center', 'mainstream',  'general', true),
  ('Onedio',            'onedio',           'https://onedio.com',                'https://onedio.com/Publisher/publisher-gundem.rss',         'center', 'mainstream',  'general', true),
  ('Habervakti',        'habervakti',       'https://www.habervakti.com',        'https://www.habervakti.com/rss',                           'center', 'mainstream',  'general', true),
  ('F5 Haber',          'f5-haber',         'https://www.f5haber.com',           'https://www.f5haber.com/export/rss',                       'center', 'mainstream',  'general', true),
  ('Platform 24',       'platform-24',      'https://platform24.org',            'http://platform24.org/rss',                                'center', 'mainstream',  'niche',   false),
  ('Açık Gazete',       'acik-gazete',      'https://www.acikgazete.com',        'https://www.acikgazete.com/feed/',                         'center', 'mainstream',  'general', true),
  ('Ajans Haber',       'ajans-haber',      'https://www.ajanshaber.com',        'https://www.ajanshaber.com/rss',                           'center', 'mainstream',  'general', true),
  ('Haber3',            'haber3',           'https://www.haber3.com',            'https://www.haber3.com/rss',                               'center', 'mainstream',  'general', true),
  ('Son Dakika',        'son-dakika',       'https://www.sondakika.com',         'http://rss.sondakika.com/rss_standart.asp',                'center', 'mainstream',  'general', false),
  ('Beyaz Gazete',      'beyaz-gazete',     'https://beyazgazete.com',           'https://beyazgazete.com/rss/guncel.xml',                   'center', 'mainstream',  'general', true),
  ('Doğru Haber',       'dogru-haber',      'https://dogruhaber.com.tr',         'https://dogruhaber.com.tr/rss',                            'center', 'islamist',    'general', true),
  ('Dijital Gaste',     'dijital-gaste',    'https://www.dijitalgaste.com',      'https://www.dijitalgaste.com/rss',                         'center', 'mainstream',  'general', true),
  ('dikGAZETE',         'dikgazete',        'https://www.dikgazete.com',         'https://www.dikgazete.com/xml/rss.xml',                    'center', 'mainstream',  'general', true),
  ('Gazete.net',        'gazete-net',       'https://gazete.net',                'https://gazete.net/rss',                                   'center', 'mainstream',  'general', true),
  ('Haberport',         'haberport',        'https://www.haberport.com',         'https://www.haberport.com/rss/latest-posts',               'center', 'mainstream',  'general', true),
  ('Bir Gazete',        'bir-gazete',       'https://www.birgazete.com',         'https://www.birgazete.com/feed',                           'center', 'mainstream',  'general', true),
  ('ABC Haber',         'abc-haber',        'https://abcgazetesi.com.tr',        'https://abcgazetesi.com.tr/rss',                           'center', 'mainstream',  'general', true),
  ('10Haber',           'on-haber',         'https://10haber.net',               'https://10haber.net/feed/',                                'center', 'mainstream',  'general', true),
  ('Aykırı',            'aykiri',           'https://www.aykiri.com.tr',         'https://www.aykiri.com.tr/rss.xml',                        'center', 'mainstream',  'general', true),
  ('Ayandon',           'ayandon',          'https://www.ayandon.com.tr',        'https://www.ayandon.com.tr/rss.xml',                       'center', 'mainstream',  'general', true),
  ('Haberet',           'haberet',          'https://www.haberet.com',           'https://www.haberet.com/export/rss',                       'center', 'mainstream',  'general', true),
  ('Haber.com',         'haber-com',        'https://www.haber.com',             'https://www.haber.com/rss',                                'center', 'mainstream',  'general', true),
  ('İşin Detayı',       'isin-detayi',      'https://www.isindetayi.com',        'https://www.isindetayi.com/rss/gundem',                    'center', 'mainstream',  'general', true),
  ('Kamudanhaber',      'kamudanhaber',     'https://www.kamudanhaber.net',      'https://www.kamudanhaber.net/rss',                         'center', 'mainstream',  'niche',   true),
  ('Türkiye Haber Ajansı','turkiye-haber-ajansi','https://www.turkiyehaberajansi.com','http://www.turkiyehaberajansi.com/rss.xml',           'center', 'mainstream',  'general', true),
  ('Ay Gazete',         'ay-gazete',        'https://www.aygazete.com',          'http://www.aygazete.com/rss/gundem-haberleri',             'center', 'mainstream',  'general', false),
  ('Haberiniz',         'haberiniz',        'https://haberiniz.com.tr',          'https://haberiniz.com.tr/feed/',                           'center', 'mainstream',  'general', true),

  -- ═══════════════════════════════════════════════════════════════
  -- OPPOSITION-LEANING
  -- ═══════════════════════════════════════════════════════════════
  ('Sözcü',             'sozcu',            'https://www.sozcu.com.tr',          'https://www.sozcu.com.tr/feeds-rss-category-sozcu',        'opposition_leaning', 'secular',    'general', true),
  ('Cumhuriyet',        'cumhuriyet',       'https://www.cumhuriyet.com.tr',     'https://www.cumhuriyet.com.tr/rss/son_dakika.xml',         'opposition_leaning', 'secular',    'general', true),
  ('Halk TV',           'halk-tv',          'https://halktv.com.tr',             'https://halktv.com.tr/service/rss.php',                    'opposition_leaning', 'secular',    'general', true),
  ('Tele1',             'tele1',            'https://www.tele1.com.tr',          'https://www.tele1.com.tr/rss',                             'opposition_leaning', 'secular',    'general', true),
  ('Korkusuz',          'korkusuz',         'https://www.korkusuz.com.tr',       'https://www.korkusuz.com.tr/feeds/rss',                    'opposition_leaning', 'secular',    'general', true),
  ('Artı Gerçek',       'arti-gercek',      'https://artigercek.com',            'https://artigercek.com/service/rss.php',                   'opposition_leaning', 'mainstream', 'general', true),
  ('Kısa Dalga',        'kisa-dalga',       'https://kisadalga.net',             'https://kisadalga.net/service/rss.php',                    'opposition_leaning', 'mainstream', 'general', true),
  ('Demokrat Haber',    'demokrat-haber',   'https://www.demokrathaber.org',     'https://www.demokrathaber.org/rss',                        'opposition_leaning', 'mainstream', 'general', true),
  ('OdaTV',             'odatv',            'https://www.odatv.com',             'https://www.odatv.com/rss.xml',                            'opposition_leaning', 'nationalist','general', true),
  ('KRT TV',            'krt-tv',           'https://www.krttv.com.tr',          'https://www.krttv.com.tr/rss',                             'opposition_leaning', 'secular',    'general', true),
  ('Artı Bir TV',       'arti-bir-tv',      'https://www.haberartibir.com.tr',   'http://www.haberartibir.com.tr/rss.php',                   'opposition_leaning', 'mainstream', 'general', false),
  ('İleri Haber',       'ileri-haber',      'https://ilerihaber.org',            'http://ilerihaber.org/rss.xml',                            'opposition_leaning', 'mainstream', 'general', false),
  ('En Politik',        'en-politik',       'https://www.enpolitik.com',         'https://www.enpolitik.com/rss.xml',                        'opposition_leaning', 'mainstream', 'general', true),
  ('Medya Gazete',      'medya-gazete',     'https://www.medyagazete.com',       'https://www.medyagazete.com/rss/genel-0',                  'opposition_leaning', 'mainstream', 'general', true),
  ('Muhalif',           'muhalif',          'https://www.muhalif.com.tr',        'https://www.muhalif.com.tr/rss/genel-0',                   'opposition_leaning', 'mainstream', 'general', true),
  ('Elips Haber',       'elips-haber',      'https://www.elipshaber.com',        'https://www.elipshaber.com/rss',                           'opposition_leaning', 'mainstream', 'general', true),

  -- ═══════════════════════════════════════════════════════════════
  -- OPPOSITION
  -- ═══════════════════════════════════════════════════════════════
  ('BirGün',            'birgun',           'https://www.birgun.net',            'https://www.birgun.net/rss/home',                          'opposition', 'left',       'general', true),
  ('Evrensel',          'evrensel',         'https://www.evrensel.net',          'https://www.evrensel.net/rss/haber.xml',                   'opposition', 'left',       'general', true),
  ('Serbestiyet',       'serbestiyet',      'https://serbestiyet.com',           'https://serbestiyet.com/feed/',                            'opposition', 'mainstream', 'general', true),
  ('Agos',              'agos',             'https://www.agos.com.tr',           'https://www.agos.com.tr/rss',                              'opposition', 'mainstream', 'general', true),
  ('Sol Haber',         'sol-haber',        'https://haber.sol.org.tr',          'http://haber.sol.org.tr/rss.xml',                          'opposition', 'left',       'general', false),
  ('Sendika.Org',       'sendika-org',      'https://sendika.org',               'http://haberss.org/dosya/rss/sendika.org',                 'opposition', 'left',       'niche',   false),
  ('Ekol TV',           'ekol-tv',          'https://www.ekoltv.com.tr',         'https://www.ekoltv.com.tr/service/rss.php',                'opposition', 'left',       'general', true),
  ('İşçi Haber',        'isci-haber',       'https://www.iscihaber.net',         'https://www.iscihaber.net/rss/news',                       'opposition', 'left',       'niche',   true),

  -- ═══════════════════════════════════════════════════════════════
  -- NATIONALIST
  -- ═══════════════════════════════════════════════════════════════
  ('Yeniçağ',           'yenicag',          'https://www.yenicaggazetesi.com.tr','http://www.yenicaggazetesi.com.tr/rss',                    'opposition_leaning', 'nationalist', 'general', true),
  ('Aydınlık',          'aydinlik',         'https://www.aydinlik.com.tr',       'https://www.aydinlik.com.tr/feed',                         'gov_leaning',        'nationalist', 'general', true),
  ('Ortadoğu',          'ortadogu',         'https://www.ortadogugazetesi.com',  'https://www.ortadogugazetesi.com/rss',                     'gov_leaning',        'nationalist', 'general', false),
  ('Ulusal Kanal',      'ulusal-kanal',     'https://www.ulusalkanal.com.tr',    'http://www.ulusalkanal.com.tr/rss.php',                    'gov_leaning',        'nationalist', 'general', false),
  ('Bengütürk',         'benguturk',        'https://www.benguturk.com',         'https://www.benguturk.com/rss',                            'center',             'nationalist', 'general', true),

  -- ═══════════════════════════════════════════════════════════════
  -- ISLAMIST / CONSERVATIVE (opposition-side)
  -- ═══════════════════════════════════════════════════════════════
  ('Milli Gazete',      'milli-gazete',     'https://www.milligazete.com.tr',    'https://www.milligazete.com.tr/rss',                       'opposition_leaning', 'islamist', 'general', true),
  ('Yeni Asya',         'yeni-asya',        'https://www.yeniasya.com.tr',       'https://www.yeniasya.com.tr/rss',                          'opposition_leaning', 'islamist', 'general', false),
  ('Yeni Mesaj',        'yeni-mesaj',       'https://www.yenimesaj.com.tr',      'http://www.yenimesaj.com.tr/rss.php',                      'opposition_leaning', 'islamist', 'general', true),
  ('Diyanet Haber',     'diyanet-haber',    'https://www.diyanethaber.com.tr',   'https://www.diyanethaber.com.tr/rss',                      'gov_leaning',        'islamist', 'niche',   true),
  ('İlke TV',           'ilke-tv',          'https://ilketv.com.tr',             'https://ilketv.com.tr/feed/',                              'opposition_leaning', 'islamist', 'general', true),

  -- ═══════════════════════════════════════════════════════════════
  -- PRO-KURDISH
  -- ═══════════════════════════════════════════════════════════════
  ('Mezopotamya Ajansı','mezopotamya',      'https://mezopotamyaajansi43.com',   'https://mezopotamyaajansi43.com/feed/',                    'opposition', 'kurdish', 'general', false),
  ('BHA',               'bha',              'https://bha.net.tr',                'https://bha.net.tr/rss',                                   'opposition', 'kurdish', 'general', true),
  ('Rûdaw Türkçe',      'rudaw-turkce',     'https://rudaw.net',                 'http://rudaw.net/turkish/rss?type=top',                    'center',     'kurdish', 'general', true),

  -- ═══════════════════════════════════════════════════════════════
  -- INTERNATIONAL
  -- ═══════════════════════════════════════════════════════════════
  ('BBC Türkçe',        'bbc-turkce',       'https://www.bbc.com/turkce',        'https://feeds.bbci.co.uk/turkce/rss.xml',                  'center', 'international', 'general', true),
  ('DW Türkçe',         'dw-turkce',        'https://www.dw.com/tr',             'https://rss.dw.com/rdf/rss-tur-all',                       'center', 'international', 'general', true),
  ('Euronews Türkçe',   'euronews-turkce',  'https://tr.euronews.com',           'https://tr.euronews.com/rss',                              'center', 'international', 'general', true),
  ('VOA Türkçe',        'voa-turkce',       'https://www.voaturkce.com',         'https://www.voaturkce.com/api/zr$ymetqvi',                 'center', 'international', 'general', false),
  ('Sputnik Türkçe',    'sputnik-turkce',   'https://tr.sputniknews.com',        'https://tr.sputniknews.com/export/rss2/archive/index.xml', 'center', 'international', 'general', true),
  ('CGTN Türk',         'cgtn-turk',        'https://www.cgtnturk.com',          'https://www.cgtnturk.com/rss',                             'center', 'international', 'general', true),
  ('Al Ain Türkçe',     'al-ain-turkce',    'https://tr.al-ain.com',             'https://tr.al-ain.com/feed',                               'center', 'international', 'general', true),
  ('Al Jazeera Turk',   'al-jazeera-turk',  'https://aljazeera.com.tr',          'http://aljazeera.com.tr/rss.xml',                          'center', 'international', 'general', false),
  ('Ahval News',        'ahval-news',       'https://ahvalnews.com',             'https://ahvalnews.com/rss.xml',                            'center', 'international', 'general', false),
  ('Hürriyet Daily News','hurriyet-daily-news','https://www.hurriyetdailynews.com','https://www.hurriyetdailynews.com/rss',                  'gov_leaning', 'international', 'general', true),
  ('Türkiye Today',     'turkiye-today',    'https://www.turkiyetoday.com',      'https://www.turkiyetoday.com/feed/',                       'center', 'international', 'general', false),

  -- ═══════════════════════════════════════════════════════════════
  -- FINANCE
  -- ═══════════════════════════════════════════════════════════════
  ('Ekonomim',          'ekonomim',         'https://www.ekonomim.com',          'https://www.ekonomim.com/export/rss',                      'center',     'mainstream', 'finance', true),
  ('Dünya',             'dunya',            'https://www.dunya.com',             'https://www.dunya.com/rss?dunya',                          'center',     'mainstream', 'finance', true),
  ('Bloomberg HT',      'bloomberg-ht',     'https://www.bloomberght.com',       'http://www.bloomberght.com/rss',                           'center',     'mainstream', 'finance', true),
  ('Finansal Gündem',   'finansal-gundem',  'https://www.finansgundem.com',      'http://www.finansgundem.com/rss',                          'center',     'mainstream', 'finance', true),
  ('BigPara',           'bigpara',          'https://bigpara.hurriyet.com.tr',   'http://bigpara.hurriyet.com.tr/rss/',                      'gov_leaning', 'mainstream', 'finance', true),
  ('Investing.com TR',  'investing-com-tr', 'https://tr.investing.com',          'https://tr.investing.com/rss/news_288.rss',                'center',     'international','finance', true),
  ('Paraanaliz',        'paraanaliz',       'https://www.paraanaliz.com',        'https://www.paraanaliz.com/feed/',                         'center',     'mainstream', 'finance', false),
  ('Eko Seyir',         'eko-seyir',        'https://www.ekoseyir.com',          'http://www.ekoseyir.com/rss/piyasalar/248.xml',            'center',     'mainstream', 'finance', false),

  -- ═══════════════════════════════════════════════════════════════
  -- SPORTS (inactive by default)
  -- ═══════════════════════════════════════════════════════════════
  ('Fotomaç',           'fotomac',          'https://www.fotomac.com.tr',        'https://www.fotomac.com.tr/rss/anasayfa.xml',              'gov_leaning', 'mainstream', 'sports', false),
  ('Fanatik',           'fanatik',          'https://www.fanatik.com.tr',        'https://www.fanatik.com.tr/rss/anasayfa.xml',              'gov_leaning', 'mainstream', 'sports', false),
  ('A Spor',            'a-spor',           'https://www.aspor.com.tr',          'https://www.aspor.com.tr/rss/anasayfa.xml',                'pro_government','mainstream','sports', false),
  ('NTV Spor',          'ntv-spor',         'https://www.ntvspor.net',           'https://www.ntvspor.net/rss/anasayfa',                     'gov_leaning', 'mainstream', 'sports', false),
  ('AjansSpor',         'ajansspor',        'https://ajansspor.com',             'https://ajansspor.com/rss',                                'center',      'mainstream', 'sports', false),
  ('Fotospor',          'fotospor',         'https://www.fotospor.com',          'https://www.fotospor.com/feed/rss_sondakika.xml',          'center',      'mainstream', 'sports', false),
  ('Kontraspor',        'kontraspor',       'https://kontraspor.com',            'https://kontraspor.com/rss',                               'center',      'mainstream', 'sports', false),

  -- ═══════════════════════════════════════════════════════════════
  -- NICHE
  -- ═══════════════════════════════════════════════════════════════
  ('MFA Turkey',        'mfa-turkey',       'https://www.mfa.gov.tr',            'https://www.mfa.gov.tr/rss.en.mfa',                        'pro_government', 'state',      'niche', true),
  ('TOBB',              'tobb',             'https://www.tobb.org.tr',           'https://www.tobb.org.tr/Sayfalar/RssFeeder.php?List=Haberler','center',     'mainstream', 'niche', true),
  ('NewsLab Turkey',    'newslab-turkey',   'https://www.newslabturkey.org',     'https://www.newslabturkey.org/feed/',                       'center',      'mainstream', 'niche', true),
  ('İklim Haber',       'iklim-haber',      'https://www.iklimhaber.org',        'https://www.iklimhaber.org/feed/',                         'center',      'mainstream', 'niche', true),
  ('Hukuki Haber',      'hukuki-haber',     'https://www.hukukihaber.net',       'https://www.hukukihaber.net/rss',                          'center',      'mainstream', 'niche', true)

on conflict (slug) do update set
  name = excluded.name,
  url = excluded.url,
  rss_url = excluded.rss_url,
  alignment = excluded.alignment,
  tradition = excluded.tradition,
  source_type = excluded.source_type,
  active = excluded.active;
