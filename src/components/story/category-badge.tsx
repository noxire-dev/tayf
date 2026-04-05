import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Landmark,
  Globe,
  TrendingUp,
  Trophy,
  Cpu,
  Heart,
  Newspaper,
} from "lucide-react";
import type { NewsCategory } from "@/types";

const CATEGORY_CONFIG: Record<
  NewsCategory,
  { label: string; icon: React.ElementType; className: string }
> = {
  son_dakika: {
    label: "Son Dakika",
    icon: Zap,
    className: "bg-red-600 text-white border-transparent",
  },
  politika: {
    label: "Politika",
    icon: Landmark,
    className: "bg-purple-500/90 text-white border-transparent",
  },
  dunya: {
    label: "Dünya",
    icon: Globe,
    className: "bg-sky-500/90 text-white border-transparent",
  },
  ekonomi: {
    label: "Ekonomi",
    icon: TrendingUp,
    className: "bg-amber-500/90 text-white border-transparent",
  },
  spor: {
    label: "Spor",
    icon: Trophy,
    className: "bg-emerald-500/90 text-white border-transparent",
  },
  teknoloji: {
    label: "Teknoloji",
    icon: Cpu,
    className: "bg-indigo-500/90 text-white border-transparent",
  },
  yasam: {
    label: "Yaşam",
    icon: Heart,
    className: "bg-pink-500/90 text-white border-transparent",
  },
  genel: {
    label: "Genel",
    icon: Newspaper,
    className: "bg-zinc-500/90 text-white border-transparent",
  },
};

export function CategoryBadge({ category }: { category: NewsCategory }) {
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;

  return (
    <Badge className={`${config.className} text-[10px] gap-1 px-1.5 py-0.5 font-medium shadow-sm`}>
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </Badge>
  );
}
