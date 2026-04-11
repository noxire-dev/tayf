// Page hero — editorial masthead for content pages.
// Uses the serif heading font from the design system for a newspaper feel.

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
    <header className="space-y-4 pb-4">
      {kicker ? (
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            {kicker}
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-brand/30 to-transparent" />
        </div>
      ) : null}
      <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal tracking-tight leading-[1.08]">
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
