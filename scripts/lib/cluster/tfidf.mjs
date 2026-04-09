// scripts/lib/cluster/tfidf.mjs
//
// Minimal in-memory TF-IDF index for Turkish news titles+descriptions.
// Pure JS, no deps. Not the fastest possible implementation but easily
// handles a rolling 48-hour window (a few thousand docs).
//
// Usage:
//   const idx = new TfidfIndex();
//   idx.addDoc("a", "erdoğan akp grup toplantısı");
//   idx.addDoc("b", "erdoğan grup toplantıda konuştu");
//   idx.finalize(); // computes idf
//   idx.cosine("a", "b"); // → 0..1

import { normalizeTurkish } from "./fingerprint.mjs";

export class TfidfIndex {
  constructor() {
    /** @type {Map<string, Map<string, number>>} docId → term → raw tf */
    this.docs = new Map();
    /** @type {Map<string, number>} term → document frequency */
    this.df = new Map();
    /** @type {Map<string, number>} term → idf (filled by finalize) */
    this.idf = new Map();
    /** @type {Map<string, Map<string, number>>} docId → term → tfidf weight (filled by finalize) */
    this.vec = new Map();
    /** @type {Map<string, number>} docId → L2 norm (filled by finalize) */
    this.norms = new Map();
    this.finalized = false;
  }

  addDoc(id, text) {
    if (this.finalized) {
      // Allow re-use: invalidate finalized state, the caller can call finalize() again.
      this.finalized = false;
      this.vec.clear();
      this.norms.clear();
      this.idf.clear();
    }
    const norm = normalizeTurkish(text || "");
    if (!norm) {
      this.docs.set(id, new Map());
      return;
    }
    const tokens = norm.split(" ").filter(Boolean);
    const tf = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    // df update — only count each term once per doc.
    if (this.docs.has(id)) {
      // Replacing an existing doc → back out old df contributions.
      const old = this.docs.get(id);
      for (const term of old.keys()) {
        const prev = this.df.get(term) || 0;
        if (prev <= 1) this.df.delete(term);
        else this.df.set(term, prev - 1);
      }
    }
    for (const term of tf.keys()) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }
    this.docs.set(id, tf);
  }

  finalize() {
    const N = this.docs.size;
    if (N === 0) {
      this.finalized = true;
      return;
    }
    // Smoothed idf: log((N + 1) / (df + 1)) + 1
    this.idf.clear();
    for (const [term, df] of this.df.entries()) {
      this.idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
    }
    this.vec.clear();
    this.norms.clear();
    for (const [id, tf] of this.docs.entries()) {
      const weights = new Map();
      let sumSq = 0;
      for (const [term, count] of tf.entries()) {
        const w = count * (this.idf.get(term) || 0);
        if (w !== 0) {
          weights.set(term, w);
          sumSq += w * w;
        }
      }
      this.vec.set(id, weights);
      this.norms.set(id, Math.sqrt(sumSq));
    }
    this.finalized = true;
  }

  vector(id) {
    if (!this.finalized) this.finalize();
    return this.vec.get(id) || new Map();
  }

  cosine(idA, idB) {
    if (!this.finalized) this.finalize();
    if (idA === idB) return 1;
    const a = this.vec.get(idA);
    const b = this.vec.get(idB);
    if (!a || !b) return 0;
    const nA = this.norms.get(idA) || 0;
    const nB = this.norms.get(idB) || 0;
    if (nA === 0 || nB === 0) return 0;
    // Iterate over the smaller vector.
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [term, w] of small.entries()) {
      const other = big.get(term);
      if (other !== undefined) dot += w * other;
    }
    return dot / (nA * nB);
  }

  size() {
    return this.docs.size;
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

if (process.argv[1] === import.meta.url.replace("file://", "")) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error("FAIL:", msg);
      process.exit(1);
    }
    console.log("ok  -", msg);
  };

  const idx = new TfidfIndex();
  idx.addDoc("a", "Erdoğan AKP grup toplantısında konuştu");
  idx.addDoc("b", "Cumhurbaşkanı Erdoğan AKP grup toplantısında açıklama yaptı");
  idx.addDoc("c", "Galatasaray Fenerbahçe maçında 3-1 galip geldi");
  idx.addDoc("d", "Galatasaray Fenerbahçe derbisinde 3 gol attı");
  idx.finalize();

  const ab = idx.cosine("a", "b");
  const cd = idx.cosine("c", "d");
  const ac = idx.cosine("a", "c");

  assert(ab > 0.2, `erdoğan docs close (ab=${ab.toFixed(3)})`);
  assert(cd > 0.2, `galatasaray docs close (cd=${cd.toFixed(3)})`);
  assert(ac < ab, `cross-topic lower than same-topic (ac=${ac.toFixed(3)} < ab=${ab.toFixed(3)})`);
  assert(idx.cosine("a", "a") === 1, "self-cosine is 1");
  console.log("tfidf.mjs OK");
}
