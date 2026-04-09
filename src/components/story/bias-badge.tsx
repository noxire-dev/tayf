import { Badge } from "@/components/ui/badge";
import type { BiasCategory } from "@/types";
import { BIAS_COLORS, BIAS_LABELS } from "@/lib/bias/config";

// Backward-compatible shape for any consumer still importing
// `BIAS_BADGE_CONFIG` (e.g. `media-dna.tsx`). The single source of truth
// now lives in `@/lib/bias/config`.
export const BIAS_BADGE_CONFIG: Record<
  BiasCategory,
  { label: string; className: string }
> = Object.fromEntries(
  (Object.keys(BIAS_LABELS) as BiasCategory[]).map((bias) => [
    bias,
    { label: BIAS_LABELS[bias], className: BIAS_COLORS[bias].className },
  ]),
) as Record<BiasCategory, { label: string; className: string }>;

export function BiasBadge({
  bias,
  size = "default",
}: {
  bias: BiasCategory;
  size?: "sm" | "default";
}) {
  const label = BIAS_LABELS[bias];
  const className = BIAS_COLORS[bias].className;
  const sizeClass = size === "sm" ? "text-[10px] px-1.5 py-0" : "";

  return (
    <Badge variant="outline" className={`${className} ${sizeClass}`}>
      {label}
    </Badge>
  );
}
