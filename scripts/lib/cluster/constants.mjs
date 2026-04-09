// scripts/lib/cluster/constants.mjs
//
// Ensemble clustering tunables. Change these here — everything downstream
// imports from this module so thresholds stay consistent across the pipeline.
//
// W2-D3: rewired per R3's precision-audit + R2's duplicate-audit findings
// (see `team/logs/precision-audit.md` §5 and `team/logs/duplicate-audit.md`).
// W5-A3: re-tuned per V4's precision-recheck (`team/logs/precision-recheck.md`)
// — see the per-constant comments below for the updated values.
//
//  - `MATCH_THRESHOLD` lowered 0.55 → 0.48 (R3 §5.3: biggest single-knob
//    recall win; the 0.45–0.55 band contains Fidan-Barrack / Hormuz
//    fragments that should be merging). V4 kept this at 0.48.
//  - MinHash Jaccard joins the ensemble as a "ceiling-raiser" lane via
//    `MINHASH_SOFT_ACCEPT_JACCARD` (R3 §5.1: 70/71 MHP-fesh articles had
//    distinct strict fingerprints, so the soft Jaccard tier is what
//    actually recovers that story). W5-A3 dropped the soft-accept floor
//    from 0.6 → 0.5 because V4 found 0.6 still too strict for Turkish
//    rewording (123/173 distinct fingerprints).
//  - Entity ratio weight tilted entity-heavy (`0.65`) vs TF-IDF (`0.35`)
//    per R3 §4 — the current 50/50 split underweights the most
//    discriminating signal we have. W5-A3 nudged this back toward
//    tfidf (0.40 / 0.60) because V4 found entity-heavy 0.65 was gluing
//    meta-stories that share hot entity sets.
//
// The entity-ratio denominator fix (`max → min(|A|,|B|)` with a noise
// floor of `max(3, ...)`) lives in ensemble.mjs, not here — the constant
// below is just the floor.

// --- Weighted ensemble tunables -------------------------------------------

// W5-A3: V4 precision-recheck tuning (`team/logs/precision-recheck.md`).
// Wave 2 fell to 83% precision / 23% recall. V4 traced the regressions to
// (a) MinHash Jaccard ≥ 0.6 still being too tight for Turkish rewording,
// and (b) entity-heavy 0.65 + 0.48 threshold gluing meta-stories that share
// hot entity sets but describe different actions. The three knobs below are
// re-tuned per V4's recommendations; MATCH_THRESHOLD stays at 0.48.

export const MATCH_THRESHOLD = 0.48;               // unchanged (R3 §5.3 — V4 kept this)
export const TIME_WINDOW_HOURS = 48;               // articles older than this can't match
export const MIN_SHARED_ENTITIES = 2;              // entity-vote floor for ensemble candidacy

// W5-A3: lowered 0.6 → 0.5. V4 §7 #2: "MinHash Jaccard ≥ 0.6 is still too
// strict for Turkish rewording. R3's measured ceiling was 70/71 distinct
// fingerprints; mine is 123/173. The Jaccard tier is only catching exact-
// phrase survivors." Dropping to 0.5 lets the soft-accept lane recover the
// MHP-fesh sub-clusters that Wave 2 left fragmented.
export const MINHASH_SOFT_ACCEPT_JACCARD = 0.5;    // was 0.6 (W5 V4 §7 #2)

// W5-A3: raised 0.35 → 0.40 (and ENTITY_WEIGHT lowered 0.65 → 0.60). V4 §7
// #3: "Entity-heavy weight (0.65) + lowered threshold (0.48) overfit MIXED
// precision. The 7 MIXED clusters all share the failure pattern 'hot entity
// set + same day + different actions'... Need a tfidf floor ≥ 0.30 before
// the entity score can dominate." A small tfidf bump + entity trim gives
// the lexical signal more pull without changing the formula shape.
// Weights still sum to 1.0 so the primary lane stays in [0,1].
export const TFIDF_WEIGHT = 0.40;                  // was 0.35 (W5 V4 §7 #3)
export const ENTITY_WEIGHT = 0.60;                 // was 0.65 (W5 V4 §7 #3)

export const MINHASH_SIG_K = 64;                   // MinHash signature length (must match fingerprint.mjs)

// --- Legacy exports (still imported by cluster-worker.mjs) ----------------
// Keeping MAX_CANDIDATE_CLUSTERS + ENTITY_DENOM_MIN so the worker keeps
// compiling and the candidate-gen pipeline stays unchanged. ENTITY_DENOM_MIN
// is the noise-floor used by ensemble.mjs when computing
// `shared / max(ENTITY_DENOM_MIN, min(|A|,|B|))`.

export const MAX_CANDIDATE_CLUSTERS = 20;          // per-article candidate cap before tfidf scoring
export const ENTITY_DENOM_MIN = 3;                 // R2 + R3: noise floor so tiny sets don't inflate
