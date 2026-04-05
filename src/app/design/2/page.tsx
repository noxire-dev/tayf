import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Eye,
  Layers,
  AlertTriangle,
  ArrowRight,
  Newspaper,
  Building2,
  BarChart3,
  ChevronRight,
  ExternalLink,
  Zap,
  Quote,
  ArrowUpRight,
} from "lucide-react";

const SOURCES = [
  { name: "Sabah", bias: "pro_government" as const },
  { name: "Star", bias: "pro_government" as const },
  { name: "Yeni Şafak", bias: "pro_government" as const },
  { name: "A Haber", bias: "pro_government" as const },
  { name: "TRT Haber", bias: "pro_government" as const },
  { name: "Cumhuriyet", bias: "opposition" as const },
  { name: "BirGün", bias: "opposition" as const },
  { name: "T24", bias: "opposition" as const },
  { name: "Sözcü", bias: "opposition" as const },
  { name: "Halk TV", bias: "opposition" as const },
  { name: "Reuters TR", bias: "independent" as const },
  { name: "BBC Türkçe", bias: "independent" as const },
  { name: "DW Türkçe", bias: "independent" as const },
];

const BIAS_COLORS = {
  pro_government: "bg-red-500",
  opposition: "bg-blue-500",
  independent: "bg-green-500",
};

