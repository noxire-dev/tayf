import { Badge } from "@/components/ui/badge";
import type { BiasCategory } from "@/types";

const BIAS_CONFIG: Record<
  BiasCategory,
  { label: string; className: string }
> = {
  pro_government: {
    label: "Hükümete Yakın",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  },
  opposition: {
    label: "Muhalefet",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  },
  independent: {
    label: "Bağımsız",
    className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",
  },
};

export function BiasBadge({
  bias,
  size = "default",
}: {
  bias: BiasCategory;
  size?: "sm" | "default";
}) {
  const config = BIAS_CONFIG[bias];
  const sizeClass = size === "sm" ? "text-[10px] px-1.5 py-0" : "";

  return (
    <Badge variant="outline" className={`${config.className} ${sizeClass}`}>
      {config.label}
    </Badge>
  );
}
