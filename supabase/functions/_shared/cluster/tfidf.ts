// supabase/functions/_shared/cluster/tfidf.ts
//
// Minimal in-memory TF-IDF index for Turkish news titles+descriptions.
// Pure TS, no deps. Ported from `scripts/lib/cluster/tfidf.mjs`.

import { normalizeTurkish, stemTurkish } from "./fingerprint.ts";

export class TfidfIndex {
  private docs: Map<string, Map<string, number>>;
  private df: Map<string, number>;
  private idf: Map<string, number>;
  private vec: Map<string, Map<string, number>>;
  private norms: Map<string, number>;
  private finalized: boolean;

  constructor() {
    this.docs = new Map();
    this.df = new Map();
    this.idf = new Map();
    this.vec = new Map();
    this.norms = new Map();
    this.finalized = false;
  }

  addDoc(id: string, text: string | null | undefined): void {
    if (this.finalized) {
      // Allow re-use: invalidate finalized state, caller can call finalize() again.
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
    const tokens = norm.split(" ").filter(Boolean).map(stemTurkish);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    // df update — back out old contributions when replacing an existing doc.
    if (this.docs.has(id)) {
      const old = this.docs.get(id)!;
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

  finalize(): void {
    const N = this.docs.size;
    if (N === 0) {
      this.finalized = true;
      return;
    }
    this.idf.clear();
    for (const [term, df] of this.df.entries()) {
      this.idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
    }
    this.vec.clear();
    this.norms.clear();
    for (const [id, tf] of this.docs.entries()) {
      const weights = new Map<string, number>();
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

  vector(id: string): Map<string, number> {
    if (!this.finalized) this.finalize();
    return this.vec.get(id) || new Map();
  }

  cosine(idA: string, idB: string): number {
    if (!this.finalized) this.finalize();
    if (idA === idB) return 1;
    const a = this.vec.get(idA);
    const b = this.vec.get(idB);
    if (!a || !b) return 0;
    const nA = this.norms.get(idA) || 0;
    const nB = this.norms.get(idB) || 0;
    if (nA === 0 || nB === 0) return 0;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [term, w] of small.entries()) {
      const other = big.get(term);
      if (other !== undefined) dot += w * other;
    }
    return dot / (nA * nB);
  }

  size(): number {
    return this.docs.size;
  }
}
