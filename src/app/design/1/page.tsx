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
  Search,
  Shield,
  BarChart3,
  ChevronRight,
  Sparkles,
  Globe,
  Scale,
} from "lucide-react";

export default function Page() {
  return (
    <div className="min-h-screen">
      {/* ── Hero ─────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 opacity-[0.06]">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500 via-green-500 to-blue-500" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/90 to-background" />

        {/* Floating spectrum lines */}
        <div className="absolute top-1/3 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/20 to-transparent" />
        <div className="absolute top-[38%] left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-500/15 to-transparent" />
        <div className="absolute top-[43%] left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/10 to-transparent" />

        <div className="container relative mx-auto px-4 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <div className="max-w-3xl mx-auto text-center">
            {/* Spectrum accent */}
            <div className="flex justify-center mb-6">
              <div className="flex h-1.5 w-32 overflow-hidden rounded-full">
                <div className="h-full w-1/3 bg-red-500" />
                <div className="h-full w-1/3 bg-green-500" />
                <div className="h-full w-1/3 bg-blue-500" />
              </div>
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-[1.1]">
              Haberlerin arkasındaki
              <br />
              <span className="bg-gradient-to-r from-red-400 via-green-400 to-blue-400 bg-clip-text text-transparent">
                spektrumu
              </span>{" "}
              görün.
            </h1>

            <p className="mt-5 text-base text-muted-foreground max-w-xl mx-auto leading-relaxed sm:text-lg">
              Tayf, Türkiye&apos;nin haber kaynaklarını analiz eder. Aynı haberin
              farklı medya perspektiflerinden nasıl yansıtıldığını görün,
              kör noktaları keşfedin.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/">
                <Button size="lg" className="gap-2 px-6">
                  Haberleri Keşfet
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/blindspots">
                <Button variant="outline" size="lg" className="gap-2 px-6">
                  <AlertTriangle className="h-4 w-4" />
                  Kör Noktalar
                </Button>
              </Link>
            </div>

            {/* Live stats strip */}
            <div className="mt-12 flex items-center justify-center gap-6 sm:gap-10 text-center">
              {[
                { value: "13+", label: "Haber Kaynağı" },
                { value: "3", label: "Yanlılık Kategorisi" },
                { value: "8", label: "Haber Alanı" },
                { value: "7/24", label: "Canlı Takip" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {stat.value}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
      </section>

      {/* ── How It Works ─────────────────────────────── */}
      <section className="py-20 sm:py-24">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Nasıl Çalışır
            </p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Her haberin üç yüzü vardır
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              {
                step: "01",
                icon: Newspaper,
                color: "text-red-400 bg-red-500/10 border-red-500/20",
                barColor: "bg-red-500",
                title: "Topla",
                description:
                  "13 farklı haber kaynağından RSS ile anlık olarak haberleri topluyoruz. Hükümete yakın, muhalefet ve bağımsız medya.",
              },
              {
                step: "02",
                icon: Layers,
                color: "text-green-400 bg-green-500/10 border-green-500/20",
                barColor: "bg-green-500",
                title: "Kümele",
                description:
                  "AI destekli analiz ile aynı olayı farklı açılardan anlatan haberleri bir araya getiriyoruz. Hangi kaynaklar ne diyor?",
              },
              {
                step: "03",
                icon: Eye,
                color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
                barColor: "bg-blue-500",
                title: "Aydınlat",
                description:
                  "Yanlılık dağılımını görselleştiriyoruz. Hangi hikayeler sadece tek taraftan anlatılıyor? Kör noktaları ortaya çıkarıyoruz.",
              },
            ].map((item) => (
              <div key={item.step} className="group relative">
                {/* Step bar top */}
                <div className={`h-1 w-12 rounded-full ${item.barColor} mb-5 group-hover:w-20 transition-all duration-300`} />

                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border ${item.color}`}
                  >
                    <item.icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground/40">
                    {item.step}
                  </span>
                </div>

                <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bias Spectrum Demo ───────────────────────── */}
      <section className="py-20 sm:py-24 border-y border-border/30">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              {/* Left: explanation */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                  Yanlılık Spektrumu
                </p>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl mb-4">
                  Tek bakışta tüm resmi görün
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                  Her haber kümesi için kaynak dağılımını görselleştiriyoruz.
                  Hangi hikaye tek taraflı, hangisi dengeli — anında anlayın.
                </p>

                <div className="space-y-4">
                  {[
                    {
                      color: "bg-red-500",
                      label: "Hükümete Yakın",
                      desc: "İktidar yanlısı medya kuruluşları",
                      sources: "Sabah, Star, Yeni Şafak, A Haber, TRT",
                    },
                    {
                      color: "bg-green-500",
                      label: "Bağımsız",
                      desc: "Bağımsız ve tarafsız kaynaklar",
                      sources: "Reuters TR, BBC Türkçe, DW Türkçe",
                    },
                    {
                      color: "bg-blue-500",
                      label: "Muhalefet",
                      desc: "Muhalefet perspektifli medya",
                      sources: "Cumhuriyet, BirGün, T24, Sözcü, Halk TV",
                    },
                  ].map((bias) => (
                    <div key={bias.label} className="flex items-start gap-3">
                      <div className={`mt-1.5 h-2.5 w-2.5 rounded-full ${bias.color} shrink-0`} />
                      <div>
                        <p className="text-sm font-medium">{bias.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {bias.desc}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {bias.sources}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: visual demo */}
              <div className="space-y-4">
                {/* Mock spectrum cards */}
                {[
                  {
                    title: "Ekonomi Paketi Açıklandı",
                    dist: [45, 15, 40],
                    count: 9,
                  },
                  {
                    title: "Yerel Seçim Anketleri",
                    dist: [30, 10, 60],
                    count: 11,
                  },
                  {
                    title: "Suriye Sınır Operasyonu",
                    dist: [60, 25, 15],
                    count: 7,
                    blindspot: true,
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-xl border border-border/40 bg-card/50 p-4 hover:border-border/70 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">{item.title}</h4>
                      <div className="flex items-center gap-1.5">
                        {item.blindspot && (
                          <span className="flex items-center gap-1 text-[9px] text-amber-400 font-medium">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Kör Nokta
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {item.count} kaynak
                        </span>
                      </div>
                    </div>
                    {/* Spectrum bar */}
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="h-full bg-red-500 transition-all"
                        style={{ width: `${item.dist[0]}%` }}
                      />
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{ width: `${item.dist[1]}%` }}
                      />
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${item.dist[2]}%` }}
                      />
                    </div>
                    <div className="flex gap-3 mt-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 mr-1" />
                        %{item.dist[0]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 mr-1" />
                        %{item.dist[1]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400 mr-1" />
                        %{item.dist[2]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid ────────────────────────────── */}
      <section className="py-20 sm:py-24">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Özellikler
            </p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Medya okuryazarlığı için araçlar
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {[
              {
                icon: BarChart3,
                title: "Yanlılık Analizi",
                desc: "Her haber kaynağının politik konumlandırmasını anlık görün.",
              },
              {
                icon: AlertTriangle,
                title: "Kör Nokta Tespiti",
                desc: "Sadece tek tarafın anlattığı haberleri otomatik tespit edin.",
              },
              {
                icon: Layers,
                title: "Haber Kümeleme",
                desc: "Aynı olayı farklı kaynakların nasıl aktardığını karşılaştırın.",
              },
              {
                icon: Search,
                title: "Kategori Filtreleme",
                desc: "Politika, ekonomi, dünya, spor — ilgi alanınıza göre filtreleyin.",
              },
              {
                icon: Globe,
                title: "13+ Kaynak",
                desc: "Türkiye'nin en geniş haber kaynağı yelpazesinden haberler.",
              },
              {
                icon: Shield,
                title: "Şeffaf ve Bağımsız",
                desc: "Hiçbir kaynağa bağlı değiliz. Amacımız yalnızca şeffaflık.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-border/30 bg-card/30 p-5 hover:border-border/60 hover:bg-card/50 transition-all"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground/5 border border-border/30 mb-4 group-hover:bg-foreground/10 transition-colors">
                  <feature.icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
                <h3 className="text-sm font-bold mb-1.5">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-border/30">
        <div className="absolute inset-0 opacity-[0.04]">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-green-500 to-red-500" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/95 to-background/80" />

        <div className="container relative mx-auto px-4 py-20 sm:py-24 text-center">
          <div className="flex justify-center mb-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/10 border border-border/30">
              <Scale className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl mb-3">
            Haberlerin tüm renklerini görmeye hazır mısınız?
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-8">
            Tayf ile Türkiye medyasının tam spektrumunu keşfedin.
            Ücretsiz, kayıt gerektirmez.
          </p>

          <Link href="/">
            <Button size="lg" className="gap-2 px-8">
              Hemen Başla
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
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
              <span className="text-[10px] text-muted-foreground">
                Türkiye Haber Analizi
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
