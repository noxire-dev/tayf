import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Eye,
  ArrowRight,
  AlertTriangle,
  Layers,
  Newspaper,
  Building2,
} from "lucide-react";

/**
 * Design 1 — "Observatory"
 *
 * Dark, immersive, data-visualization aesthetic.
 * Think Bloomberg Terminal meets Stripe.
 * The spectrum IS the brand — it's everywhere as a visual motif.
 * Feeling: "You're looking through a precision instrument."
 */

function SpectrumLine({ className }: { className?: string }) {
  return (
    <div className={`flex h-[2px] overflow-hidden rounded-full ${className}`}>
      <div className="h-full w-1/3 bg-red-500" />
      <div className="h-full w-1/3 bg-emerald-500" />
      <div className="h-full w-1/3 bg-blue-500" />
    </div>
  );
}

function BiasBar({
  r,
  g,
  b,
  height = "h-2",
}: {
  r: number;
  g: number;
  b: number;
  height?: string;
}) {
  return (
    <div className={`flex ${height} w-full overflow-hidden rounded-full bg-white/[0.03]`}>
      <div className="h-full bg-red-500/90" style={{ width: `${r}%` }} />
      <div className="h-full bg-emerald-500/90" style={{ width: `${g}%` }} />
      <div className="h-full bg-blue-500/90" style={{ width: `${b}%` }} />
    </div>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen bg-[oklch(0.13_0_0)]">
      {/* ── Hero ─────────────────────────────────────── */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden">
        {/* Ambient glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-red-500/[0.04] via-emerald-500/[0.03] to-blue-500/[0.04] blur-[120px]" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="container relative mx-auto px-4">
          <div className="max-w-4xl">
            <SpectrumLine className="w-20 mb-8" />

            <p className="text-xs font-mono uppercase tracking-[0.3em] text-white/30 mb-4">
              Türkiye Haber Analizi
            </p>

            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl leading-[1.05]">
              <span className="text-white/90">Her haberin</span>
              <br />
              <span className="bg-gradient-to-r from-red-400 via-emerald-400 to-blue-400 bg-clip-text text-transparent">
                üç rengi var.
              </span>
            </h1>

            <p className="mt-6 text-base text-white/40 max-w-lg leading-relaxed sm:text-lg">
              Türkiye&apos;nin 13 haber kaynağını gerçek zamanlı analiz ediyoruz.
              Aynı haberin iktidar, muhalefet ve bağımsız medyada nasıl farklı
              anlatıldığını görün.
            </p>

            <div className="mt-10 flex items-center gap-4">
              <Link href="/">
                <Button size="lg" className="gap-2 px-7 h-12 text-sm bg-white text-black hover:bg-white/90">
                  Haberleri Keşfet
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link
                href="/sources"
                className="text-sm text-white/40 hover:text-white/70 transition-colors"
              >
                Kaynakları gör →
              </Link>
            </div>

            {/* Live spectrum demo — the hero visual */}
            <div className="mt-16 sm:mt-20 max-w-2xl">
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-5">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-mono text-white/30 uppercase tracking-wider">
                    Canlı Analiz
                  </span>
                </div>

                <div className="space-y-5">
                  {[
                    { title: "Ekonomi Paketi Meclis'ten Geçti", r: 55, g: 15, b: 30, sources: 11, blindspot: false },
                    { title: "Gazeteci Gözaltına Alındı", r: 10, g: 20, b: 70, sources: 8, blindspot: true },
                    { title: "Deprem Bölgesine Yeni Yardım Kararı", r: 35, g: 35, b: 30, sources: 13, blindspot: false },
                  ].map((story) => (
                    <div key={story.title} className="group">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <p className="text-sm text-white/70 leading-snug group-hover:text-white/90 transition-colors">
                          {story.title}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          {story.blindspot && (
                            <span className="flex items-center gap-1 text-[9px] text-amber-400/80 font-mono">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              KÖR NOKTA
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-white/20">
                            {story.sources} kaynak
                          </span>
                        </div>
                      </div>
                      <BiasBar r={story.r} g={story.g} b={story.b} />
                      <div className="flex gap-4 mt-1.5">
                        {[
                          { label: "İktidar", pct: story.r, color: "text-red-400/60" },
                          { label: "Bağımsız", pct: story.g, color: "text-emerald-400/60" },
                          { label: "Muhalefet", pct: story.b, color: "text-blue-400/60" },
                        ].map((seg) => (
                          <span key={seg.label} className={`text-[10px] font-mono ${seg.color}`}>
                            {seg.label} %{seg.pct}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Numbers strip ────────────────────────────── */}
      <section className="border-y border-white/[0.06]">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-white/[0.06]">
            {[
              { value: "13", label: "Haber Kaynağı" },
              { value: "3", label: "Yanlılık Kategorisi" },
              { value: "7/24", label: "Canlı Takip" },
              { value: "∞", label: "Ücretsiz" },
            ].map((stat) => (
              <div key={stat.label} className="py-8 px-6 text-center">
                <p className="text-3xl font-bold tracking-tight text-white/80 font-mono">
                  {stat.value}
                </p>
                <p className="text-[11px] text-white/25 mt-1 uppercase tracking-wider">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works — vertical timeline ─────────── */}
      <section className="py-24 sm:py-32">
        <div className="container mx-auto px-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/20 mb-3">
            Nasıl Çalışır
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-white/90 mb-16 sm:text-4xl">
            Üç adımda şeffaflık
          </h2>

          <div className="max-w-3xl space-y-16">
            {[
              {
                num: "01",
                color: "border-red-500/40 text-red-400",
                dot: "bg-red-500",
                title: "Topla",
                desc: "13 farklı Türk haber kaynağından RSS ile haberleri gerçek zamanlı topluyoruz. İktidar yanlısı, muhalefet ve bağımsız — hepsi tek yerde.",
              },
              {
                num: "02",
                color: "border-emerald-500/40 text-emerald-400",
                dot: "bg-emerald-500",
                title: "Kümele",
                desc: "Yapay zeka aynı olayı anlatan farklı haberleri grupluyor. Böylece bir olayın tüm perspektiflerini yan yana görebilirsiniz.",
              },
              {
                num: "03",
                color: "border-blue-500/40 text-blue-400",
                dot: "bg-blue-500",
                title: "Aydınlat",
                desc: "Her hikaye için kaynak dağılımını görselleştiriyoruz. Hangi haberler tek taraflı anlatılıyor? Kör noktaları ortaya çıkarıyoruz.",
              },
            ].map((step, i) => (
              <div key={step.num} className="flex gap-8">
                <div className="flex flex-col items-center shrink-0">
                  <div className={`h-3 w-3 rounded-full ${step.dot}`} />
                  {i < 2 && <div className="w-px flex-1 bg-white/[0.06] mt-2" />}
                </div>
                <div className="pb-2">
                  <span className={`text-[10px] font-mono uppercase tracking-wider ${step.color}`}>
                    Adım {step.num}
                  </span>
                  <h3 className="text-xl font-bold text-white/90 mt-1 mb-2">
                    {step.title}
                  </h3>
                  <p className="text-sm text-white/40 leading-relaxed max-w-md">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Blindspot feature highlight ──────────────── */}
      <section className="border-y border-white/[0.06] py-24 sm:py-32">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-4 w-4 text-amber-400/70" />
                <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-amber-400/50">
                  Kör Noktalar
                </span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white/90 mb-4 sm:text-4xl">
                Anlatılmayanı
                <br />
                bulun.
              </h2>
              <p className="text-sm text-white/40 leading-relaxed max-w-md mb-6">
                Bazı haberler yalnızca bir tarafın medyasında yer alıyor.
                Bu &quot;kör noktalar&quot; en tehlikeli yanlılık biçimi —
                çünkü var olduğunu bile bilmiyorsunuz. Tayf bunları
                otomatik tespit eder.
              </p>
              <Link href="/blindspots">
                <Button variant="outline" className="gap-2 border-white/10 text-white/60 hover:text-white hover:border-white/20">
                  Kör Noktaları Gör
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>

            {/* Blindspot demo cards */}
            <div className="space-y-3">
              {[
                {
                  title: "Gazetecinin Tutuklanması",
                  side: "Muhalefet",
                  pct: 85,
                  color: "border-l-blue-500",
                  sources: "Cumhuriyet, T24, BirGün",
                },
                {
                  title: "Yeni Vergi Muafiyeti Paketi",
                  side: "Hükümete Yakın",
                  pct: 90,
                  color: "border-l-red-500",
                  sources: "Sabah, Star, A Haber, Yeni Şafak",
                },
                {
                  title: "Suriye Sınırında Yaşanan Olaylar",
                  side: "Hükümete Yakın",
                  pct: 70,
                  color: "border-l-red-500",
                  sources: "TRT, A Haber, Star",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className={`border-l-2 ${item.color} rounded-r-xl bg-white/[0.02] border border-white/[0.05] border-l-2 p-4`}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="h-3 w-3 text-amber-400/70" />
                    <span className="text-[9px] font-mono uppercase tracking-wider text-amber-400/60">
                      %{item.pct} tek taraflı
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white/80 mb-1">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-white/30">
                    Sadece <span className="text-white/50">{item.side}</span> kaynaklar
                    — {item.sources}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Source grid ───────────────────────────────── */}
      <section className="py-24 sm:py-32">
        <div className="container mx-auto px-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/20 mb-3">
            Kaynaklar
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-white/90 mb-4 sm:text-4xl">
            Tüm spektrumdan
          </h2>
          <p className="text-sm text-white/40 mb-12 max-w-md mx-auto">
            Türkiye&apos;nin en geniş haber kaynağı yelpazesi — iktidardan
            muhalefete, bağımsız medyaya.
          </p>

          <div className="flex flex-wrap justify-center gap-2 max-w-3xl mx-auto">
            {[
              { name: "Sabah", c: "bg-red-500" },
              { name: "Star", c: "bg-red-500" },
              { name: "Yeni Şafak", c: "bg-red-500" },
              { name: "A Haber", c: "bg-red-500" },
              { name: "TRT Haber", c: "bg-red-500" },
              { name: "Reuters TR", c: "bg-emerald-500" },
              { name: "BBC Türkçe", c: "bg-emerald-500" },
              { name: "DW Türkçe", c: "bg-emerald-500" },
              { name: "Cumhuriyet", c: "bg-blue-500" },
              { name: "BirGün", c: "bg-blue-500" },
              { name: "T24", c: "bg-blue-500" },
              { name: "Sözcü", c: "bg-blue-500" },
              { name: "Halk TV", c: "bg-blue-500" },
            ].map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm text-white/50 hover:text-white/80 hover:border-white/[0.12] transition-all"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${s.c}`} />
                {s.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/[0.06]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-b from-white/[0.02] to-transparent rounded-full blur-[100px]" />

        <div className="container relative mx-auto px-4 py-24 sm:py-32 text-center">
          <SpectrumLine className="w-16 mx-auto mb-8" />
          <h2 className="text-3xl font-bold tracking-tight text-white/90 mb-3 sm:text-4xl">
            Haberlerin tüm renklerini görün.
          </h2>
          <p className="text-sm text-white/35 max-w-sm mx-auto mb-8">
            Tayf tamamen ücretsiz ve kayıt gerektirmez.
          </p>
          <Link href="/">
            <Button size="lg" className="gap-2 px-8 h-12 bg-white text-black hover:bg-white/90">
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
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white">
                <Eye className="h-3.5 w-3.5 text-black" />
              </div>
              <span className="text-sm font-bold text-white/80">Tayf</span>
              <span className="text-[10px] text-white/20 font-mono">
                Haber Analizi
              </span>
            </div>
            <div className="flex items-center gap-5 text-[11px] text-white/25">
              <Link href="/" className="hover:text-white/60 transition-colors">Haberler</Link>
              <Link href="/blindspots" className="hover:text-white/60 transition-colors">Kör Noktalar</Link>
              <Link href="/sources" className="hover:text-white/60 transition-colors">Kaynaklar</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
