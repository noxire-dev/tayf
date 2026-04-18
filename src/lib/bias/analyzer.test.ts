import { describe, it, expect } from "vitest";
import {
  emptyBiasDistribution,
  calculateBiasDistribution,
  detectBlindspot,
} from "./analyzer";
import type { BiasCategory, BiasDistribution } from "@/types";

describe("emptyBiasDistribution", () => {
  it("returns a distribution with every BiasCategory key set to 0", () => {
    const d = emptyBiasDistribution();
    const expectedKeys: BiasCategory[] = [
      "pro_government",
      "gov_leaning",
      "state_media",
      "center",
      "opposition_leaning",
      "opposition",
      "nationalist",
      "islamist_conservative",
      "pro_kurdish",
      "international",
    ];
    for (const key of expectedKeys) {
      expect(d[key]).toBe(0);
    }
    expect(Object.keys(d).sort()).toEqual(expectedKeys.slice().sort());
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = emptyBiasDistribution();
    const b = emptyBiasDistribution();
    a.pro_government = 5;
    expect(b.pro_government).toBe(0);
    expect(a).not.toBe(b);
  });
});

describe("calculateBiasDistribution", () => {
  it("returns all-zero distribution for empty input", () => {
    const d = calculateBiasDistribution([]);
    expect(d).toEqual(emptyBiasDistribution());
  });

  it("counts each occurrence once", () => {
    const d = calculateBiasDistribution([
      "pro_government",
      "pro_government",
      "opposition",
      "center",
    ]);
    expect(d.pro_government).toBe(2);
    expect(d.opposition).toBe(1);
    expect(d.center).toBe(1);
    expect(d.gov_leaning).toBe(0);
    expect(d.state_media).toBe(0);
  });

  it("handles every bias category", () => {
    const all: BiasCategory[] = [
      "pro_government",
      "gov_leaning",
      "state_media",
      "center",
      "opposition_leaning",
      "opposition",
      "nationalist",
      "islamist_conservative",
      "pro_kurdish",
      "international",
    ];
    const d = calculateBiasDistribution(all);
    for (const bias of all) {
      expect(d[bias]).toBe(1);
    }
  });

  it("does not mutate the shared empty template between calls", () => {
    const first = calculateBiasDistribution(["pro_government"]);
    const second = calculateBiasDistribution([]);
    expect(first.pro_government).toBe(1);
    expect(second.pro_government).toBe(0);
  });
});

describe("detectBlindspot", () => {
  function dist(overrides: Partial<BiasDistribution>): BiasDistribution {
    return { ...emptyBiasDistribution(), ...overrides };
  }

  it("is a blindspot when exactly one category has coverage", () => {
    const result = detectBlindspot(dist({ pro_government: 4 }));
    expect(result.isBlindspot).toBe(true);
    expect(result.blindspotSide).toBe("pro_government");
  });

  it("is NOT a blindspot when two or more categories have coverage", () => {
    const result = detectBlindspot(
      dist({ pro_government: 3, opposition: 1 })
    );
    expect(result.isBlindspot).toBe(false);
    expect(result.blindspotSide).toBeNull();
  });

  it("is NOT a blindspot when the distribution is empty (all zero)", () => {
    const result = detectBlindspot(emptyBiasDistribution());
    expect(result.isBlindspot).toBe(false);
    expect(result.blindspotSide).toBeNull();
  });

  it("identifies the sole covering side even when count is 1", () => {
    const result = detectBlindspot(dist({ opposition: 1 }));
    expect(result.isBlindspot).toBe(true);
    expect(result.blindspotSide).toBe("opposition");
  });

  it("reports the correct side for every possible singleton", () => {
    const singles: BiasCategory[] = [
      "pro_government",
      "gov_leaning",
      "state_media",
      "center",
      "opposition_leaning",
      "opposition",
      "nationalist",
      "islamist_conservative",
      "pro_kurdish",
      "international",
    ];
    for (const bias of singles) {
      const result = detectBlindspot(dist({ [bias]: 2 }));
      expect(result.isBlindspot).toBe(true);
      expect(result.blindspotSide).toBe(bias);
    }
  });

  it("treats any zone with count>0 as coverage (not just >1)", () => {
    // Two categories with count 1 each -> not a blindspot
    const result = detectBlindspot(
      dist({ pro_government: 1, opposition: 1 })
    );
    expect(result.isBlindspot).toBe(false);
  });
});
