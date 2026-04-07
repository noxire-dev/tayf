import { Badge } from "@/components/ui/badge";
import type { AlignmentCategory, TraditionCategory } from "@/types";
import { ALIGNMENT_META, TRADITION_META } from "@/types";

const ALIGNMENT_STYLES: Record<AlignmentCategory, string> = {
  pro_government:
    "bg-red-600/15 text-red-700 dark:text-red-400 border-red-600/20",
  gov_leaning:
    "bg-red-400/15 text-red-600 dark:text-red-300 border-red-400/20",
  center:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  opposition_leaning:
    "bg-blue-400/15 text-blue-600 dark:text-blue-300 border-blue-400/20",
  opposition:
    "bg-blue-600/15 text-blue-700 dark:text-blue-400 border-blue-600/20",
};

export function AlignmentBadge({
  alignment,
  size = "default",
}: {
  alignment: AlignmentCategory;
  size?: "sm" | "default";
}) {
  const style = ALIGNMENT_STYLES[alignment];
  const sizeClass = size === "sm" ? "text-[10px] px-1.5 py-0" : "";

  return (
    <Badge variant="outline" className={`${style} ${sizeClass}`}>
      {ALIGNMENT_META[alignment].label}
    </Badge>
  );
}

const TRADITION_STYLES: Record<TraditionCategory, string> = {
  mainstream: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/20",
  islamist: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  nationalist: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20",
  secular: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20",
  left: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20",
  kurdish: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/20",
  state: "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/20",
  international: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
};

export function TraditionBadge({
  tradition,
  size = "default",
}: {
  tradition: TraditionCategory;
  size?: "sm" | "default";
}) {
  if (tradition === "mainstream") return null; // don't show badge for mainstream
  const style = TRADITION_STYLES[tradition];
  const sizeClass = size === "sm" ? "text-[10px] px-1.5 py-0" : "";

  return (
    <Badge variant="outline" className={`${style} ${sizeClass}`}>
      {TRADITION_META[tradition].label}
    </Badge>
  );
}
