import { describe, it, expect } from "vitest";
import { TfidfIndex } from "./tfidf.mjs";

describe("TfidfIndex — construction and size", () => {
  it("starts empty", () => {
    const idx = new TfidfIndex();
    expect(idx.size()).toBe(0);
  });

  it("size() counts distinct docs", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "foo bar");
    idx.addDoc("b", "baz qux");
    expect(idx.size()).toBe(2);
  });

  it("overwriting the same doc id does not inflate size", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "foo bar");
    idx.addDoc("a", "different text");
    expect(idx.size()).toBe(1);
  });
});

describe("TfidfIndex — addDoc and empty text", () => {
  it("stores empty doc when text is empty/nullish but still counts it", () => {
    const idx = new TfidfIndex();
    idx.addDoc("empty", "");
    idx.addDoc("nul", null);
    idx.finalize();
    expect(idx.size()).toBe(2);
    // Empty docs produce empty vectors and 0 norm → cosine with anything is 0.
    idx.addDoc("normal", "erdogan konustu");
    idx.finalize();
    expect(idx.cosine("empty", "normal")).toBe(0);
    expect(idx.cosine("nul", "normal")).toBe(0);
  });

  it("invalidates finalized state on subsequent addDoc", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "foo bar");
    idx.finalize();
    expect(idx.finalized).toBe(true);
    idx.addDoc("b", "baz qux");
    expect(idx.finalized).toBe(false);
  });
});

describe("TfidfIndex — cosine similarity math", () => {
  it("self-cosine is exactly 1 for the same id", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "erdogan konustu");
    idx.finalize();
    expect(idx.cosine("a", "a")).toBe(1);
  });

  it("returns 0 when either doc id is missing", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "erdogan konustu");
    idx.finalize();
    expect(idx.cosine("a", "missing")).toBe(0);
    expect(idx.cosine("missing", "a")).toBe(0);
  });

  it("returns 0 for empty-text docs (zero norm)", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "");
    idx.addDoc("b", "foo bar baz");
    idx.finalize();
    expect(idx.cosine("a", "b")).toBe(0);
  });

  it("hand-computed cosine matches the formula — two-doc index, identical tokens", () => {
    // With N=2 and a term appearing in both docs: df=2, idf = log((N+1)/(df+1))+1 = log(3/3)+1 = 1.
    // Doc A tokens (stemmed, stop words dropped): depends on normalizer.
    // Use ASCII tokens with no stop-word / stemming interference:
    //   "alpha beta gamma"
    //   "alpha beta gamma"
    // N = 2, each term appears in both docs → df=2 → idf = log(3/3)+1 = 1.
    // Both docs produce the same weight vector {alpha:1, beta:1, gamma:1},
    // so cosine = dot / (|a|*|b|) = 3 / (sqrt(3)*sqrt(3)) = 1.
    const idx = new TfidfIndex();
    idx.addDoc("a", "alpha beta gamma");
    idx.addDoc("b", "alpha beta gamma");
    idx.finalize();
    expect(idx.cosine("a", "b")).toBeCloseTo(1, 10);
  });

  it("hand-computed cosine matches the formula — partial overlap", () => {
    // Tokens (all ASCII, non-stop): "alpha beta gamma" vs "alpha beta delta".
    // N=2.
    //   df(alpha) = 2 → idf = log(3/3)+1 = 1
    //   df(beta)  = 2 → idf = 1
    //   df(gamma) = 1 → idf = log(3/2)+1 ≈ 1.4054651
    //   df(delta) = 1 → idf = 1.4054651
    // Weight vectors (tf * idf):
    //   A = {alpha:1, beta:1, gamma:1.4054651}
    //   B = {alpha:1, beta:1, delta:1.4054651}
    // |A|² = 1 + 1 + 1.4054651² = 2 + 1.9753297 = 3.9753297
    // |A|  = sqrt(3.9753297) = 1.99382
    // Dot  = 1*1 + 1*1 = 2
    // cos  = 2 / (1.99382 * 1.99382) = 2 / 3.97532 = 0.503...
    const idx = new TfidfIndex();
    idx.addDoc("a", "alpha beta gamma");
    idx.addDoc("b", "alpha beta delta");
    idx.finalize();
    const idfUnique = Math.log(3 / 2) + 1;
    const norm = Math.sqrt(2 + idfUnique * idfUnique);
    const expected = 2 / (norm * norm);
    expect(idx.cosine("a", "b")).toBeCloseTo(expected, 10);
    // Sanity: result should be 0 < cos < 1.
    expect(idx.cosine("a", "b")).toBeGreaterThan(0);
    expect(idx.cosine("a", "b")).toBeLessThan(1);
  });

  it("same-topic articles score higher than cross-topic", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "Erdogan AKP grup toplantisinda konustu");
    idx.addDoc("b", "Cumhurbaskani Erdogan AKP grup toplantisinda aciklama yapti");
    idx.addDoc("c", "Galatasaray Fenerbahce macinda 3-1 galip geldi");
    idx.finalize();
    const ab = idx.cosine("a", "b");
    const ac = idx.cosine("a", "c");
    expect(ab).toBeGreaterThan(0.2);
    expect(ab).toBeGreaterThan(ac);
  });

  it("lazily finalizes on first cosine call", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "erdogan konustu");
    idx.addDoc("b", "erdogan konustu");
    // No explicit finalize — cosine should trigger it.
    expect(idx.finalized).toBe(false);
    expect(idx.cosine("a", "b")).toBeGreaterThan(0);
    expect(idx.finalized).toBe(true);
  });
});

