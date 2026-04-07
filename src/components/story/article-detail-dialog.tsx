"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlignmentBadge, TraditionBadge } from "./bias-badge";
import { CategoryBadge } from "./category-badge";
import { AlignmentSpectrum } from "./bias-spectrum";
import { ExternalLink, Newspaper, Clock, Layers } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import type {
  Article,
  AlignmentCategory,
  AlignmentDistribution,
} from "@/types";

const ALIGNMENT_DOTS: Record<AlignmentCategory, string> = {
  pro_government: "bg-red-600",
  gov_leaning: "bg-red-400",
  center: "bg-emerald-500",
  opposition_leaning: "bg-blue-400",
  opposition: "bg-blue-600",
};

// ── Title similarity matching ──────────────────────────────────────

const TURKISH_STOP_WORDS = new Set([
  // Conjunctions, particles, postpositions
  "ve", "ile", "bir", "bu", "şu", "ki", "mi", "mu", "mü", "mı",
  "ise", "ama", "ancak", "fakat", "hem", "her", "hiç", "den", "dan",
  "için", "gibi", "daha", "kadar", "göre", "karşı", "üzere", "doğru",
  "rağmen", "dolayı", "sonra", "önce", "beri", "yana",
  // Pronouns, determiners
  "ben", "sen", "biz", "siz", "bazı", "birçok", "bütün", "tüm",
  "sadece", "henüz", "bile", "hala", "zaten", "artık", "diğer",
  // Very common verb forms in headlines
  "oldu", "olan", "olarak", "edildi", "yapıldı", "yapılan",
  "belirtildi", "açıklandı", "söyledi", "dedi", "olduğu", "olduğunu",
  "geldi", "verdi", "aldı", "yaptı", "etti", "gelen", "veren",
  // News filler
  "son", "dakika", "haber", "yeni", "gündem", "açıklama", "işte",
  "duyurdu", "belli", "gelişme", "ortaya", "çıktı", "detaylar",
  "bugün", "yarın", "dün", "haberleri", "haberi", "nedir",
]);

/** Tokenize a Turkish headline into a set of meaningful terms. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[''`']/g, " ") // split possessives: Erdoğan'ın → erdoğan ın
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip punctuation, keep unicode letters + digits
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TURKISH_STOP_WORDS.has(t));
}

/**
 * Check if two tokens refer to the same concept.
 * Handles Turkish agglutinative suffixes via prefix matching.
 * e.g. "cumhurbaşkanı" ↔ "cumhurbaşkanlığı", "ekonomi" ↔ "ekonomik"
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Prefix match — the shorter must be ≥4 chars to avoid false positives
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
  return false;
}

/**
 * Compute title similarity using Sørensen–Dice coefficient
 * with Turkish-aware token matching.
 * Returns 0..1 where 1 = identical headlines.
 */
function titleSimilarity(a: string, b: string): number {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.length === 0 || tokB.length === 0) return 0;

  let matches = 0;
  const usedB = new Set<number>();

  for (const ta of tokA) {
    for (let i = 0; i < tokB.length; i++) {
      if (usedB.has(i)) continue;
      if (tokensMatch(ta, tokB[i])) {
        matches++;
        usedB.add(i);
        break;
      }
    }
  }

  // Sørensen–Dice: 2 * |intersection| / (|A| + |B|)
  return (2 * matches) / (tokA.length + tokB.length);
}

// ── Related article finder ─────────────────────────────────────────

const MIN_SIMILARITY = 0.25;
const TIME_WINDOW_MS = 48 * 60 * 60 * 1000; // ±48 hours

/**
 * Find articles from other sources that cover the same story,
 * ranked by title similarity. No category constraint — different
 * sources often categorize the same story differently.
 */
function findRelatedArticles(
  article: Article,
  allArticles: Article[]
): Article[] {
  const t = new Date(article.published_at).getTime();
  const seenSources = new Set<string>();

  return (
    allArticles
      // Score every candidate
      .map((a) => ({
        article: a,
        similarity: titleSimilarity(article.title, a.title),
        timeDiff: Math.abs(new Date(a.published_at).getTime() - t),
      }))
      // Filter: different article, different source, within time window, above similarity threshold
      .filter(({ article: a, similarity, timeDiff }) => {
        if (a.id === article.id) return false;
        if (a.source_id === article.source_id) return false;
        if (timeDiff > TIME_WINDOW_MS) return false;
        if (similarity < MIN_SIMILARITY) return false;
        return true;
      })
      // Best matches first
      .sort((a, b) => b.similarity - a.similarity)
      // One article per source (the most similar one)
      .filter(({ article: a }) => {
        if (seenSources.has(a.source_id)) return false;
        seenSources.add(a.source_id);
        return true;
      })
      .slice(0, 12)
      .map(({ article: a }) => a)
  );
}

