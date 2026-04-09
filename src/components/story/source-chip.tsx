import { ExternalLink } from "lucide-react";

import type { Source, MediaDnaZone } from "@/types";
import { zoneOf, ZONE_META } from "@/lib/bias/config";

/**
 * Shared `<SourceChip>` primitive — a Server Component (no state, no hooks).
 *
 * Background: chip-per-source JSX is currently re-implemented inline in
 * `cluster-card.tsx`, `cluster-stance.tsx`, and `media-dna.tsx`. They all
 * share the same shape (zone dot at the leading edge, source name in bold,
 * `ZONE_META[zone].chipBg/chipText/chipBorder` for tinting) but diverge in
 * small layout-specific ways.
 *
 * This component is the common denominator. As of W4-Q1 only the simplest
 * consumer (`cluster-stance.tsx`) is wired through it; the other two have
 * more layout-specific needs and are left for a follow-up refactor.
 *
 * Server Component only — do not introduce client-side state, refs, or
 * effects here. Tailwind class strings are kept as literals so the JIT
 * compiler picks them up at build time.
 */

export interface SourceChipProps {
  source: Source;
  /** Override the auto-computed zone if the consumer wants a specific tint. */
  zone?: MediaDnaZone;
  /** Extra classes appended to the chip's base className. */
  className?: string;
  /** Render an external link icon at the trailing edge. */
  showExternalIcon?: boolean;
  /** Dim the chip (used for "not in this cluster"). */
  dimmed?: boolean;
  /** Optional title/article text to show after the source name. */
  title?: string;
  /** Truncate the title to this many chars. */
  titleMaxChars?: number;
  /** If provided, wrap the chip in an <a href={href} target="_blank">. */
  href?: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function SourceChip({
  source,
  zone,
  className,
  showExternalIcon = false,
  dimmed = false,
  title,
  titleMaxChars,
  href,
}: SourceChipProps) {
  const resolvedZone: MediaDnaZone = zone ?? zoneOf(source.bias);
  const meta = ZONE_META[resolvedZone];

  const displayTitle =
    title !== undefined && titleMaxChars !== undefined
      ? truncate(title, titleMaxChars)
      : title;

  const baseClass = `group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200 hover:shadow-sm ${meta.chipBg} ${meta.chipHover} ${meta.chipText} ${meta.chipBorder}`;
  const dimmedClass = dimmed ? " opacity-30 transition-opacity duration-300" : "";
  const extraClass = className ? ` ${className}` : "";
  const finalClass = `${baseClass}${dimmedClass}${extraClass}`;

  // Hover-tooltip text. Mirrors the previous inline behavior in
  // cluster-stance: when both source and title are present we join them
  // with an em-dash.
  const tooltip =
    title !== undefined ? `${source.name} — ${title}` : source.name;

  const inner = (
    <>
      <span
        className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
        aria-hidden="true"
      />
      <span className="font-semibold">{source.name}</span>
      {displayTitle !== undefined && (
        <span className="ml-1.5 opacity-80">{displayTitle}</span>
      )}
      {showExternalIcon && (
        <ExternalLink
          className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100 ml-1"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className={finalClass}
      >
        {inner}
      </a>
    );
  }

  return (
    <span title={tooltip} className={finalClass}>
      {inner}
    </span>
  );
}
