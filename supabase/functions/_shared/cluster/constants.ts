// supabase/functions/_shared/cluster/constants.ts
//
// Ensemble clustering tunables. Change these here — everything downstream
// imports from this module so thresholds stay consistent across the pipeline.
//
// Ported from `scripts/lib/cluster/constants.mjs`. Keep numeric values in
// lock-step with the .mjs reference: behaviour parity is the contract the
// Edge Function refactor signs against the existing tmux clusterer.

// --- Weighted ensemble tunables -------------------------------------------

export const MATCH_THRESHOLD = 0.48;
export const TIME_WINDOW_HOURS = 48;
export const MIN_SHARED_ENTITIES = 2;

export const MINHASH_SOFT_ACCEPT_JACCARD = 0.5;

export const TFIDF_WEIGHT = 0.40;
export const ENTITY_WEIGHT = 0.60;

export const MINHASH_SIG_K = 64;

// --- Legacy exports (still imported by the candidate-gen pipeline) --------

export const MAX_CANDIDATE_CLUSTERS = 20;
export const ENTITY_DENOM_MIN = 3;

// A1 cluster-glue fix: entity contribution decays on this window so hot
// entities can't carry a pair across threshold when the underlying stories
// describe different actions.
export const ENTITY_FRESHNESS_HOURS = 6;
