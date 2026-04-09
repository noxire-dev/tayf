import { ImageResponse } from "next/og";

import { getClusterDetail } from "@/lib/clusters/cluster-detail-query";
import { zoneOf } from "@/lib/bias/config";
import type { BiasCategory, BiasDistribution, MediaDnaZone } from "@/types";

// File-route OG card for /cluster/[id].
//
// Next.js 16 auto-registers this as the page segment's
// `openGraph.images[0]` (and `twitter.images[0]` if a sibling
// `twitter-image.tsx` is added). The page's `generateMetadata` does NOT
// need to set `openGraph.images` for this to be wired in — the file
// convention does that on its own. We deliberately leave the cluster
// page's existing `firstImage` fallback in place; the framework merges
// our generated image into the same array.
//
// Tailwind is NOT supported by Satori (the engine behind ImageResponse),
// so every visual rule below is an inline `style` prop. Only flexbox
// and a subset of CSS properties render — no `display: grid`, no
// pseudo-elements, no fancy gradients beyond linear. We also skip
// custom font fetching to keep build dependencies minimal: Satori
// falls back to its bundled sans-serif which renders Turkish
// diacritics (ç ğ ı ö ş ü) correctly.

export const alt = "Tayf — haber kümesi kartı";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface ImageProps {
  // Next.js 16: dynamic-route `params` is a Promise. Same shape as the
  // page component itself — keeps the contract obvious.
  params: Promise<{ id: string }>;
}

// The DB stores 10 fine-grained bias categories; the public-facing UI
// (BiasSpectrum, MediaDNA, ClusterStance) collapses those into 3 zones
// (iktidar / bağımsız / muhalefet) via `zoneOf`. We do the same here so
// the OG card matches what users see on the page.
type ZoneCounts = Record<MediaDnaZone, number>;

function distributionToZones(distribution: BiasDistribution): ZoneCounts {
  const zones: ZoneCounts = { iktidar: 0, bagimsiz: 0, muhalefet: 0 };
  for (const [bias, count] of Object.entries(distribution) as [
    BiasCategory,
    number,
  ][]) {
    zones[zoneOf(bias)] += count;
  }
  return zones;
}

// Zone presentation tokens — the Tailwind class strings in
// `src/lib/bias/zones.ts` aren't usable here (no Tailwind in Satori),
// so we mirror the same red / zinc / emerald palette as raw hex codes.
const ZONE_STYLE: Record<
  MediaDnaZone,
  { label: string; bar: string; text: string }
> = {
  iktidar: { label: "İktidar", bar: "#ef4444", text: "#fecaca" },
  bagimsiz: { label: "Bağımsız", bar: "#a1a1aa", text: "#e4e4e7" },
  muhalefet: { label: "Muhalefet", bar: "#10b981", text: "#a7f3d0" },
};

export default async function Image({ params }: ImageProps) {
  const { id } = await params;
  const detail = await getClusterDetail(id);

  // Fallback card if the cluster vanished between SSR and the OG fetch.
  // We still return a 200 with a usable card so social crawlers don't
  // cache a 404 — Slack/Twitter are notoriously sticky about that.
  if (!detail) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0a0a",
            color: "#fafafa",
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          <div style={{ display: "flex" }}>Tayf</div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 500,
              color: "#a1a1aa",
              marginTop: 16,
            }}
          >
            Haber kümesi bulunamadı
          </div>
        </div>
      ),
      { ...size },
    );
  }

  const { cluster } = detail;
  const zones = distributionToZones(cluster.bias_distribution);
  const zoneTotal = zones.iktidar + zones.bagimsiz + zones.muhalefet;
  // Guard against div-by-zero on a freshly clustered row whose
  // bias_distribution hasn't been backfilled yet.
  const safeTotal = zoneTotal > 0 ? zoneTotal : 1;

  // Trim very long Turkish headlines so they fit in the 2-line title
  // box at fontSize 64. Roughly 110 characters before Satori starts
  // pushing things off-canvas at this size.
  const title =
    cluster.title_tr.length > 110
      ? cluster.title_tr.slice(0, 107) + "…"
      : cluster.title_tr;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "64px 72px",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #18181b 60%, #0f172a 100%)",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top row: Tayf wordmark + source count pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "#fafafa",
            }}
          >
            {/* Brand mark — a simple gradient square stands in for a
                logo. Cheap to render and avoids shipping a binary asset
                through the 500KB bundle limit. */}
            <div
              style={{
                display: "flex",
                width: 44,
                height: 44,
                borderRadius: 10,
                background:
                  "linear-gradient(135deg, #ef4444 0%, #a1a1aa 50%, #10b981 100%)",
              }}
            />
            Tayf
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 22px",
              borderRadius: 999,
              background: "rgba(250,250,250,0.08)",
              border: "1px solid rgba(250,250,250,0.18)",
              fontSize: 24,
              fontWeight: 600,
              color: "#e4e4e7",
            }}
          >
            {cluster.article_count} kaynak
          </div>
        </div>

        {/* Title — flex-grow pushes the bias breakdown to the bottom. */}
        <div
          style={{
            display: "flex",
            flexGrow: 1,
            alignItems: "center",
            marginTop: 32,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.025em",
              color: "#fafafa",
            }}
          >
            {title}
          </div>
        </div>

        {/* Bias breakdown — stacked horizontal bar + 3 zone chips. The
            stacked bar mirrors the BiasSpectrum component on the page,
            and the chips below give a percentage readout per zone. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 18,
              borderRadius: 999,
              overflow: "hidden",
              background: "rgba(250,250,250,0.08)",
            }}
          >
            {(["iktidar", "bagimsiz", "muhalefet"] as MediaDnaZone[]).map(
              (zone) => {
                const pct = (zones[zone] / safeTotal) * 100;
                if (pct <= 0) return null;
                return (
                  <div
                    key={zone}
                    style={{
                      display: "flex",
                      width: `${pct}%`,
                      height: "100%",
                      background: ZONE_STYLE[zone].bar,
                    }}
                  />
                );
              },
            )}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 20,
              gap: 16,
            }}
          >
            {(["iktidar", "bagimsiz", "muhalefet"] as MediaDnaZone[]).map(
              (zone) => {
                const pct = Math.round((zones[zone] / safeTotal) * 100);
                return (
                  <div
                    key={zone}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                      padding: "16px 20px",
                      borderRadius: 12,
                      background: "rgba(250,250,250,0.05)",
                      border: "1px solid rgba(250,250,250,0.12)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          background: ZONE_STYLE[zone].bar,
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          fontSize: 22,
                          fontWeight: 600,
                          color: ZONE_STYLE[zone].text,
                        }}
                      >
                        {ZONE_STYLE[zone].label}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        fontSize: 32,
                        fontWeight: 800,
                        color: "#fafafa",
                        marginTop: 8,
                      }}
                    >
                      {pct}% · {zones[zone]}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
