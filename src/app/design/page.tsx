import Link from "next/link";
import { ArrowRight, Palette } from "lucide-react";

const designs = [
  {
    id: 1,
    name: "Observatory",
    subtitle: "Dark & Immersive",
    description:
      "Bloomberg meets Stripe. Grid pattern background, ambient glow, monospace accents, live analysis demo card in the hero, vertical timeline for how-it-works. Data-visualization aesthetic.",
    tags: ["Ambient Glow", "Grid BG", "Mono Type", "Live Demo", "Timeline"],
    accent: "from-red-500 via-emerald-500 to-blue-500",
  },
  {
    id: 2,
    name: "Gazette",
    subtitle: "Editorial & Story-driven",
    description:
      "Modern newspaper aesthetic. Left-aligned hero with same-story comparison, pull quote block, three-pillar feature cards, grouped source map. Clean editorial rules and generous whitespace.",
    tags: ["Editorial", "Pull Quote", "Source Groups", "Pillar Cards"],
    accent: "from-red-500 via-emerald-500 to-blue-500",
  },
  {
    id: 3,
    name: "Signal",
    subtitle: "Ultra-minimal",
    description:
      "Apple-esque zen. Massive typography, extreme whitespace, one idea per screen. The three-headline comparison as a centerpiece. Features as full-bleed sections. Almost meditative.",
    tags: ["Big Type", "Zen", "One Idea/Screen", "Full-bleed"],
    accent: "from-white/40 via-white/10 to-white/40",
  },
  {
    id: 4,
    name: "Mosaic",
    subtitle: "Warm & Approachable",
    description:
      "Linear meets Notion. Rounded cards, warm ambient glows, bento grid features, ring-accented bias dots, wavy underline in hero. Friendly but smart — built for real people.",
    tags: ["Bento Grid", "Warm Glow", "Rounded", "Approachable"],
    accent: "from-amber-500 via-rose-500 to-blue-500",
  },
];

export default function DesignIndexPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
          <Palette className="h-4 w-4" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Homepage Designs</h1>
      </div>
      <p className="text-sm text-white/40 mb-8">
        4 landing page concepts for Tayf. Each has a distinct personality.
      </p>

      <div className="space-y-3">
        {designs.map((d) => (
          <Link
            key={d.id}
            href={`/design/${d.id}`}
            className="group block rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all"
          >
            <div
              className={`h-1 w-16 rounded-full bg-gradient-to-r ${d.accent} mb-4 opacity-50 group-hover:opacity-100 group-hover:w-24 transition-all duration-300`}
            />

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-base font-bold text-white/90">{d.name}</span>
                  <span className="text-xs text-white/25">
                    {d.subtitle}
                  </span>
                </div>
                <p className="text-sm text-white/35 leading-relaxed mb-3">
                  {d.description}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {d.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/25"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg bg-white/[0.04] group-hover:bg-white group-hover:text-black transition-all">
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
