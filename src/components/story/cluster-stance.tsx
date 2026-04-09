import type { Source, MediaDnaZone } from "@/types";
import { zoneOf, ZONE_META } from "@/lib/bias/config";
import { SourceChip } from "@/components/story/source-chip";

/**
 * Chart 2 — "Bu Haberde Kim Var?" (Option B, degraded).
 *
 * Server Component. Because we do not yet have real per-article stance labels
 * (destekliyor / tarafsız / eleştiriyor / sessiz), this degraded version
 * groups a cluster's member articles by the three Medya DNA **zones**
 * (İktidar / Bağımsız / Muhalefet) instead of by stance.
 *
 * One chip is rendered per member article — not per source — because a single
 * source can appear multiple times in a cluster. Each chip is a link that
 * opens the article in a new tab.
 */

interface ClusterStanceProps {
  members: Array<{
    source: Source;
    article: { id: string; title: string; url: string };
  }>;
}

// Top-to-bottom render order: İktidar → Bağımsız → Muhalefet.
const ZONE_ORDER: MediaDnaZone[] = ["iktidar", "bagimsiz", "muhalefet"];

export function ClusterStance({ members }: ClusterStanceProps) {
  // Bucket members into zones. Cheap enough to run at render time.
  const byZone: Record<MediaDnaZone, ClusterStanceProps["members"]> = {
    iktidar: [],
    bagimsiz: [],
    muhalefet: [],
  };
  for (const member of members) {
    byZone[zoneOf(member.source.bias)].push(member);
  }

  const total = members.length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold">Bu Haberde Kim Var?</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {total} kaynağın bu hikâyeye verdiği haberler, temel duruşlarına göre
          gruplanmış.
        </p>
      </div>

      {/* Three zone rows, stacked top to bottom */}
      <div className="space-y-2.5">
        {ZONE_ORDER.map((zone) => {
          const meta = ZONE_META[zone];
          const rowMembers = byZone[zone];
          const isEmpty = rowMembers.length === 0;
          return (
            <div
              key={zone}
              className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2"
            >
              {/* Row header: zone label + description, count on the right */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-sm font-semibold ${meta.zoneLabel}`}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {meta.description}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {rowMembers.length} kaynak
                </span>
              </div>

              {/* Article chips (or empty state) */}
              {isEmpty ? (
                <div className="flex items-center justify-center py-2">
                  <span className="text-[11px] text-muted-foreground/60 italic">
                    Hiç kaynak yok
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {rowMembers.map(({ source, article }) => (
                    <SourceChip
                      key={article.id}
                      source={source}
                      zone={zone}
                      href={article.url}
                      title={article.title}
                      titleMaxChars={60}
                      showExternalIcon
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
