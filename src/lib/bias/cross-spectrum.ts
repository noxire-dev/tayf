import type { Source, MediaDnaZone } from "@/types";
import { zoneOf } from "./config";

/**
 * Result of the "unexpected cross-spectrum coverage" detector.
 *
 * `dominantZone` is `null` when no zone reaches the dominance threshold,
 * in which case the cluster is considered mixed and nothing is flagged.
 */
export interface CrossSpectrumResult {
  dominantZone: MediaDnaZone | null; // null if no clear dominant
  dominantPct: number; // 0..1
  surpriseOutlets: Source[]; // sources whose zone is OPPOSITE to dominant
  blindspotCandidate: boolean; // true when dominantPct >= 0.85 (no opposition coverage)
}

/**
 * The opposite-zone map. `bagimsiz` intentionally has no opposite — an
 * independent outlet covering a partisan story is not a "surprise".
 */
const OPPOSITE: Record<MediaDnaZone, MediaDnaZone | null> = {
  iktidar: "muhalefet",
  muhalefet: "iktidar",
  bagimsiz: null,
};

/**
 * Given a cluster's member sources, find the dominant Medya DNA zone and
 * any members whose baseline bias sits in the OPPOSITE zone. Those members
 * are the "cross-spectrum surprises" — outlets that usually take the other
 * side but showed up on this story.
 */
export function detectCrossSpectrum(
  memberSources: Source[],
  // A6 (06-surprise-quality.md): raised 0.45 → 0.65 to stop balanced 5-vs-4
  // clusters from firing a "surprise" caption. At 0.45 the detector had a
  // 17% true-positive rate; at 0.65 + the guards below it cuts false
  // positives ~5× while still catching the Milli Gazete / BirGün-Barrack
  // class of real cross-spectrum surprises.
  dominantThreshold = 0.65,
): CrossSpectrumResult {
  // A6: minimum-source-count guard. 4-member clusters where a single
  // opposite voice flips verdicts are too noisy to be trusted.
  if (memberSources.length < 5) {
    return {
      dominantZone: null,
      dominantPct: 0,
      surpriseOutlets: [],
      blindspotCandidate: false,
    };
  }

  // Count members per zone.
  const counts: Record<MediaDnaZone, number> = {
    iktidar: 0,
    bagimsiz: 0,
    muhalefet: 0,
  };
  for (const s of memberSources) counts[zoneOf(s.bias)]++;

  // Find dominant zone — must clear the threshold AND be the largest.
  const total = memberSources.length;
  let dominantZone: MediaDnaZone | null = null;
  let dominantPct = 0;
  for (const zone of Object.keys(counts) as MediaDnaZone[]) {
    const pct = counts[zone] / total;
    if (pct >= dominantThreshold && pct > dominantPct) {
      dominantZone = zone;
      dominantPct = pct;
    }
  }

  if (!dominantZone) {
    return {
      dominantZone: null,
      dominantPct: 0,
      surpriseOutlets: [],
      blindspotCandidate: false,
    };
  }

  // Members in the opposite zone are the surprises.
  const opposite = OPPOSITE[dominantZone];
  const surpriseOutlets = opposite
    ? memberSources.filter((s) => zoneOf(s.bias) === opposite)
    : [];

  // A6: minimum-margin guard. Even after the threshold + size floor, kill
  // anything where the dominant zone only barely outnumbers the opposite
  // zone — most 4-vs-2 / 3-vs-1 firings in A6's sample were noise (wire
  // copy, nationalist mis-zoning, or self-reporting). Require an absolute
  // margin of ≥ 3 to fire.
  const dominantCount = counts[dominantZone];
  const oppositeCount = opposite ? counts[opposite] : 0;
  if (dominantCount - oppositeCount < 3) {
    return {
      dominantZone: null,
      dominantPct: 0,
      surpriseOutlets: [],
      blindspotCandidate: false,
    };
  }

  // "Kör nokta" candidate: a single zone owns >= 85% of the cluster, so the
  // opposite half of the spectrum is essentially absent. The DB-level
  // is_blindspot field is owned elsewhere; this flag is just a hint for the
  // UI/caption layer.
  const blindspotCandidate = dominantPct >= 0.85;

  return { dominantZone, dominantPct, surpriseOutlets, blindspotCandidate };
}

/**
 * Render human-readable Turkish blurbs for the surprise outlets, capped at
 * `max`. Returns `[]` when there is nothing to show so callers can
 * `if (lines.length)` without special-casing.
 */
export function summarizeSurprises(
  result: CrossSpectrumResult,
  clusterTitle: string,
  max = 2,
): string[] {
  if (!result.dominantZone || result.surpriseOutlets.length === 0) return [];

  const dominantLabel = {
    iktidar: "iktidara yakın",
    muhalefet: "muhalefet yanlısı",
    bagimsiz: "bağımsız",
  }[result.dominantZone];

  const oppositeShort = {
    iktidar: "iktidar",
    muhalefet: "muhalefet",
    bagimsiz: "bağımsız",
  }[result.dominantZone === "iktidar" ? "muhalefet" : "iktidar"];

  return result.surpriseOutlets.slice(0, max).map((s) => {
    return `⚡ ${s.name} (${oppositeShort}) bu ${dominantLabel} habere yer verdi: "${clusterTitle}"`;
  });
}
