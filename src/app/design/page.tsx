import Link from "next/link";
import { ArrowRight, Palette } from "lucide-react";

const designs = [
  {
    id: 1,
    name: "Prism",
    subtitle: "Bold & Centered",
    description:
      "Centered hero with spectrum gradient, floating light lines, stats strip, how-it-works steps, interactive spectrum demo, feature grid, and a strong CTA. High impact, cinematic.",
    tags: ["Gradient Hero", "Stats", "How It Works", "Feature Grid", "Demo"],
    accent: "from-red-500 via-green-500 to-blue-500",
  },
  {
    id: 2,
    name: "Wire",
    subtitle: "Editorial & Story-driven",
    description:
      "Left-aligned editorial hero, quote block, full source map with pills, alternating feature sections with live mockups (spectrum bars, blindspot cards, clustering example). Newspaper feel.",
    tags: ["Editorial", "Quote", "Source Map", "Alternating Sections", "Mockups"],
    accent: "from-blue-500 via-emerald-500 to-amber-500",
  },
];

export default function DesignIndexPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/10">
          <Palette className="h-4 w-4" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Homepage Designs</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        Marketing / landing page concepts for Tayf. Click to preview.
      </p>

      <div className="space-y-4">
        {designs.map((d) => (
          <Link
            key={d.id}
            href={`/design/${d.id}`}
            className="group block rounded-xl border border-border/50 bg-card/50 p-5 hover:border-border hover:bg-card transition-all"
          >
            <div
              className={`h-1 w-16 rounded-full bg-gradient-to-r ${d.accent} mb-4 opacity-60 group-hover:opacity-100 group-hover:w-24 transition-all duration-300`}
            />

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base font-bold">{d.name}</span>
                  <span className="text-xs text-muted-foreground">
                    — {d.subtitle}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {d.description}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {d.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg bg-muted/50 group-hover:bg-foreground group-hover:text-background transition-all">
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
