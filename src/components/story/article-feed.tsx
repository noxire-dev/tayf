"use client";

import { useState, useMemo } from "react";
import { ArticleCard } from "./article-card";
import { CategoryFilter } from "./category-filter";
import { BiasSpectrum } from "./bias-spectrum";
import type { Article, BiasDistribution, NewsCategory } from "@/types";

export function ArticleFeed({ articles }: { articles: Article[] }) {
  const [selectedCategory, setSelectedCategory] = useState<
    NewsCategory | "all"
  >("all");

  // Count articles per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const article of articles) {
      const cat = article.category || "genel";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [articles]);

  // Filter articles by selected category
  const filtered = useMemo(() => {
    if (selectedCategory === "all") return articles;
    return articles.filter((a) => a.category === selectedCategory);
  }, [articles, selectedCategory]);

  // Bias distribution for filtered articles
  const distribution = useMemo(() => {
    const d: BiasDistribution = {
      pro_government: 0,
      opposition: 0,
      independent: 0,
    };
    for (const article of filtered) {
      if (article.source?.bias) d[article.source.bias]++;
    }
    return d;
  }, [filtered]);

  return (
    <div>
      {/* Category filter */}
      <div className="mb-4">
        <CategoryFilter
          selected={selectedCategory}
          onSelect={setSelectedCategory}
          counts={categoryCounts}
        />
      </div>

      {/* Bias distribution bar */}
      <div className="mb-6 max-w-sm">
        <p className="text-[11px] text-muted-foreground mb-1.5">
          Kaynak dağılımı — {filtered.length} haber
        </p>
        <BiasSpectrum distribution={distribution} />
      </div>

      {/* Article grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground">
            Bu kategoride henüz haber yok.
          </p>
        </div>
      )}
    </div>
  );
}
