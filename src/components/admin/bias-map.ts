// Thin adapter that re-shapes the canonical bias palette from
// `@/lib/bias/config` into the `{ label, dot, pill }` shape that the admin
// source management UI (`SourceRow`, `SourceDialog`) expects.
//
// Option B was chosen: the admin pill uses a single-color text class
// (e.g. `text-red-400`) rather than the config's dual `text-red-700
// dark:text-red-400`, and the `center` dot uses the lighter `.dot` variant
// instead of `.solid`. Keeping this adapter preserves the exact admin-panel
// rendering while sourcing all labels, chip backgrounds and chip borders from
// the single source of truth in `@/lib/bias/config`. Do NOT redefine labels
// or bg/border colors here — if you need to tweak one, change
// `src/lib/bias/config.ts` instead.
import { BIAS_LABELS, BIAS_COLORS } from "@/lib/bias/config";
import type { BiasCategory } from "@/types";

export interface BiasMeta {
  label: string;
  /** Tailwind bg class used for the legend circle in the Select. */
  dot: string;
  /** Pre-composed chip classes (bg + single-color text + border). */
  pill: string;
}

/**
 * Admin uses the lighter `.dot` variant for `center` (a dark zinc-500 dot
 * disappears against the near-black admin background); every other category
 * uses the `.solid` 500-weight class.
 */
const DOT_OVERRIDES: Partial<Record<BiasCategory, string>> = {
  center: BIAS_COLORS.center.dot,
};

/**
 * Admin pills use a single 400-weight text class (the admin panel is
 * dark-only). These are kept as literal strings so Tailwind's JIT can
 * statically detect them.
 */
const PILL_TEXT: Record<BiasCategory, string> = {
  pro_government: "text-red-400",
  gov_leaning: "text-orange-400",
  state_media: "text-rose-400",
  islamist_conservative: "text-purple-400",
  center: "text-zinc-400",
  international: "text-slate-400",
  pro_kurdish: "text-teal-400",
  opposition_leaning: "text-sky-400",
  opposition: "text-emerald-400",
  nationalist: "text-amber-400",
};

/**
 * Admin-specific display order for the bias `<Select>` in `SourceDialog`.
 * Intentionally differs from `BIAS_ORDER` in `@/lib/bias/config` (which is a
 * left-to-right spectrum order) — this order groups the admin dropdown
 * logically.
 */
const ADMIN_ORDER: BiasCategory[] = [
  "pro_government",
  "gov_leaning",
  "state_media",
  "islamist_conservative",
  "center",
  "international",
  "pro_kurdish",
  "opposition_leaning",
  "opposition",
  "nationalist",
];

export const BIAS_MAP: Record<BiasCategory, BiasMeta> = Object.fromEntries(
  ADMIN_ORDER.map((bias): [BiasCategory, BiasMeta] => {
    const color = BIAS_COLORS[bias];
    return [
      bias,
      {
        label: BIAS_LABELS[bias],
        dot: DOT_OVERRIDES[bias] ?? color.solid,
        pill: `${color.chipBg} ${PILL_TEXT[bias]} ${color.chipBorder}`,
      },
    ];
  }),
) as Record<BiasCategory, BiasMeta>;

export function biasColor(bias: string): string {
  return BIAS_MAP[bias as BiasCategory]?.pill ?? "";
}

export function biasLabel(bias: string): string {
  return BIAS_MAP[bias as BiasCategory]?.label ?? bias;
}