describe("TfidfIndex — vector()", () => {
  it("returns an empty Map for missing docs", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "foo bar");
    idx.finalize();
    const v = idx.vector("missing");
    expect(v).toBeInstanceOf(Map);
    expect(v.size).toBe(0);
  });

  it("returns a Map of term → weight for known docs", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "alpha beta gamma");
    idx.addDoc("b", "delta epsilon");
    idx.finalize();
    const v = idx.vector("a");
    expect(v.size).toBeGreaterThan(0);
    // All weights should be positive (tf and idf are non-negative and non-zero for included terms).
    for (const w of v.values()) expect(w).toBeGreaterThan(0);
  });

  it("lazily finalizes on first vector() call", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "alpha beta");
    expect(idx.finalized).toBe(false);
    idx.vector("a");
    expect(idx.finalized).toBe(true);
  });
});

describe("TfidfIndex — df tracking on replacement", () => {
  it("backs out old df contributions when a doc is replaced", () => {
    // Doc a has term "alpha". Doc b has term "alpha". df(alpha) = 2.
    // Replace a with tokens that DON'T contain "alpha". df(alpha) should drop to 1.
    const idx = new TfidfIndex();
    idx.addDoc("a", "alpha beta");
    idx.addDoc("b", "alpha gamma");
    idx.addDoc("a", "delta epsilon"); // replace
    idx.finalize();
    // After replacement, "alpha" only appears in b.
    // N=2 (a and b are still 2 docs), df(alpha)=1 → idf = log(3/2)+1.
    // df(delta) = 1 (only in a) → same idf.
    // b vector = {alpha: idf, gamma: idf}, a vector = {delta: idf, epsilon: idf}.
    // Orthogonal (no shared terms) → cosine = 0.
    expect(idx.cosine("a", "b")).toBe(0);
  });

  it("removes a term from df entirely when the last occurrence is replaced out", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "unique_term_xyz common_x");
    idx.addDoc("b", "common_x other");
    // df(unique_term_xyz) = 1. Replace a to no longer mention it.
    idx.addDoc("a", "common_x other");
    idx.finalize();
    // Now "unique_term_xyz" is gone from the corpus.
    expect(idx.df.has("unique_term_xyz")).toBe(false);
    // Both docs are now identical ("common_x other") → cosine = 1.
    expect(idx.cosine("a", "b")).toBeCloseTo(1, 10);
  });
});

describe("TfidfIndex — finalize on empty corpus", () => {
  it("handles zero-doc corpus without throwing", () => {
    const idx = new TfidfIndex();
    idx.finalize();
    expect(idx.finalized).toBe(true);
    expect(idx.size()).toBe(0);
  });
});

describe("TfidfIndex — stem-based conflation", () => {
  it("reduces Turkish surface-form variants to the same stem for higher cosine", () => {
    // "mecliste", "meclisten", "meclisin" all stem to "meclis".
    // Without stemming these would be 3 distinct tokens → cosine 0 on just
    // those tokens. With stemming they collapse to the same weight.
    // We can't hit exactly 1.0 because the surrounding words differ, but
    // stemming should yield a clearly positive cosine.
    const idx = new TfidfIndex();
    idx.addDoc("a", "mecliste konusuldu");
    idx.addDoc("b", "meclisten aciklama");
    idx.finalize();
    // Both docs produce "meclis" after stemming.
    expect(idx.cosine("a", "b")).toBeGreaterThan(0);
  });

  it("preserves numeric tokens through stemming", () => {
    const idx = new TfidfIndex();
    idx.addDoc("a", "2020 yilinda olay");
    idx.addDoc("b", "2020 raporu");
    idx.finalize();
    // "2020" survives stemming (numeric guard) and is present in both docs.
    expect(idx.cosine("a", "b")).toBeGreaterThan(0);
  });
});
