import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Eye,
  ArrowRight,
  AlertTriangle,
  Layers,
  Newspaper,
  ChevronRight,
  Search,
  Shield,
  Zap,
  BarChart3,
  Globe,
} from "lucide-react";

/**
 * Design 4 — "Mosaic"
 *
 * Warm, approachable, human. Rounded, soft borders,
 * card-based layout, subtle warm tints in the dark theme.
 * Think Linear meets Notion — friendly but smart.
 * Bento grid for features, interactive feel.
 * Feeling: "Built for real people, not data nerds."
 */

function SpectrumPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1">
      <span className="h-2 w-2 rounded-full bg-red-400" />
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
      <span className="h-2 w-2 rounded-full bg-blue-400" />
    </span>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen">
      {/* ── Hero ─────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Warm ambient glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-gradient-to-bl from-amber-500/[0.03] via-rose-500/[0.02] to-transparent blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-blue-500/[0.03] to-transparent blur-[100px]" />

        <div className="container relative mx-auto px-4 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <div className="max-w-3xl mx-auto text-center">
            <SpectrumPill />

            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-[1.08]">
              Haberleri{" "}
              <span className="relative inline-block">
                tüm renkleriyle
                <svg className="absolute -bottom-1 left-0 w-full h-3 text-white/[0.08]" viewBox="0 0 200 12" preserveAspectRatio="none">
                  <path d="M0 8 Q50 0 100 8 Q150 16 200 8" stroke="currentColor" strokeWidth="3" fill="none" />
                </svg>
              </span>
              {" "}görün.
            </h1>

            <p className="mt-5 text-base text-white/40 max-w-xl mx-auto leading-relaxed sm:text-lg">
              Tayf, Türkiye&apos;nin medya kaynaklarını analiz ederek
              aynı haberin farklı perspektiflerden nasıl yansıtıldığını
              gösterir. Ücretsiz, şeffaf, bağımsız.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/">
                <Button size="lg" className="gap-2 px-7 h-11 rounded-xl">
                  Haberleri Keşfet
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/blindspots">
                <Button variant="outline" size="lg" className="gap-2 px-6 h-11 rounded-xl border-white/10 text-white/50 hover:text-white hover:border-white/20">
                  <AlertTriangle className="h-4 w-4" />
                  Kör Noktalar
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Demo card — the "aha" moment ─────────────── */}
      <section className="container mx-auto px-4 -mt-4 mb-20 sm:mb-28">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 sm:p-8 backdrop-blur-sm">
            <p className="text-[11px] text-white/25 uppercase tracking-wider mb-5">
              Örnek: Aynı olay, farklı başlıklar
            </p>

            <div className="space-y-3">
              {[
                { source: "Sabah", color: "bg-red-400", dot: "ring-red-500/20", title: "Tarihi ekonomi paketi: Vatandaşa müjde" },
                { source: "Reuters TR", color: "bg-emerald-400", dot: "ring-emerald-500/20", title: "Türkiye ekonomik teşvik paketini duyurdu" },
                { source: "Cumhuriyet", color: "bg-blue-400", dot: "ring-blue-500/20", title: "Paket beklentilerin altında kaldı" },
              ].map((item) => (
                <div
                  key={item.source}
                  className="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3.5 hover:bg-white/[0.05] transition-colors"
                >
                  <span className={`mt-1 h-3 w-3 rounded-full ${item.color} ring-4 ${item.dot} shrink-0`} />
                  <div>
                    <span className="text-[10px] text-white/30 font-medium">
                      {item.source}
                    </span>
                    <p className="text-sm text-white/70 leading-snug">
                      {item.title}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Spectrum bar */}
            <div className="mt-5 pt-4 border-t border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-white/20">Kaynak dağılımı</span>
                <span className="text-[10px] text-white/20">9 kaynak</span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                <div className="h-full bg-red-400 rounded-l-full" style={{ width: "45%" }} />
                <div className="h-full bg-emerald-400" style={{ width: "20%" }} />
                <div className="h-full bg-blue-400 rounded-r-full" style={{ width: "35%" }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Bento feature grid ───────────────────────── */}
      <section className="container mx-auto px-4 mb-20 sm:mb-28">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-white/90 sm:text-3xl">
            Medya okuryazarlığı araçları
          </h2>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Large card — Spectrum */}
          <div className="sm:col-span-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 hover:bg-white/[0.04] transition-colors">
            <div className="flex items-start justify-between mb-8">
              <div>
                <BarChart3 className="h-5 w-5 text-white/30 mb-3" />
                <h3 className="text-lg font-bold text-white/90 mb-1">
                  Yanlılık Spektrumu
                </h3>
                <p className="text-sm text-white/35 leading-relaxed max-w-sm">
                  Her haber kümesi için kaynak dağılımını tek bir çubukta görün.
                  Kırmızı, yeşil, mavi — bir bakışta anlayın.
                </p>
              </div>
            </div>
            {/* Mini demo */}
            <div className="space-y-2.5">
              {[
                { label: "Ekonomi", r: 50, g: 20, b: 30 },
                { label: "Dış Politika", r: 60, g: 15, b: 25 },
                { label: "Yerel Seçim", r: 30, g: 10, b: 60 },
              ].map((bar) => (
                <div key={bar.label} className="flex items-center gap-3">
                  <span className="text-[10px] text-white/20 w-20 text-right shrink-0">
                    {bar.label}
                  </span>
                  <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                    <div className="h-full bg-red-400" style={{ width: `${bar.r}%` }} />
                    <div className="h-full bg-emerald-400" style={{ width: `${bar.g}%` }} />
                    <div className="h-full bg-blue-400" style={{ width: `${bar.b}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Blindspots */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 hover:bg-white/[0.04] transition-colors">
            <AlertTriangle className="h-5 w-5 text-amber-400/50 mb-3" />
            <h3 className="text-lg font-bold text-white/90 mb-1">Kör Noktalar</h3>
            <p className="text-sm text-white/35 leading-relaxed">
              Sadece bir tarafın anlattığı haberleri tespit edin. En tehlikeli
              yanlılık biçimi — görmediğiniz haberler.
            </p>
          </div>

          {/* Clustering */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 hover:bg-white/[0.04] transition-colors">
            <Layers className="h-5 w-5 text-white/30 mb-3" />
            <h3 className="text-lg font-bold text-white/90 mb-1">Haber Kümeleme</h3>
            <p className="text-sm text-white/35 leading-relaxed">
              AI ile aynı olayı anlatan haberleri otomatik grupluyoruz.
              Karşılaştırın, kendiniz karar verin.
            </p>
          </div>

          {/* Categories */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 hover:bg-white/[0.04] transition-colors">
            <Search className="h-5 w-5 text-white/30 mb-3" />
            <h3 className="text-lg font-bold text-white/90 mb-1">Kategori Filtresi</h3>
            <p className="text-sm text-white/35 leading-relaxed">
              Politika, ekonomi, dünya, spor, teknoloji — ilgi alanınıza
              göre filtreleyin.
            </p>
          </div>

          {/* Large card — Sources */}
          <div className="sm:col-span-2 lg:col-span-1 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 hover:bg-white/[0.04] transition-colors">
            <Globe className="h-5 w-5 text-white/30 mb-3" />
            <h3 className="text-lg font-bold text-white/90 mb-1">13+ Kaynak</h3>
            <p className="text-sm text-white/35 leading-relaxed mb-4">
              Türkiye&apos;nin en geniş haber kaynağı yelpazesi.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["Sabah", "Star", "TRT", "Reuters", "BBC", "Cumhuriyet", "T24", "+6"].map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-white/30"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works — horizontal steps ──────────── */}
      <section className="border-y border-white/[0.06] py-20 sm:py-28">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-2xl font-bold tracking-tight text-white/90 sm:text-3xl">
              Nasıl çalışır?
            </h2>
          </div>

          <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                num: "1",
                color: "from-red-500/20 to-red-500/0",
                border: "border-red-500/20",
                title: "Haberleri topluyoruz",
                desc: "13 kaynaktan gerçek zamanlı RSS ile otomatik haber toplama.",
              },
              {
                num: "2",
                color: "from-emerald-500/20 to-emerald-500/0",
                border: "border-emerald-500/20",
                title: "AI ile analiz ediyoruz",
                desc: "Aynı olayı anlatan haberleri gruplayıp yanlılık dağılımını hesaplıyoruz.",
              },
              {
                num: "3",
                color: "from-blue-500/20 to-blue-500/0",
                border: "border-blue-500/20",
                title: "Size gösteriyoruz",
                desc: "Spektrum çubukları, kör nokta uyarıları ve karşılaştırma ile tam resmi görün.",
              },
            ].map((step) => (
              <div
                key={step.num}
                className={`rounded-2xl border ${step.border} bg-gradient-to-b ${step.color} p-6`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] text-sm font-bold text-white/50 mb-4">
                  {step.num}
                </span>
                <h3 className="text-base font-bold text-white/90 mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-white/35 leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.01] to-transparent" />

        <div className="container relative mx-auto px-4 text-center">
          <SpectrumPill />
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-white/90 sm:text-4xl mb-3">
            Haberlerin tüm renklerini
            <br />
            görmeye hazır mısınız?
          </h2>
          <p className="text-white/30 mb-8 max-w-sm mx-auto text-sm">
            Tamamen ücretsiz. Kayıt gerekmez. Hemen başlayın.
          </p>
          <Link href="/">
            <Button size="lg" className="gap-2 px-8 h-12 rounded-xl">
              Hemen Başla
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white">
                <Eye className="h-3.5 w-3.5 text-black" />
              </div>
              <span className="text-sm font-bold text-white/70">Tayf</span>
              <span className="text-[10px] text-white/20">
                Türkiye Haber Analizi
              </span>
            </div>
            <div className="flex items-center gap-5 text-[11px] text-white/20">
              <Link href="/" className="hover:text-white/50 transition-colors">Haberler</Link>
              <Link href="/blindspots" className="hover:text-white/50 transition-colors">Kör Noktalar</Link>
              <Link href="/sources" className="hover:text-white/50 transition-colors">Kaynaklar</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
