"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlignmentBadge, TraditionBadge } from "./bias-badge";
import { CategoryBadge } from "./category-badge";
import { Newspaper, Clock } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import type { Article } from "@/types";

export function ArticleCard({
  article,
  onClick,
}: {
  article: Article;
  onClick?: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showImage = article.image_url && !imgError;

  return (
    <Card className="group overflow-hidden border-border/50 hover:border-border transition-all hover:shadow-md cursor-pointer">
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
        className="block h-full outline-none"
      >
        {/* Image or placeholder */}
        <div className="relative aspect-[16/9] overflow-hidden bg-muted">
          {showImage ? (
            <img
              src={article.image_url!}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50">
              <Newspaper className="h-8 w-8 text-muted-foreground/30" />
            </div>
          )}

          {/* Source name overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white/90">
                {article.source?.name}
              </span>
            </div>
          </div>

          {/* Category badge top-left */}
          {article.category && article.category !== "genel" && (
            <div className="absolute top-2 left-2">
              <CategoryBadge category={article.category} />
            </div>
          )}
        </div>

        {/* Content */}
        <CardHeader className="p-3 pb-1.5">
          <div className="flex items-center gap-2 mb-1">
            {article.source && (
              <>
                <AlignmentBadge alignment={article.source.alignment} size="sm" />
                <TraditionBadge tradition={article.source.tradition} size="sm" />
              </>
            )}
            <span
              className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto"
              suppressHydrationWarning
            >
              <Clock className="h-2.5 w-2.5" />
              {timeAgo(article.published_at)}
            </span>
          </div>
          <CardTitle className="text-[13px] font-semibold leading-snug line-clamp-2">
            {article.title}
          </CardTitle>
        </CardHeader>

        {article.description && (
          <CardContent className="px-3 pb-3 pt-0">
            <CardDescription className="text-xs leading-relaxed line-clamp-2 text-muted-foreground/80">
              {article.description}
            </CardDescription>
          </CardContent>
        )}
      </div>
    </Card>
  );
}
