import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Eye,
  ArrowRight,
  AlertTriangle,
  Layers,
  Quote,
  ArrowUpRight,
  ChevronRight,
} from "lucide-react";

/**
 * Design 2 — "Gazette"
 *
 * Modern editorial. Newspaper heritage meets 2026 web.
 * Left-aligned, strong typographic hierarchy, pull quotes,
 * generous whitespace. Classic column grid, modern details.
 * Feeling: "Serious journalism, elevated."
 */

export default function Page() {
  return (
    <div className="min-h-screen">
      {/* Top spectrum accent — thin editorial rule */}
      <div className="h-[3px] w-full bg-gradient-to-r from-red-500 via-emerald-500 to-blue-500 opacity-80" />

      {/* ── Hero ─────────────────────────────────────── */}
      <section className="container mx-auto px-4 pt-20 pb-24 sm:pt-28 sm:pb-32">
        <div className="max-w-5xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
            {/* Left column — text */}
            <div className="lg:col-span-7">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-px w-10 bg-white/20" />
                <span className="text-[10px] uppercase tracking-[0.25em] text-white/30">
                  Türkiye Haber Analizi
                </span>
              </div>

              <h1 className="text-4xl font-bold tracking-tight leading-[1.1] sm:text-5xl lg:text-[3.4rem]">
                Aynı haber.
                <br />
                <span className="text-white/40">Farklı gerçeklikler.</span>
              </h1>

              <p className="mt-6 text-base text-white/40 leading-relaxed max-w-lg sm:text-lg">
                Türkiye&apos;de hangi gazeteyi okuduğunuz, hangi gerçeklikte
                yaşadığınızı belirler. Tayf bu duvarları şeffaf yapıyor.
              </p>

              <div className="mt-10 flex items-center gap-4">
                <Link href="/">
                  <Button size="lg" className="gap-2 px-7 h-11">
                    Haberleri Keşfet
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link
                  href="/blindspots"
                  className="text-sm text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
                >
                  Kör Noktalar
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {/* Right column — visual: stacked headlines showing same story */}
            <div className="lg:col-span-5 flex items-center">
              <div className="w-full space-y-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/20 mb-4">
                  Aynı gün, aynı olay
                </p>
                {[
                  { source: "Sabah", color: "bg-red-500", title: "Tarihi ekonomi paketi açıklandı: Vatandaşa müjde" },
                  { source: "Reuters TR", color: "bg-emerald-500", title: "Türkiye yeni ekonomik teşvik paketini duyurdu" },
                  { source: "Cumhuriyet", color: "bg-blue-500", title: "Ekonomi paketi beklentilerin altında kaldı" },
                ].map((item) => (
                  <div
                    key={item.source}
                    className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5"
                  >
                    <span className={`mt-1 h-2 w-2 rounded-full ${item.color} shrink-0`} />
                    <div>
                      <span className="text-[10px] text-white/30">{item.source}</span>
                      <p className="text-sm text-white/70 leading-snug">{item.title}</p>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-white/15 text-right italic">
                  3 kaynak, 3 farklı başlık
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Separator className="opacity-10" />

      {/* ── Pull quote ───────────────────────────────── */}
      <section className="py-16 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto relative">
            <Quote className="absolute -left-2 -top-2 h-8 w-8 text-white/[0.06]" />
            <blockquote className="pl-8 border-l-2 border-white/10">
              <p className="text-xl sm:text-2xl text-white/60 leading-relaxed">
                Medya yanlılığının en tehlikeli biçimi sizin
                görmediğiniz haberlerdir — çünkü var olduğunu bile bilmezsiniz.
              </p>
              <footer className="mt-4 text-xs text-white/20">
                Kör noktalar: yalnızca bir tarafın anlattığı hikayeler
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      <Separator className="opacity-10" />

      {/* ── Three pillars ────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.04] rounded-2xl overflow-hidden max-w-5xl mx-auto">
            {[
              {
                icon: "🔴🟢🔵",
                title: "Yanlılık Spektrumu",
                desc: "Her haber kümesi için kaynak dağılımını görselleştiriyoruz. Bir bakışta hangi hikaye dengeli, hangisi tek taraflı — anında görün.",
                detail: "İktidar · Bağımsız · Muhalefet",
              },
              {
                icon: "⚠️",
                title: "Kör Noktalar",
                desc: "Yalnızca tek tarafın aktardığı haberleri otomatik tespit ediyoruz. Sağ medya veya sol medya — kimin neyi sakladığını öğrenin.",
                detail: "Otomatik tespit · AI destekli",
              },
              {
                icon: "📊",
                title: "Karşılaştırma",
                desc: "Aynı olayı farklı kaynaklar nasıl aktarıyor? Başlık farklarından ton analizine — tüm perspektifleri yan yana.",
                detail: "13 kaynak · Gerçek zamanlı",
              },
            ].map((pillar) => (
              <div
                key={pillar.title}
                className="bg-[oklch(0.15_0_0)] p-8 sm:p-10 hover:bg-[oklch(0.17_0_0)] transition-colors"
              >
                <span className="text-2xl mb-4 block">{pillar.icon}</span>
                <h3 className="text-lg font-bold text-white/90 mb-2">
                  {pillar.title}
                </h3>
                <p className="text-sm text-white/40 leading-relaxed mb-4">
                  {pillar.desc}
                </p>
                <p className="text-[10px] text-white/20 uppercase tracking-wider">
                  {pillar.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Source map ────────────────────────────────── */}
      <section className="border-y border-white/[0.06] py-20 sm:py-28">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
              <div className="lg:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-8 bg-white/20" />
                  <span className="text-[10px] uppercase tracking-[0.25em] text-white/25">
                    Kaynak Haritası
                  </span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-white/90 mb-3 sm:text-3xl">
                  13 kaynak,
                  <br />
                  3 perspektif.
                </h2>
                <p className="text-sm text-white/40 leading-relaxed mb-6">
                  Türkiye&apos;nin medya yelpazesinin tamamını kapsıyoruz.
                </p>

                {/* Legend */}
                <div className="space-y-2.5">
                  {[
                    { color: "bg-red-500", label: "Hükümete Yakın", count: 5 },
                    { color: "bg-emerald-500", label: "Bağımsız", count: 3 },
                    { color: "bg-blue-500", label: "Muhalefet", count: 5 },
                  ].map((b) => (
                    <div key={b.label} className="flex items-center gap-2.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${b.color}`} />
                      <span className="text-sm text-white/70">{b.label}</span>
                      <span className="text-[10px] text-white/20 ml-auto">
                        {b.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-3">
                {/* Source groups */}
                <div className="space-y-6">
                  {[
                    {
                      label: "Hükümete Yakın",
                      color: "border-red-500/30",
                      dot: "bg-red-500",
                      sources: ["Sabah", "Star", "Yeni Şafak", "A Haber", "TRT Haber"],
                    },
                    {
                      label: "Bağımsız",
                      color: "border-emerald-500/30",
                      dot: "bg-emerald-500",
                      sources: ["Reuters TR", "BBC Türkçe", "DW Türkçe"],
                    },
                    {
                      label: "Muhalefet",
                      color: "border-blue-500/30",
                      dot: "bg-blue-500",
                      sources: ["Cumhuriyet", "BirGün", "T24", "Sözcü", "Halk TV"],
                    },
                  ].map((group) => (
                    <div key={group.label}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${group.dot}`} />
                        <span className="text-[10px] uppercase tracking-wider text-white/25">
                          {group.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {group.sources.map((s) => (
                          <span
                            key={s}
                            className={`rounded-lg border ${group.color} bg-white/[0.02] px-3.5 py-2 text-sm text-white/50 hover:text-white/80 transition-colors`}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Full spectrum bar */}
                <div className="mt-8">
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.03]">
                    <div className="h-full bg-red-500/80" style={{ width: "38.5%" }} />
                    <div className="h-full bg-emerald-500/80" style={{ width: "23%" }} />
                    <div className="h-full bg-blue-500/80" style={{ width: "38.5%" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="py-24 sm:py-32">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white/90 mb-4 sm:text-4xl">
              Kendi gözlerinizle görün.
            </h2>
            <p className="text-white/35 mb-8 max-w-sm mx-auto">
              Tayf tamamen ücretsiz. Kayıt gerekmez.
              Haberlerin tüm spektrumunu keşfedin.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/">
                <Button size="lg" className="gap-2 px-8 h-11">
                  Haberleri Keşfet
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/blindspots">
                <Button variant="outline" size="lg" className="gap-2 px-6 h-11 border-white/10 text-white/50 hover:text-white hover:border-white/20">
                  Kör Noktalar
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
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
              <Separator orientation="vertical" className="h-3 opacity-10" />
              <span className="text-[10px] text-white/20">
                Haberlerin spektrumunu görün
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
