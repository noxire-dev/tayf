// Top-of-page hero block used by the main content pages (/stories, /clusters).
// Pure presentational server component — no state, no hooks, no "use client".
// Props are intentionally simple strings so every caller passes Turkish copy
// verbatim and nothing leaks through i18n helpers.
//
// W3-U6: editorial polish per R4's ui-audit. The previous hero had "no lift"
// against the body — same vertical rhythm as a card. Changes:
//   • bumped vertical spacing (space-y-1.5 → space-y-3 + pb-2)
//   • kicker now sits in a flex row with a 24px rule, giving it a dateline feel
//   • h1 grows to lg:text-4xl and tightens to leading-[1.1]
//   • subtitle gets a max-width and `leading-relaxed` so it reads as a deck

import { Separator } from "./separator";

interface PageHeroProps {
  /** Optional small label shown above the title (e.g. "Günün Hikâyeleri"). */
  kicker?: string;
  /** Main H1 heading. */
  title: string;
  /** Supporting paragraph under the title. */
  subtitle?: string;
}

export function PageHero({ kicker, title, subtitle }: PageHeroProps) {
  return (
    <header className="space-y-3 pb-2">
      {kicker ? (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {kicker}
          </span>
          <Separator
            orientation="horizontal"
            className="h-px w-6 bg-border/60"
          />
        </div>
      ) : null}
      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-[1.1]">
        {title}
      </h1>
      {subtitle ? (
        <p className="max-w-2xl text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}
