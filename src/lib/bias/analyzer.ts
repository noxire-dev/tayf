import type { BiasCategory, BiasDistribution } from "@/types";

export function calculateBiasDistribution(
  biasLabels: BiasCategory[]
): BiasDistribution {
  const distribution: BiasDistribution = {
    pro_government: 0,
    opposition: 0,
    independent: 0,
  };

  for (const bias of biasLabels) {
    distribution[bias]++;
  }

  return distribution;
}

export function detectBlindspot(distribution: BiasDistribution): {
  isBlindspot: boolean;
  blindspotSide: BiasCategory | null;
} {
  const categories = Object.entries(distribution) as [BiasCategory, number][];
  const nonZero = categories.filter(([, count]) => count > 0);

  // Blindspot = only one bias category covers this story
  if (nonZero.length === 1) {
    return {
      isBlindspot: true,
      blindspotSide: nonZero[0][0],
    };
  }

  return { isBlindspot: false, blindspotSide: null };
}
