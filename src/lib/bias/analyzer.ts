import type { AlignmentCategory, AlignmentDistribution } from "@/types";

export function calculateAlignmentDistribution(
  alignments: AlignmentCategory[]
): AlignmentDistribution {
  const distribution: AlignmentDistribution = {
    pro_government: 0,
    gov_leaning: 0,
    center: 0,
    opposition_leaning: 0,
    opposition: 0,
  };

  for (const alignment of alignments) {
    distribution[alignment]++;
  }

  return distribution;
}

export function detectBlindspot(distribution: AlignmentDistribution): {
  isBlindspot: boolean;
  blindspotSide: AlignmentCategory | null;
} {
  const categories = Object.entries(distribution) as [AlignmentCategory, number][];
  const nonZero = categories.filter(([, count]) => count > 0);

  // Blindspot = only one alignment category covers this story
  if (nonZero.length === 1) {
    return {
      isBlindspot: true,
      blindspotSide: nonZero[0][0],
    };
  }

  return { isBlindspot: false, blindspotSide: null };
}
