import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Eye,
  ArrowRight,
  AlertTriangle,
  Layers,
  Newspaper,
  ChevronRight,
} from "lucide-react";

/**
 * Design 3 — "Signal"
 *
 * Ultra-clean, Apple-esque. One idea per section.
 * Massive typography, extreme whitespace, almost zen.
 * The content breathes. Every word earns its place.
 * Feeling: "The tool disappears, the clarity remains."
 */

export default function Page() {
  return (
    <div className="min-h-screen">
      {/* ── Hero — single powerful statement ──────────── */}
      <section className="container mx-auto px-4 flex min-h-[80vh] items-center">
        <div className="max-w-4xl w-full">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl xl:text-8xl leading-[0.95]">
            <span className="text-white/90">Gerçeği</span>
            <br />
            <span className="text-white/20">görmek</span>
            <br />
            <span className="bg-gradient-to-r from-red-400 via-emerald-400 to-blue-400 bg-clip-text text-transparent">
              ister misiniz?
            </span>
          </h1>

          <div className="mt-12 flex items-center gap-6">
            <Link href="/">
              <Button size="lg" className="gap-2 px-8 h-12 rounded-full bg-white text-black hover:bg-white/90 text-sm">
                Başla
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <span className="text-sm text-white/20">
              Ücretsiz · Kayıt yok
            </span>
          </div>
        </div>
      </section>

      {/* ── One-liner ────────────────────────────────── */}
      <section className="border-y border-white/[0.05]">
        <div className="container mx-auto px-4 py-12 sm:py-16">
          <p className="text-center text-lg sm:text-xl text-white/30 max-w-2xl mx-auto leading-relaxed">
            Tayf, Türkiye&apos;deki <span className="text-white/70">13 haber kaynağını</span> analiz eder
            ve aynı haberin{" "}
            <span className="text-red-400/70">iktidar</span>,{" "}
            <span className="text-emerald-400/70">bağımsız</span> ve{" "}
            <span className="text-blue-400/70">muhalefet</span>{" "}
            medyasında nasıl farklı anlatıldığını gösterir.
          </p>
        </div>
      </section>

      {/* ── Visual: the spectrum concept ──────────────── */}
      <section className="py-28 sm:py-40">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/15 mb-16">
              Bir Haber, Üç Perspektif
            </p>

            {/* The same headline, three ways */}
            <div className="space-y-0">
              <div className="group py-6 border-b border-white/[0.04] hover:bg-white/[0.01] transition-colors rounded-lg px-4">
                <div className="flex items-center gap-3 justify-center mb-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span className="text-[11px] text-white/25">Sabah</span>
                </div>
                <p className="text-xl sm:text-2xl text-white/70 leading-snug">
                  &ldquo;Tarihi ekonomi paketi açıklandı: Vatandaşa müjde&rdquo;
                </p>
              </div>

              <div className="group py-6 border-b border-white/[0.04] hover:bg-white/[0.01] transition-colors rounded-lg px-4">
                <div className="flex items-center gap-3 justify-center mb-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-[11px] text-white/25">Reuters TR</span>
                </div>
                <p className="text-xl sm:text-2xl text-white/70 leading-snug">
                  &ldquo;Türkiye yeni ekonomik teşvik paketini duyurdu&rdquo;
                </p>
              </div>

              <div className="group py-6 hover:bg-white/[0.01] transition-colors rounded-lg px-4">
                <div className="flex items-center gap-3 justify-center mb-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                  <span className="text-[11px] text-white/25">Cumhuriyet</span>
                </div>
                <p className="text-xl sm:text-2xl text-white/70 leading-snug">
                  &ldquo;Ekonomi paketi beklentilerin altında kaldı&rdquo;
                </p>
              </div>
            </div>

            {/* Spectrum bar below */}
            <div className="mt-10 max-w-xs mx-auto">
              <div className="flex h-2 w-full overflow-hidden rounded-full">
                <div className="h-full w-[40%] bg-red-500" />
                <div className="h-full w-[20%] bg-emerald-500" />
                <div className="h-full w-[40%] bg-blue-500" />
              </div>
              <p className="text-[10px] text-white/15 mt-2">
                Kaynak dağılımı
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features — one per screen ────────────────── */}
      <section className="space-y-0">
        {/* Feature 1: Spectrum */}
        <div className="border-t border-white/[0.05] py-28 sm:py-36">
          <div className="container mx-auto px-4">
            <div className="max-w-xl mx-auto text-center">
              <div className="flex justify-center mb-6">
                <div className="flex h-1.5 w-20 overflow-hidden rounded-full">
                  <div className="h-full w-1/3 bg-red-500" />
                  <div className="h-full w-1/3 bg-emerald-500" />
                  <div className="h-full w-1/3 bg-blue-500" />
                </div>
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white/90 sm:text-4xl mb-4">
                Yanlılık Spektrumu
              </h2>
              <p className="text-white/35 leading-relaxed">
                Her hikaye için hangi kaynaklar hangi perspektiften aktarıyor?
                Tek bir çubukla, bir bakışta anlayın. Dengesiz dağılımlar
                otomatik işaretlenir.
              </p>
            </div>
          </div>
        </div>

        {/* Feature 2: Blindspots */}
        <div className="border-t border-white/[0.05] py-28 sm:py-36">
          <div className="container mx-auto px-4">
            <div className="max-w-xl mx-auto text-center">
              <div className="flex justify-center mb-6">
                <AlertTriangle className="h-6 w-6 text-amber-400/50" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white/90 sm:text-4xl mb-4">
                Kör Noktalar
              </h2>
              <p className="text-white/35 leading-relaxed">
                Bazı haberler yalnızca bir tarafın medyasında yer alıyor.
                Bu, yanlılığın en tehlikeli biçimi — çünkü var olduğunu
                bile bilmiyorsunuz. Tayf bunları buluyor.
              </p>
            </div>
          </div>
        </div>

        {/* Feature 3: Clustering */}
        <div className="border-t border-white/[0.05] py-28 sm:py-36">
          <div className="container mx-auto px-4">
            <div className="max-w-xl mx-auto text-center">
              <div className="flex justify-center mb-6">
                <Layers className="h-6 w-6 text-white/20" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white/90 sm:text-4xl mb-4">
                Karşılaştırın
              </h2>
              <p className="text-white/35 leading-relaxed">
                AI destekli kümeleme ile aynı olayı anlatan tüm kaynakları
                yan yana görün. Sabah ne diyor? Cumhuriyet ne diyor?
                Reuters ne diyor? Siz karar verin.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sources ──────────────────────────────────── */}
      <section className="border-t border-white/[0.05] py-28 sm:py-36">
        <div className="container mx-auto px-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/15 mb-4">
            Kaynaklar
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-white/90 mb-12 sm:text-4xl">
            Tüm yelpaze.
          </h2>

          <div className="max-w-2xl mx-auto">
            {/* Three columns */}
            <div className="grid grid-cols-3 gap-8 text-left">
              {[
                {
                  label: "İktidar",
                  color: "text-red-400/50",
                  dot: "bg-red-500",
                  sources: ["Sabah", "Star", "Yeni Şafak", "A Haber", "TRT Haber"],
                },
                {
                  label: "Bağımsız",
                  color: "text-emerald-400/50",
                  dot: "bg-emerald-500",
                  sources: ["Reuters TR", "BBC Türkçe", "DW Türkçe"],
                },
                {
                  label: "Muhalefet",
                  color: "text-blue-400/50",
                  dot: "bg-blue-500",
                  sources: ["Cumhuriyet", "BirGün", "T24", "Sözcü", "Halk TV"],
                },
              ].map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`h-2 w-2 rounded-full ${group.dot}`} />
                    <span className={`text-[10px] uppercase tracking-wider ${group.color}`}>
                      {group.label}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.sources.map((s) => (
                      <p key={s} className="text-sm text-white/40">
                        {s}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA — minimal ────────────────────────────── */}
      <section className="border-t border-white/[0.05] py-28 sm:py-40">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold tracking-tight text-white/90 sm:text-5xl mb-6">
            Görmeye başlayın.
          </h2>
          <Link href="/">
            <Button size="lg" className="gap-2 px-10 h-12 rounded-full bg-white text-black hover:bg-white/90">
              Keşfet
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-xs text-white/15 mt-4">
            Ücretsiz · Kayıt gerekmez
          </p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-white">
                <Eye className="h-3 w-3 text-black" />
              </div>
              <span className="text-sm font-bold text-white/60">Tayf</span>
            </div>
            <div className="flex items-center gap-5 text-[11px] text-white/15">
              <Link href="/" className="hover:text-white/40 transition-colors">Haberler</Link>
              <Link href="/blindspots" className="hover:text-white/40 transition-colors">Kör Noktalar</Link>
              <Link href="/sources" className="hover:text-white/40 transition-colors">Kaynaklar</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