export default function Page() {
  return (
    <div className="min-h-screen">
      {/* ── Top bar accent ────────────────────────────── */}
      <div className="h-0.5 w-full bg-gradient-to-r from-red-500 via-green-500 to-blue-500" />

      {/* ── Hero — editorial style ───────────────────── */}
      <section className="container mx-auto px-4 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="max-w-4xl">
          {/* Tagline */}
          <div className="flex items-center gap-2 mb-6">
            <div className="h-px flex-1 max-w-8 bg-foreground/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Türkiye Haber Analizi
            </span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-[3.5rem] leading-[1.08] mb-6">
            Aynı haber,{" "}
            <span className="relative">
              <span className="relative z-10">farklı gerçeklikler.</span>
              <span className="absolute bottom-1 left-0 right-0 h-2 bg-gradient-to-r from-red-500/20 via-green-500/20 to-blue-500/20 -z-0" />
            </span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed mb-8 sm:text-xl">
            Türkiye&apos;deki medya kuruluşları aynı olayı çok farklı
            anlatıyor. Tayf, bu farkları görünür kılıyor — böylece siz
            kendiniz karar verebilirsiniz.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/">
              <Button size="lg" className="gap-2 px-6 h-11">
                Haberleri Keşfet
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/sources">
              <Button variant="ghost" size="lg" className="gap-2 px-6 h-11 text-muted-foreground">
                Kaynaklarımız
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── The Problem — editorial quote block ──────── */}
      <section className="container mx-auto px-4 py-16 sm:py-20">
        <div className="max-w-3xl mx-auto">
          <div className="relative pl-6 border-l-2 border-foreground/20">
            <Quote className="absolute -left-3 -top-1 h-6 w-6 text-muted-foreground/30 bg-background" />
            <blockquote className="text-lg sm:text-xl text-foreground/80 leading-relaxed italic">
              &ldquo;Türkiye&apos;de hangi gazeteyi okuduğunuz, hangi ülkede
              yaşadığınızı belirler.&rdquo;
            </blockquote>
            <p className="text-xs text-muted-foreground mt-3 not-italic">
              Aynı gün, aynı olay — 13 farklı kaynak, 13 farklı başlık.
              Tayf bunun haritasını çıkarıyor.
            </p>
          </div>
        </div>
      </section>

      {/* ── Live Source Map ───────────────────────────── */}
      <section className="border-y border-border/30 bg-card/20 py-16 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row gap-12 items-start">
            {/* Left: description */}
            <div className="lg:w-1/3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">
                Kaynak Haritası
              </p>
              <h2 className="text-2xl font-bold tracking-tight mb-3">
                13 kaynak, 3 perspektif
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                Her haber kaynağını politik konumlandırmasına göre sınıflandırıyoruz.
                Böylece okuduğunuz haberin hangi perspektiften geldiğini
                her zaman bilirsiniz.
              </p>

              {/* Legend */}
              <div className="space-y-2">
                {[
                  { color: "bg-red-500", label: "Hükümete Yakın", count: 5 },
                  { color: "bg-blue-500", label: "Muhalefet", count: 5 },
                  { color: "bg-green-500", label: "Bağımsız", count: 3 },
                ].map((b) => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${b.color}`} />
                    <span className="text-xs font-medium">{b.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      ({b.count} kaynak)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: source pills grid */}
            <div className="lg:flex-1">
              <div className="flex flex-wrap gap-2">
                {SOURCES.map((source) => (
                  <div
                    key={source.name}
                    className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/50 px-3 py-2 hover:border-border transition-colors"
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${BIAS_COLORS[source.bias]}`}
                    />
                    <span className="text-sm">{source.name}</span>
                  </div>
                ))}
              </div>

              {/* Spectrum bar below sources */}
              <div className="mt-6">
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/30">
                  <div className="h-full bg-red-500 transition-all" style={{ width: "38.5%" }} />
                  <div className="h-full bg-green-500 transition-all" style={{ width: "23%" }} />
                  <div className="h-full bg-blue-500 transition-all" style={{ width: "38.5%" }} />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-[10px] text-muted-foreground">İktidar</span>
                  <span className="text-[10px] text-muted-foreground">Bağımsız</span>
                  <span className="text-[10px] text-muted-foreground">Muhalefet</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Blocks — alternating ─────────────── */}
      <section className="py-16 sm:py-20">
        <div className="container mx-auto px-4 space-y-20">
          {/* Feature 1: Bias Spectrum */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Yanlılık Spektrumu
                </span>
              </div>
              <h3 className="text-xl font-bold tracking-tight mb-3 sm:text-2xl">
                Her hikayenin renk haritası
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Bir haberi kaç kaynak verdi? Kaçı iktidar yanlısı, kaçı muhalefet?
                Spektrum çubuğu ile tek bakışta anlayın. Dengesiz dağılımlar
                otomatik olarak işaretlenir.
              </p>
            </div>
            {/* Visual */}
            <div className="space-y-3">
              {[
                { label: "Ekonomi Paketi", r: 50, g: 20, b: 30 },
                { label: "Deprem Yardımları", r: 25, g: 45, b: 30 },
                { label: "Dış Politika Krizi", r: 70, g: 10, b: 20 },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-border/30 bg-card/30 p-3">
                  <p className="text-xs font-medium mb-2">{item.label}</p>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/30">
                    <div className="h-full bg-red-500" style={{ width: `${item.r}%` }} />
                    <div className="h-full bg-green-500" style={{ width: `${item.g}%` }} />
                    <div className="h-full bg-blue-500" style={{ width: `${item.b}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature 2: Blindspots */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center max-w-5xl mx-auto">
            {/* Visual first on desktop */}
            <div className="order-2 lg:order-1 space-y-3">
              {[
                {
                  title: "Gazetecinin Tutuklanması",
                  side: "Muhalefet",
                  color: "border-l-blue-500",
                  sources: "Cumhuriyet, T24, BirGün",
                },
                {
                  title: "Yeni Ekonomik Teşvik Paketi",
                  side: "Hükümete Yakın",
                  color: "border-l-red-500",
                  sources: "Sabah, Star, A Haber",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className={`border-l-2 ${item.color} rounded-r-lg bg-card/30 border border-border/30 border-l-2 p-4`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                    <span className="text-[9px] uppercase tracking-wider text-amber-400 font-semibold">
                      Kör Nokta
                    </span>
                  </div>
                  <p className="text-sm font-semibold mb-1">{item.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Sadece <span className="text-foreground/70">{item.side}</span>{" "}
                    kaynaklar tarafından aktarıldı
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {item.sources}
                  </p>
                </div>
              ))}
            </div>

            <div className="order-1 lg:order-2">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Kör Noktalar
                </span>
              </div>
              <h3 className="text-xl font-bold tracking-tight mb-3 sm:text-2xl">
                Anlatılmayan hikayeleri bulun
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Bazı haberler sadece bir tarafın medyasında yer alıyor.
                Bu &quot;kör noktalar&quot; medyanın en tehlikeli
                yanlılık biçimi — çünkü var olduğunu bile bilmiyorsunuz.
                Tayf bunları otomatik tespit eder.
              </p>
            </div>
          </div>

          {/* Feature 3: Clustering */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Haber Kümeleme
                </span>
              </div>
              <h3 className="text-xl font-bold tracking-tight mb-3 sm:text-2xl">
                Karşılaştırın, karar verin
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                AI destekli kümeleme sistemi, aynı olayı farklı açılardan
                anlatan haberleri gruplar. Sabah ne diyor, Cumhuriyet ne diyor,
                Reuters ne diyor — hepsini yan yana görün.
              </p>
            </div>
            {/* Visual */}
            <div className="rounded-xl border border-border/30 bg-card/30 p-5">
              <p className="text-xs font-medium mb-4 text-muted-foreground">
                Örnek Küme: &quot;Ekonomi Paketi&quot;
              </p>
              <div className="space-y-2.5">
                {[
                  {
                    source: "Sabah",
                    title: "Tarihi ekonomi paketi açıklandı: Vatandaşa müjde",
                    color: "bg-red-500",
                  },
                  {
                    source: "Reuters TR",
                    title: "Türkiye yeni ekonomik teşvik paketini duyurdu",
                    color: "bg-green-500",
                  },
                  {
                    source: "Cumhuriyet",
                    title: "Ekonomi paketi beklentilerin altında kaldı",
                    color: "bg-blue-500",
                  },
                ].map((item) => (
                  <div
                    key={item.source}
                    className="flex items-start gap-2.5 rounded-lg bg-muted/20 p-2.5"
                  >
                    <span className={`mt-1.5 h-2 w-2 rounded-full ${item.color} shrink-0`} />
                    <div>
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {item.source}
                      </span>
                      <p className="text-xs leading-snug">{item.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="border-t border-border/30">
        <div className="container mx-auto px-4 py-20 sm:py-24">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl mb-3">
              Kendi gözlerinizle görün.
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Tayf tamamen ücretsiz. Kayıt gerekmez.
              Hemen haberleri keşfetmeye başlayın.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/">
                <Button size="lg" className="gap-2 px-8 h-11">
                  Haberleri Keşfet
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/blindspots">
                <Button variant="outline" size="lg" className="gap-2 px-6 h-11">
                  Kör Noktalar
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="border-t border-border/30 py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground">
                <Eye className="h-3.5 w-3.5 text-background" />
              </div>
              <span className="text-sm font-bold">Tayf</span>
              <Separator orientation="vertical" className="h-3" />
              <span className="text-[10px] text-muted-foreground">
                Haberlerin spektrumunu görün
              </span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Haberler
              </Link>
              <Link href="/blindspots" className="hover:text-foreground transition-colors">
                Kör Noktalar
              </Link>
              <Link href="/sources" className="hover:text-foreground transition-colors">
                Kaynaklar
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
