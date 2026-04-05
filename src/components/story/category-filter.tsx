"use client";

import {
  Zap,
  Landmark,
  Globe,
  TrendingUp,
  Trophy,
  Cpu,
  Heart,
  Newspaper,
  LayoutGrid,
} from "lucide-react";
import type { NewsCategory } from "@/types";

const FILTER_ITEMS: {
  key: NewsCategory | "all";
  label: string;
  icon: React.ElementType;
}[] = [
  { key: "all", label: "Tümü", icon: LayoutGrid },
  { key: "son_dakika", label: "Son Dakika", icon: Zap },
  { key: "politika", label: "Politika", icon: Landmark },
  { key: "dunya", label: "Dünya", icon: Globe },
  { key: "ekonomi", label: "Ekonomi", icon: TrendingUp },
  { key: "spor", label: "Spor", icon: Trophy },
  { key: "teknoloji", label: "Teknoloji", icon: Cpu },
  { key: "yasam", label: "Yaşam", icon: Heart },
  { key: "genel", label: "Genel", icon: Newspaper },
];

export function CategoryFilter({
  selected,
  onSelect,
  counts,
}: {
  selected: NewsCategory | "all";
  onSelect: (category: NewsCategory | "all") => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
      {FILTER_ITEMS.map(({ key, label, icon: Icon }) => {
        const isActive = selected === key;
        const count = key === "all" ? undefined : counts[key] || 0;

        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={`
              flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all
              ${
                isActive
                  ? "bg-foreground text-background shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }
            `}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {count !== undefined && count > 0 && (
              <span
                className={`text-[10px] ${
                  isActive ? "text-background/70" : "text-muted-foreground/60"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