export function ArticleDetailDialog({
  article,
  allArticles,
  open,
  onOpenChange,
}: {
  article: Article | null;
  allArticles: Article[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const related = useMemo(() => {
    if (!article) return [];
    return findRelatedArticles(article, allArticles);
  }, [article, allArticles]);

  const coverageDistribution = useMemo(() => {
    const d: AlignmentDistribution = {
      pro_government: 0,
      gov_leaning: 0,
      center: 0,
      opposition_leaning: 0,
      opposition: 0,
    };
    // Include the selected article
    if (article?.source?.alignment) d[article.source.alignment]++;
    for (const r of related) {
      if (r.source?.alignment) d[r.source.alignment]++;
    }
    return d;
  }, [article, related]);

  if (!article) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {/* Hero image */}
        {article.image_url ? (
          <div className="relative aspect-[2/1] overflow-hidden rounded-t-xl">
            <img
              src={article.image_url}
              alt=""
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            {article.category && article.category !== "genel" && (
              <div className="absolute top-3 left-3">
                <CategoryBadge category={article.category} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-28 items-center justify-center bg-gradient-to-br from-muted to-muted/50 rounded-t-xl">
            <Newspaper className="h-10 w-10 text-muted-foreground/30" />
            {article.category && article.category !== "genel" && (
              <div className="absolute top-3 left-3">
                <CategoryBadge category={article.category} />
              </div>
            )}
          </div>
        )}

        <div className="px-5 pb-5 pt-4 space-y-4">
          {/* Source info */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">
              {article.source?.name}
            </span>
            {article.source && (
              <>
                <AlignmentBadge
                  alignment={article.source.alignment}
                  size="sm"
                />
                <TraditionBadge
                  tradition={article.source.tradition}
                  size="sm"
                />
              </>
            )}
            <span
              className="flex items-center gap-1 text-[11px] text-muted-foreground ml-auto"
              suppressHydrationWarning
            >
              <Clock className="h-3 w-3" />
              {timeAgo(article.published_at)}
            </span>
          </div>

          {/* Title */}
          <h2 className="text-lg font-bold leading-snug">{article.title}</h2>

          {/* Description */}
          {article.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {article.description}
            </p>
          )}

          {/* Go to source */}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Button variant="outline" className="w-full gap-2">
              <ExternalLink className="h-3.5 w-3.5" />
              Haberi Oku — {article.source?.name}
            </Button>
          </a>

          <Separator />

          {/* Other sources covering this */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">
                Diğer Kaynaklar
                {related.length > 0 && (
                  <span className="text-muted-foreground font-normal ml-1">
                    ({related.length})
                  </span>
                )}
              </h3>
            </div>

            {related.length > 0 ? (
              <>
                {/* Coverage alignment spectrum */}
                <div className="mb-4">
                  <AlignmentSpectrum distribution={coverageDistribution} />
                </div>

                {/* Related articles list */}
                <div className="space-y-0.5">
                  {related.map((rel) => (
                    <a
                      key={rel.id}
                      href={rel.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/rel flex items-center gap-3 rounded-lg p-2.5 -mx-1 hover:bg-muted/80 transition-colors"
                    >
                      {/* Alignment dot */}
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          rel.source?.alignment
                            ? ALIGNMENT_DOTS[rel.source.alignment]
                            : "bg-zinc-400"
                        }`}
                      />

                      {/* Source + title */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-xs font-semibold">
                            {rel.source?.name}
                          </span>
                          {rel.source && (
                            <AlignmentBadge
                              alignment={rel.source.alignment}
                              size="sm"
                            />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {rel.title}
                        </p>
                      </div>

                      {/* Time */}
                      <span
                        className="text-[10px] text-muted-foreground shrink-0"
                        suppressHydrationWarning
                      >
                        {timeAgo(rel.published_at)}
                      </span>

                      {/* External link */}
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50 group-hover/rel:text-foreground transition-colors" />
                    </a>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-6 rounded-lg bg-muted/30 border border-dashed border-border/50">
                <p className="text-xs text-muted-foreground">
                  Bu haberin diğer kaynaklardaki yansıması bulunamadı.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
