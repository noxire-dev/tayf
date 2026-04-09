import type { BiasCategory, BiasDistribution } from "@/types";

const EMPTY_DISTRIBUTION: BiasDistribution = {
  pro_government: 0,
  gov_leaning: 0,
  state_media: 0,
  center: 0,
  opposition_leaning: 0,
  opposition: 0,
  nationalist: 0,
  islamist_conservative: 0,
  pro_kurdish: 0,
  international: 0,
};

export function emptyBiasDistribution(): BiasDistribution {
  return { ...EMPTY_DISTRIBUTION };
}

export function calculateBiasDistribution(
  biasLabels: BiasCategory[]
): BiasDistribution {
  const distribution = emptyBiasDistribution();
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
  const sole = nonZero.length === 1 ? nonZero[0] : null;
  if (sole) {
    return {
      isBlindspot: true,
      blindspotSide: sole[0],
    };
  }

  return { isBlindspot: false, blindspotSide: null };
}
