#!/usr/bin/env node
// scripts/cluster-worker.mjs
//
// Continuous ensemble clustering worker for Tayf. Groups articles into
// clusters using the three complementary free methods:
//   1. Turkish fingerprint (wire-copy near-duplicates)
//   2. TF-IDF cosine over rolling 48h window (paraphrases)
//   3. Entity overlap + time window (shared-noun heuristic)
//
// Also serves as the backfill job for historical rows: on each cycle it
// computes fingerprint + entities for any article missing them.
//
// Politics filter: we only cluster articles whose category is in
// POLITICS_CATEGORIES. Non-politics articles are still ingested by the
// RSS worker into `articles`, but the clustering worker ignores them.
//
// Usage:
//   node scripts/cluster-worker.mjs             # run forever, 30s cadence
//   DRY_RUN=1 node scripts/cluster-worker.mjs   # one cycle, exit
//
// ESM, Node 20, no TypeScript. Keep parity with scripts/rss-worker.mjs.

import { fingerprint } from "./lib/cluster/fingerprint.mjs";
import { extractEntities } from "./lib/cluster/entities.mjs";
import { TfidfIndex } from "./lib/cluster/tfidf.mjs";
import { score } from "./lib/cluster/ensemble.mjs";
import {
  MATCH_THRESHOLD,
  TIME_WINDOW_HOURS,
  MIN_SHARED_ENTITIES,
  MAX_CANDIDATE_CLUSTERS,
} from "./lib/cluster/constants.mjs";

import {
  loadDotEnvLocal,
  log,
  logCycle,
  installShutdownHandler,
  adaptiveSleep,
  sleep,
} from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Module-level constants (pure, no side effects)
// ---------------------------------------------------------------------------

const CYCLE_INTERVAL_IDLE_MS = 60_000;     // sleep 60s if nothing processed
const CYCLE_INTERVAL_NORMAL_MS = 30_000;   // sleep 30s on typical (1..10) batches
const CYCLE_INTERVAL_BUSY_MS = 15_000;     // sleep 15s if batch was > 10
const BATCH_SIZE = 500;
const ENRICH_UPSERT_CHUNK = 50;            // fallback chunk size if bulk upsert fails
const CLUSTER_CONTEXT_TTL_MS = 60_000;     // cache rolling cluster context for 60s

// Politics filter — the user only cares about politics. The RSS worker
// continues to ingest every category into `articles`, but clustering
// restricts itself to these categories only.
const POLITICS_CATEGORIES = ["politika", "son_dakika"];

// Mirrors src/lib/bias/analyzer.ts emptyBiasDistribution() + populate.
const BIAS_KEYS = [
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

// ---------------------------------------------------------------------------
// 2. Helpers (pure — no DB, no closure state)
// ---------------------------------------------------------------------------

function hoursBetween(aIso, bIso) {
  return (
    Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) /
    (1000 * 60 * 60)
  );
}

function buildBiasDistribution(biasLabels) {
  const dist = Object.fromEntries(BIAS_KEYS.map((k) => [k, 0]));
  for (const b of biasLabels) if (b in dist) dist[b]++;
  return dist;
}

function detectBlindspot(dist) {
  const entries = Object.entries(dist).filter(([, n]) => n > 0);
  if (entries.length === 1) {
    return { is_blindspot: true, blindspot_side: entries[0][0] };
  }
  return { is_blindspot: false, blindspot_side: null };
}

function summaryFallback(description) {
  const d = (description || "").trim();
  // clusters.summary_tr is NOT NULL — fall back to a space when missing.
  return d.length > 0 ? d : " ";
}

// Cycle stats bag — runCycle returns this and the main loop uses it to
// format the one structured summary line (see `cycle=N processed=...`).
function emptyStats(cycleNum) {
  return {
    cycleNum,
    processed: 0,
    matched: 0,
    created: 0,
    skippedDupes: 0,
    duration: 0,
  };
}

// Format the single structured cycle-summary line. Field order is fixed so
// `grep cycle=` produces a column-stable feed for status.log tailers.
function formatCycleSummary(stats, sleepMs) {
  return (
    `cycle=${stats.cycleNum} ` +
    `processed=${stats.processed} ` +
    `match=${stats.matched} ` +
    `new=${stats.created} ` +
    `skipped-same-source=${stats.skippedDupes} ` +
    `duration=${stats.duration.toFixed(1)}s ` +
    `sleep=${sleepMs}ms`
  );
}

// Build inverted indices from ALL member fingerprints + entities, not just
// the seed. Audit (2026-04-17) found 47 cross-cluster pairs with score=1.0
// that should have merged but didn't — late wire-copies couldn't find their
// home because only the seed's fp/entities were indexed. Indexing every
// member catches these.
function buildMemberIndicesFromRows(caRows, memberArticles) {
  const byFingerprint = new Map();  // fp string → clusterId[]
  const byEntity = new Map();       // entity string → clusterId[]
  // Track (cluster, fp) and (cluster, ent) pairs already seen so we don't
  // balloon the inverted lists with duplicates — multiple members of the
  // same cluster often share fingerprints (wire-copy siblings).
  const fpSeen = new Set();
  const entSeen = new Set();

  for (const row of caRows) {
    const art = memberArticles.get(row.article_id);
    if (!art) continue;
    if (art.fingerprint) {
      const key = `${row.cluster_id}|${art.fingerprint}`;
      if (!fpSeen.has(key)) {
        fpSeen.add(key);
        const list = byFingerprint.get(art.fingerprint) || [];
        list.push(row.cluster_id);
        byFingerprint.set(art.fingerprint, list);
      }
    }
    if (Array.isArray(art.entities)) {
      for (const ent of art.entities) {
        const key = `${row.cluster_id}|${ent}`;
        if (entSeen.has(key)) continue;
        entSeen.add(key);
        const list = byEntity.get(ent) || [];
        list.push(row.cluster_id);
        byEntity.set(ent, list);
      }
    }
  }

  return { byFingerprint, byEntity };
}

// ---------------------------------------------------------------------------
// Exported factory — wraps DB-touching helpers + cycle orchestration so it
// can be reused both as a standalone tmux script AND imported from a Next.js
// route handler. The tmux entrypoint loops; the HTTP entrypoint calls
// runOneCycle() once per invocation.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient,
 *   isShuttingDown?: () => boolean,
 *   debug?: boolean,
 * }} options
 * @returns {{
 *   runOneCycle: (cycleNum?: number) => Promise<{
 *     cycleNum: number,
 *     processed: number,
 *     matched: number,
 *     created: number,
 *     skippedDupes: number,
 *     duration: number,
 *   }>,
 *   invalidateContextCache: () => void,
 * }}
 */
export function createClusterEngine({ supabase, isShuttingDown = () => false, debug = false } = {}) {
  if (!supabase) throw new Error("createClusterEngine: supabase client is required");
  let clusterContextCache = null;

  // Helper: page through every row in a table (works around PostgREST's default 1000-row cap).
  async function pagedSelect(table, select, pageSize = 1000) {
    const out = [];
    let offset = 0;
    while (true) {
      const res = await supabase
        .from(table)
        .select(select)
        .range(offset, offset + pageSize - 1);
      if (res.error) {
        throw new Error(`pagedSelect(${table}): ${res.error.message}`);
      }
      const rows = res.data ?? [];
      out.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
      if (offset > 1_000_000) break; // safety cap
    }
    return out;
  }

  // Helper: run a chunked .in() query so large id arrays don't blow PostgREST URI limit.
  async function inChunked(table, select, column, values, chunkSize = 100) {
    if (values.length === 0) return [];
    const out = [];
    for (let i = 0; i < values.length; i += chunkSize) {
      const slice = values.slice(i, i + chunkSize);
      const res = await supabase.from(table).select(select).in(column, slice);
      if (res.error) {
        throw new Error(`inChunked(${table}): ${res.error.message}`);
      }
      for (const row of res.data ?? []) out.push(row);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 3. Enrichment — compute fingerprint + entities for batch, upsert back
  // ---------------------------------------------------------------------------

  async function enrichArticles(articles) {
    const updates = [];
    for (const a of articles) {
      // Always recompute. Audit found persisted fingerprints drifting from
      // the current algorithm's output on the same title — caused by post-
      // ingestion title mutations (migrations 018, 019). Trusting the DB
      // cache meant wire-copy articles with stale hashes couldn't auto-accept
      // each other. Recompute every cycle, persist if the result changed.
      const fp = fingerprint(a.title || "", a.description || "");
      a.signature = fp.signature;

      const oldFp = a.fingerprint;
      const oldEnts = Array.isArray(a.entities) ? a.entities : [];
      const freshEnts =
        extractEntities(`${a.title || ""} ${a.description || ""}`) || [];

      a.fingerprint = fp.strict;
      a.entities = freshEnts;

      const fpChanged = oldFp !== fp.strict;
      let entsChanged = oldEnts.length !== freshEnts.length;
      if (!entsChanged) {
        const oldSet = new Set(oldEnts);
        for (const e of freshEnts) {
          if (!oldSet.has(e)) { entsChanged = true; break; }
        }
      }

      if (!fpChanged && !entsChanged) continue;

      // Supabase upsert path needs the full NOT NULL payload, not just the
      // delta — so we rebuild the row from in-memory state. Any article that
      // survived the initial batch SELECT already has these fields populated.
      // Note: signature stays in-memory only; there is no DB column for it
      // yet (D6's migration will add one). The `fingerprint` column stores
      // the strict SHA-1 string.
      updates.push({
        id: a.id,
        source_id: a.source_id,
        title: a.title,
        description: a.description ?? null,
        url: a.url,
        published_at: a.published_at,
        content_hash: a.content_hash,
        fingerprint: a.fingerprint,
        entities: a.entities,
      });
    }

    if (updates.length === 0) return 0;

    // ONE round-trip for the whole cycle via onConflict: "id" upsert.
    // Falls back to chunked batches of 50 if PostgREST chokes on the shape.
    const bulk = await supabase
      .from("articles")
      .upsert(updates, { onConflict: "id" });
    if (!bulk.error) return updates.length;

    log(
      "cluster",
      `enrich: bulk upsert failed (${bulk.error.message}) — falling back to chunked upserts of ${ENRICH_UPSERT_CHUNK}`
    );
    let ok = 0;
    for (let i = 0; i < updates.length; i += ENRICH_UPSERT_CHUNK) {
      const slice = updates.slice(i, i + ENRICH_UPSERT_CHUNK);
      const chunk = await supabase
        .from("articles")
        .upsert(slice, { onConflict: "id" });
      if (chunk.error) {
        log("cluster", `enrich: chunk upsert failed: ${chunk.error.message}`);
        continue;
      }
      ok += slice.length;
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // 4. Cluster context loader — pull clusters + their seed (first) articles
  //    for the 48h rolling window so new articles can be scored against them.
  //    Politics filter: only consider cluster seeds whose underlying articles
  //    belong to POLITICS_CATEGORIES so we don't score against sports clusters.
  // ---------------------------------------------------------------------------

  // In-memory rolling-window cluster context cache. Rolling 48h changes slowly;
  // we refresh at most every CLUSTER_CONTEXT_TTL_MS and otherwise extend the
  // cached snapshot with any new clusters created this cycle.
  // Shape:
  //   {
  //     fetchedAt, clusters, seedByCluster, indices,
  //     sourceIdsByCluster: Map<clusterId, Set<sourceId>>
  //   }
  // The source set is the in-memory mirror of `cluster_articles ⋈ articles`
  // for the per-source dedupe guard in addArticleToCluster (R2's D1 finding:
  // the worker was inserting multiple articles from the same source into the
  // same cluster, producing the user-visible "Akşam twice" UI bug).

  function getClusterSourceSet(clusterId) {
    if (!clusterContextCache) return null;
    return clusterContextCache.sourceIdsByCluster.get(clusterId) || null;
  }

  function markClusterHasSource(clusterId, sourceId) {
    if (!clusterContextCache || !sourceId) return;
    let set = clusterContextCache.sourceIdsByCluster.get(clusterId);
    if (!set) {
      set = new Set();
      clusterContextCache.sourceIdsByCluster.set(clusterId, set);
    }
    set.add(sourceId);
  }

  function registerNewClusterInCache(clusterId, seed) {
    if (!clusterContextCache) return;
    clusterContextCache.seedByCluster.set(clusterId, seed);
    addMemberToIndices(clusterId, seed);
    // Seed the per-source set so the dedupe guard sees the creating article
    // on the very next iteration of this same cycle.
    if (seed.source_id) {
      clusterContextCache.sourceIdsByCluster.set(
        clusterId,
        new Set([seed.source_id])
      );
    } else {
      clusterContextCache.sourceIdsByCluster.set(clusterId, new Set());
    }
    // We mutate clusters[] only so length reporting stays honest — the loop
    // below doesn't re-read fields from it.
    clusterContextCache.clusters.push({
      id: clusterId,
      title_tr: seed.title,
      first_published: seed.published_at,
      updated_at: seed.published_at,
      article_count: 1,
    });
  }

  function invalidateClusterContextCache() {
    clusterContextCache = null;
  }

  async function getClusterContext({ force = false } = {}) {
    const now = Date.now();
    if (
      !force &&
      clusterContextCache &&
      now - clusterContextCache.fetchedAt < CLUSTER_CONTEXT_TTL_MS
    ) {
      return { ...clusterContextCache, cached: true };
    }
    const fresh = await loadClusterContext();
    clusterContextCache = {
      fetchedAt: now,
      clusters: fresh.clusters,
      seedByCluster: fresh.seedByCluster,
      latestByCluster: fresh.latestByCluster,
      sourceIdsByCluster: fresh.sourceIdsByCluster,
      indices: fresh.indices,
    };
    return { ...clusterContextCache, cached: false };
  }

  async function loadClusterContext() {
    const cutoffIso = new Date(
      Date.now() - TIME_WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString();

    // Clusters whose most recent activity is within the window.
    // Was `.limit(2000)` — audit (2026-04-17) found 2,469 clusters in the 48h
    // politics window, so ~470 older-activity clusters were falling off the
    // seed index every cycle. New wire-copies of stories in those clusters
    // couldn't find a match → spawned duplicate clusters. Page through
    // instead; the follow-up `.in()` lookups are already chunked to keep URI
    // lengths sane.
    const clusters = [];
    {
      const PAGE = 1000;
      for (let offset = 0; offset < 100_000; offset += PAGE) {
        const res = await supabase
          .from("clusters")
          .select(
            "id, title_tr, bias_distribution, first_published, updated_at, article_count"
          )
          .gte("updated_at", cutoffIso)
          .order("updated_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (res.error) {
          throw new Error(`loadClusterContext clusters: ${res.error.message}`);
        }
        const page = res.data ?? [];
        clusters.push(...page);
        if (page.length < PAGE) break;
      }
    }
    if (clusters.length === 0) {
      return {
        clusters: [],
        seedByCluster: new Map(),
        latestByCluster: new Map(),
        sourceIdsByCluster: new Map(),
        indices: { byFingerprint: new Map(), byEntity: new Map() },
      };
    }

    const clusterIds = clusters.map((c) => c.id);

    // Member article ids — chunked .in() to stay under PostgREST URI limit.
    const caRows = await inChunked(
      "cluster_articles",
      "cluster_id, article_id",
      "cluster_id",
      clusterIds,
      100
    );

    // For each cluster we want its "seed" = oldest member article still in the
    // 48h window (proxy for the first article that kicked off the cluster).
    const memberIdsByCluster = new Map();
    for (const row of caRows) {
      const list = memberIdsByCluster.get(row.cluster_id) || [];
      list.push(row.article_id);
      memberIdsByCluster.set(row.cluster_id, list);
    }

    const allArticleIds = [...new Set(caRows.map((r) => r.article_id))];
    if (allArticleIds.length === 0) {
      return {
        clusters,
        seedByCluster: new Map(),
        latestByCluster: new Map(),
        sourceIdsByCluster: new Map(),
        indices: { byFingerprint: new Map(), byEntity: new Map() },
      };
    }

    // Politics filter: fetch member articles then client-filter by category.
    // `source_id` is pulled so we can build the per-cluster source set used
    // by the dedupe guard in addArticleToCluster.
    const articleRows = await inChunked(
      "articles",
      "id, source_id, title, description, published_at, fingerprint, entities, category",
      "id",
      allArticleIds,
      100
    );
    const politicsArticleRows = articleRows.filter((a) =>
      POLITICS_CATEGORIES.includes(a.category)
    );
    const memberArticles = new Map(politicsArticleRows.map((a) => [a.id, a]));

    // Build Map<clusterId, Set<sourceId>> over every politics member article,
    // not just the seed. This is the authoritative per-source presence set
    // addArticleToCluster's dedupe guard checks before inserting.
    const sourceIdsByCluster = new Map();
    for (const row of caRows) {
      const art = memberArticles.get(row.article_id);
      if (!art || !art.source_id) continue;
      let set = sourceIdsByCluster.get(row.cluster_id);
      if (!set) {
        set = new Set();
        sourceIdsByCluster.set(row.cluster_id, set);
      }
      set.add(art.source_id);
    }

    // Seed per cluster = oldest published politics member article.
    // Also: compute and attach the MinHash signature ONCE per seed so
    // ensemble.score()'s soft-accept lane has something to work with. The
    // signature is not persisted to the DB (no column yet), so we have to
    // derive it here every time the cluster-context cache refreshes. That's
    // fine — the cache TTL is 60s, so this is at most once a minute per seed.
    const seedByCluster = new Map();
    for (const [clusterId, ids] of memberIdsByCluster.entries()) {
      let seed = null;
      for (const id of ids) {
        const art = memberArticles.get(id);
        if (!art) continue;
        if (!seed || new Date(art.published_at) < new Date(seed.published_at)) {
          seed = art;
        }
      }
      if (seed) {
        if (!seed.signature) {
          const fp = fingerprint(seed.title || "", seed.description || "");
          seed.signature = fp.signature;
          // Prefer the freshly-computed strict hash so cross-cycle
          // comparisons are apples-to-apples with newly-enriched articles.
          if (!seed.fingerprint) seed.fingerprint = fp.strict;
        }
        seedByCluster.set(clusterId, seed);
      }
    }

    // Track the most recently published member per cluster (distinct from seed)
    // so the scoring loop can compare new articles against the latest story
    // framing, not just the original seed text. For developing stories the
    // latest member uses vocabulary closer to incoming articles, boosting
    // recall on multi-hour news cycles. Only useful for clusters with 2+
    // members — single-article clusters have no "latest" distinct from seed.
    const latestByCluster = new Map();
    for (const [clusterId, ids] of memberIdsByCluster.entries()) {
      const seed = seedByCluster.get(clusterId);
      if (!seed) continue;
      let latest = null;
      for (const id of ids) {
        const art = memberArticles.get(id);
        if (!art || art.id === seed.id) continue;
        if (
          !latest ||
          new Date(art.published_at) > new Date(latest.published_at)
        ) {
          latest = art;
        }
      }
      if (latest) {
        // Compute MinHash signature (not persisted, same as seeds).
        const fp = fingerprint(latest.title || "", latest.description || "");
        latest.signature = fp.signature;
        if (!latest.fingerprint) latest.fingerprint = fp.strict;
        latestByCluster.set(clusterId, latest);
      }
    }

    // Inverted indices cover ALL member fingerprints + entities (not just
    // seed), so late wire-copies can still find an existing cluster. Scoring
    // now runs against both seed and latest member; the dedicated strict-fp
    // fast-path in runCycleBody still short-circuits when `article.fingerprint`
    // matches any indexed member.
    const indices = buildMemberIndicesFromRows(caRows, memberArticles);

    return { clusters, seedByCluster, latestByCluster, sourceIdsByCluster, indices };
  }

  // ---------------------------------------------------------------------------
  // 5. Candidate search — which clusters could this article belong to?
  //    - Fingerprint exact match (O(1) via inverted index over ALL members)
  //    - Entity overlap (inverted index over ALL member entities)
  //
  // Indices are built up-front in loadClusterContext() via
  // buildMemberIndicesFromRows(), and patched in-place by
  // registerNewClusterInCache() / addMemberToIndices() as clusters evolve
  // during the cycle.
  // ---------------------------------------------------------------------------

  function addMemberToIndices(clusterId, article) {
    if (!clusterContextCache) return;
    const idx = clusterContextCache.indices;
    if (article.fingerprint) {
      const list = idx.byFingerprint.get(article.fingerprint) || [];
      if (!list.includes(clusterId)) {
        list.push(clusterId);
        idx.byFingerprint.set(article.fingerprint, list);
      }
    }
    for (const ent of article.entities || []) {
      const list = idx.byEntity.get(ent) || [];
      if (!list.includes(clusterId)) {
        list.push(clusterId);
        idx.byEntity.set(ent, list);
      }
    }
  }

  function findCandidateClusters(article, indices) {
    const candidates = new Map(); // clusterId → sharedEntityCount

    if (article.fingerprint) {
      const hit = indices.byFingerprint.get(article.fingerprint);
      if (hit) {
        for (const id of hit) candidates.set(id, Number.POSITIVE_INFINITY);
      }
    }

    const entityCounts = new Map();
    for (const ent of article.entities || []) {
      const hit = indices.byEntity.get(ent);
      if (!hit) continue;
      for (const id of hit) {
        entityCounts.set(id, (entityCounts.get(id) || 0) + 1);
      }
    }
    for (const [id, shared] of entityCounts.entries()) {
      if (shared >= MIN_SHARED_ENTITIES) {
        const prev = candidates.get(id) ?? 0;
        candidates.set(id, Math.max(prev, shared));
      }
    }

    // Sort by shared-entity count desc, fingerprint hits go first (Infinity).
    return [...candidates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CANDIDATE_CLUSTERS)
      .map(([id]) => id);
  }

  // ---------------------------------------------------------------------------
  // 6. Cluster creation + member append
  // ---------------------------------------------------------------------------

  async function createCluster(sourceLookup, article) {
    const bias = sourceLookup.get(article.source_id)?.bias || "center";
    const dist = buildBiasDistribution([bias]);
    const { is_blindspot, blindspot_side } = detectBlindspot(dist);

    const insertRes = await supabase
      .from("clusters")
      .insert({
        title_tr: article.title,
        title_en: article.title,
        summary_tr: summaryFallback(article.description),
        summary_en: summaryFallback(article.description),
        bias_distribution: dist,
        is_blindspot,
        blindspot_side,
        article_count: 1,
        first_published: article.published_at,
        // Use the article's published_at so the cluster's freshness reflects
        // when the news actually happened, not when the worker processed it.
        // During normal continuous operation these are ~equal; during bulk
        // backfill this prevents week-old stories from appearing "just updated".
        updated_at: article.published_at,
      })
      .select("id")
      .single();

    if (insertRes.error) {
      throw new Error(`createCluster: ${insertRes.error.message}`);
    }
    const clusterId = insertRes.data.id;

    const linkRes = await supabase.from("cluster_articles").insert({
      cluster_id: clusterId,
      article_id: article.id,
    });
    if (linkRes.error) {
      throw new Error(`createCluster link: ${linkRes.error.message}`);
    }
    return clusterId;
  }

  async function addArticleToCluster(sourceLookup, clusterId, article) {
    // ----- PER-SOURCE DEDUPE GUARD (R2 duplicate-audit D1) ------------------
    // No more than one article per source per cluster. The cluster-context
    // cache keeps an in-memory Map<clusterId, Set<sourceId>> over every
    // politics member article, so the happy path is a single Set.has() —
    // zero round-trips. On cache miss (cold clusters, or the cache was just
    // invalidated after a thrown cycle) we fall back to a targeted DB query
    // against cluster_articles ⋈ articles.
    if (article.source_id) {
      const cached = getClusterSourceSet(clusterId);
      let existingSources = cached;
      if (!existingSources) {
        const dupRes = await supabase
          .from("cluster_articles")
          .select("article:articles(source_id)")
          .eq("cluster_id", clusterId);
        if (dupRes.error) {
          throw new Error(`addArticle dedupe-check: ${dupRes.error.message}`);
        }
        existingSources = new Set(
          (dupRes.data ?? [])
            .map((r) => r.article?.source_id)
            .filter(Boolean)
        );
        // Backfill the cache so the next check is O(1).
        if (clusterContextCache) {
          clusterContextCache.sourceIdsByCluster.set(clusterId, existingSources);
        }
      }
      if (existingSources.has(article.source_id)) {
        log(
          "cluster",
          `skipped: source ${String(article.source_id).slice(0, 8)} already in cluster ${String(clusterId).slice(0, 8)}`
        );
        return { skipped: true, reason: "duplicate-source" };
      }
    }

    // 1. Insert link (ignore if already exists).
    const linkRes = await supabase.from("cluster_articles").insert({
      cluster_id: clusterId,
      article_id: article.id,
    });
    if (linkRes.error && !/duplicate/i.test(linkRes.error.message)) {
      throw new Error(`addArticle link: ${linkRes.error.message}`);
    }

    // Remember the new (cluster, source) pair in the in-memory cache so
    // subsequent articles in the same cycle see it.
    markClusterHasSource(clusterId, article.source_id);

    // 2. Recompute aggregates from DB truth (small join, but correct).
    const memberRes = await supabase
      .from("cluster_articles")
      .select("article_id")
      .eq("cluster_id", clusterId);
    if (memberRes.error) {
      throw new Error(`addArticle members: ${memberRes.error.message}`);
    }
    const memberIds = (memberRes.data ?? []).map((r) => r.article_id);
    if (memberIds.length === 0) return { skipped: false };

    const artRes = await supabase
      .from("articles")
      .select("id, source_id, published_at")
      .in("id", memberIds);
    if (artRes.error) {
      throw new Error(`addArticle articles: ${artRes.error.message}`);
    }
    const arts = artRes.data ?? [];
    const biasLabels = arts
      .map((a) => sourceLookup.get(a.source_id)?.bias)
      .filter(Boolean);
    const dist = buildBiasDistribution(biasLabels);
    const { is_blindspot, blindspot_side } = detectBlindspot(dist);

    const timestamps = arts
      .map((a) => new Date(a.published_at).getTime())
      .filter((t) => !Number.isNaN(t));
    const firstPublishedIso = timestamps.length
      ? new Date(Math.min(...timestamps)).toISOString()
      : new Date().toISOString();
    // Use the LATEST member article's published_at as the cluster's updated_at
    // so freshness reflects actual news activity, not worker processing time.
    const lastPublishedIso = timestamps.length
      ? new Date(Math.max(...timestamps)).toISOString()
      : new Date().toISOString();

    const updateRes = await supabase
      .from("clusters")
      .update({
        article_count: arts.length,
        bias_distribution: dist,
        is_blindspot,
        blindspot_side,
        first_published: firstPublishedIso,
        updated_at: lastPublishedIso,
      })
      .eq("id", clusterId);
    if (updateRes.error) throw new Error(`addArticle update: ${updateRes.error.message}`);
    return { skipped: false };
  }

  // ---------------------------------------------------------------------------
  // 7. One cycle
  // ---------------------------------------------------------------------------

  async function runOneCycle(cycleNum = 1) {
    const startedAt = Date.now();
    const stats = emptyStats(cycleNum);
    logCycle("cluster", `cycle ${cycleNum} start`);

    // Pull assigned ids then page politics articles newest-first until we have
    // BATCH_SIZE unassigned. PostgREST has no subselect + 1000-row page cap.
    const caAll = await pagedSelect("cluster_articles", "article_id", 1000);
    const assigned = new Set(caAll.map((r) => r.article_id));

    const batch = [];
    const PAGE = 1000;
    for (let offset = 0; offset < 100_000; offset += PAGE) {
      if (batch.length >= BATCH_SIZE) break;
      const res = await supabase
        .from("articles")
        .select(
          "id, source_id, title, description, url, content_hash, published_at, fingerprint, entities, category"
        )
        .in("category", POLITICS_CATEGORIES)
        .order("published_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (res.error) {
        throw new Error(`unclustered fetch: ${res.error.message}`);
      }
      const page = res.data ?? [];
      if (page.length === 0) break;
      for (const row of page) {
        if (!assigned.has(row.id)) {
          batch.push(row);
          if (batch.length >= BATCH_SIZE) break;
        }
      }
      if (page.length < PAGE) break;
    }

    // Per-cycle politics stats — head+count keeps it cheap.
    const totalRes = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .in("category", POLITICS_CATEGORIES);
    const totalPolitics = totalRes.count ?? "?";
    log(
      "cluster",
      `politics: total=${totalPolitics}, unclustered-picked=${batch.length}`
    );

    if (batch.length === 0) {
      stats.duration = (Date.now() - startedAt) / 1000;
      logCycle(
        "cluster",
        `cycle ${cycleNum} end: idle in ${stats.duration.toFixed(1)}s`
      );
      return stats;
    }

    log(
      "cluster",
      `fetched ${batch.length} unclustered politics articles (${assigned.size} already assigned)`
    );
    await runCycleBody(batch, cycleNum, startedAt, stats);
    stats.processed = batch.length;
    stats.duration = (Date.now() - startedAt) / 1000;
    return stats;
  }

  // Shared body — takes a pre-fetched batch and does enrichment → clustering.
  // `stats` is mutated in place so runCycle can return counts to the main loop
  // for the structured cycle summary.
  async function runCycleBody(batch, cycleNum, startedAt, stats) {
    const enriched = await enrichArticles(batch);
    log("cluster", `enriched ${enriched}/${batch.length} rows`);

    const ctx = await getClusterContext();
    const { clusters, seedByCluster, latestByCluster, indices, cached } = ctx;
    log(
      "cluster",
      `${cached ? "cache-hit" : "refreshed"} ${clusters.length} active clusters (${seedByCluster.size} politics seeds)`
    );

    // C5-HABERLER: include `slug` so we can pass per-side source slugs into
    // ensemble.score() for the haberler-com clustering penalty (see A8 audit
    // in team/logs/quality/08-source-diversity.md and SOURCE_PENALTIES in
    // scripts/lib/cluster/ensemble.mjs).
    const sourcesRes = await supabase.from("sources").select("id, bias, name, slug");
    if (sourcesRes.error) throw new Error(`sources: ${sourcesRes.error.message}`);
    const sourceLookup = new Map((sourcesRes.data ?? []).map((s) => [s.id, s]));

    const tfidf = new TfidfIndex();
    for (const [, seed] of seedByCluster.entries()) {
      tfidf.addDoc(seed.id, `${seed.title || ""} ${seed.description || ""}`);
    }
    for (const a of batch) {
      tfidf.addDoc(a.id, `${a.title || ""} ${a.description || ""}`);
    }
    // Add latest member articles to the TF-IDF index so the dual-scoring
    // path can compute cosine between new articles and the latest member
    // (not just the seed). For clusters where the story vocabulary has
    // evolved, the latest member's TF-IDF vector is closer to incoming
    // articles than the seed's.
    for (const [, latest] of (latestByCluster || new Map()).entries()) {
      tfidf.addDoc(latest.id, `${latest.title || ""} ${latest.description || ""}`);
    }
    tfidf.finalize();

    batch.sort(
      (a, b) =>
        new Date(a.published_at).getTime() - new Date(b.published_at).getTime()
    );

    for (const article of batch) {
      if (isShuttingDown()) break;
      // FAST-PATH: strict-fingerprint match against any cluster member.
      // Audit (2026-04-17) found 47 cross-cluster pairs scoring exactly 1.0
      // that should have been single clusters — all wire-copies whose
      // matching peer happened to be a non-seed member. The member-level
      // inverted index now surfaces those; we merge them directly without
      // scoring against a possibly-different-worded seed. try/catch wraps
      // the DB work so a failure here falls through to the ensemble path
      // instead of killing the whole article.
      if (article.fingerprint) {
        const fpHit = indices.byFingerprint.get(article.fingerprint) || [];
        if (fpHit.length > 0) {
          let assignedFp = false;
          const blockedFp = new Set();
          try {
            for (const clusterId of fpHit) {
              if (blockedFp.has(clusterId)) continue;
              const result = await addArticleToCluster(
                sourceLookup,
                clusterId,
                article,
              );
              if (result && result.skipped) {
                blockedFp.add(clusterId);
                stats.skippedDupes++;
                continue;
              }
              stats.matched++;
              assignedFp = true;
              addMemberToIndices(clusterId, article);
              if (debug) {
                log(
                  "cluster",
                  `fp-match art=${article.id.slice(0, 8)} cluster=${String(clusterId).slice(0, 8)}`,
                );
              }
              break;
            }
          } catch (err) {
            log(
              "cluster",
              `fp-fast-path error for ${article.id}: ${err instanceof Error ? err.message : err}`,
            );
          }
          if (assignedFp) continue;  // next article
        }
      }

      const candidateIds = findCandidateClusters(article, indices);
      // D3's new ensemble.score() signature is (aFp, bFp, aEntities, bEntities,
      // tfidfCosine, hoursDelta). The fingerprint bundle is `{ strict, signature }`
      // — we assemble it inline from the per-article in-memory fields populated
      // by enrichArticles() (which stashes `.fingerprint` = strict SHA-1 and
      // `.signature` = Uint32Array(64) MinHash). The bundle doesn't need the
      // `.shingles` member because the scorer only reads `.strict` and
      // `.signature`.
      const articleFp = {
        strict: article.fingerprint ?? null,
        signature: article.signature ?? null,
      };
      // W5-A1: collect ALL viable candidates, not just the single best one,
      // so the per-source dedupe guard can fall back to the next-best cluster
      // instead of forcing a singleton spawn (V4's #1 recall killer — see
      // team/logs/precision-recheck.md §3.3 / final-report.md §3.1). The
      // fallback floor is MATCH_THRESHOLD * 0.9 so we only consider clusters
      // that would have been a credible primary match anyway.
      const FALLBACK_FLOOR = MATCH_THRESHOLD * 0.9;
      const scoredCandidates = [];
      for (const clusterId of candidateIds) {
        const seed = seedByCluster.get(clusterId);
        if (!seed) continue;
        const hoursDeltaSeed = hoursBetween(article.published_at, seed.published_at);
        if (hoursDeltaSeed > TIME_WINDOW_HOURS) continue;
        const seedFp = {
          strict: seed.fingerprint ?? null,
          signature: seed.signature ?? null,
        };
        const tfidfCosineSeed = tfidf.cosine(article.id, seed.id);
        // C5-HABERLER: pass per-side source slugs into the scorer so the
        // SOURCE_PENALTIES table in ensemble.mjs can downweight haberler-com
        // (and any future aggregator firehoses) at clustering time. Both
        // sides go through sourceLookup so the lookup is consistent regardless
        // of whether the seed was loaded from cache or freshly registered.
        const aSourceSlug = sourceLookup.get(article.source_id)?.slug;
        const bSourceSlugSeed = sourceLookup.get(seed.source_id)?.slug;
        const seedRes = score(
          articleFp,
          seedFp,
          article.entities || [],
          seed.entities || [],
          tfidfCosineSeed,
          hoursDeltaSeed,
          { aSourceSlug, bSourceSlug: bSourceSlugSeed }
        );

        // Dual-scoring: also score against the cluster's latest member (if
        // available and distinct from seed). For developing stories the latest
        // member's vocabulary is closer to incoming articles than the seed's
        // original framing. Take the max of seed and latest scores — either
        // representative can carry the pair across threshold. The cost is one
        // extra score() call (pure arithmetic) + one TF-IDF cosine (sparse
        // dot product) per candidate, negligible vs. the DB round-trips.
        let bestRes = seedRes;
        const latest = latestByCluster?.get(clusterId);
        if (latest) {
          const hoursDeltaLatest = hoursBetween(
            article.published_at,
            latest.published_at,
          );
          if (hoursDeltaLatest <= TIME_WINDOW_HOURS) {
            const latestFp = {
              strict: latest.fingerprint ?? null,
              signature: latest.signature ?? null,
            };
            const tfidfCosineLatest = tfidf.cosine(article.id, latest.id);
            const bSourceSlugLatest = sourceLookup.get(latest.source_id)?.slug;
            const latestRes = score(
              articleFp,
              latestFp,
              article.entities || [],
              latest.entities || [],
              tfidfCosineLatest,
              hoursDeltaLatest,
              { aSourceSlug, bSourceSlug: bSourceSlugLatest },
            );
            if (latestRes.score > bestRes.score) bestRes = latestRes;
          }
        }

        if (bestRes.score >= FALLBACK_FLOOR) {
          scoredCandidates.push({
            clusterId,
            score: bestRes.score,
            components: bestRes.components,
          });
        }
      }
      // Best-first descending — primary match must clear MATCH_THRESHOLD;
      // any subsequent fallback only needs to clear FALLBACK_FLOOR.
      scoredCandidates.sort((a, b) => b.score - a.score);
      try {
        let assigned = false;
        const blockedClusters = new Set();
        const primary = scoredCandidates[0];
        if (primary && primary.score >= MATCH_THRESHOLD) {
          // W2-D4: explainability — log the winning component breakdown from
          // D3's ensemble. Gated behind DEBUG=1 because on busy cycles this
          // floods status.log; production runs stay quiet, devs flip the
          // flag when they need to audit scoring decisions.
          if (debug) {
            log(
              "cluster",
              `match ${primary.score.toFixed(2)} comp=${JSON.stringify(primary.components)} art=${article.id.slice(0, 8)} cluster=${primary.clusterId.slice(0, 8)}`
            );
          }
          for (const cand of scoredCandidates) {
            if (assigned) break;
            if (blockedClusters.has(cand.clusterId)) continue;
            // Once we drop below the fallback floor we stop trying.
            if (cand.score < FALLBACK_FLOOR) break;
            const result = await addArticleToCluster(
              sourceLookup,
              cand.clusterId,
              article
            );
            if (result && result.skipped) {
              // Per-source dedupe guard fired: the matched cluster already
              // has an article from this source. W5-A1: instead of falling
              // straight through to a singleton, mark this cluster ineligible
              // for THIS article and try the next-best candidate that still
              // scores ≥ MATCH_THRESHOLD * 0.9. Only if every viable cluster
              // is blocked do we create a new singleton. V4 estimated this
              // recovers 15-25pp of recall on heavily-syndicated stories.
              blockedClusters.add(cand.clusterId);
              stats.skippedDupes++;
              continue;
            }
            stats.matched++;
            assigned = true;
            // Mirror the article into the member indices so subsequent
            // articles in this cycle can match on its fp/entities (not just
            // the seed's). Without this patch the fast-path and entity
            // overlap gate would still only see seed signals.
            addMemberToIndices(cand.clusterId, article);
            if (blockedClusters.size > 0) {
              log(
                "cluster",
                `next-best fallback: ${blockedClusters.size} blocked, assigned to ${cand.clusterId.slice(0, 8)}`
              );
            }
            break;
          }
        }
        if (!assigned) {
          const newId = await createCluster(sourceLookup, article);
          stats.created++;
          // Register directly into the shared cache so subsequent articles
          // in this same batch (and the next cycle) can match against it.
          // We pass through the in-memory signature so ensemble.score()'s
          // MinHash soft-accept lane works on the same cycle this cluster
          // was born — no need to wait for the 60s cache refresh to pick it up.
          registerNewClusterInCache(newId, {
            id: article.id,
            source_id: article.source_id,
            title: article.title,
            description: article.description,
            published_at: article.published_at,
            fingerprint: article.fingerprint,
            signature: article.signature,
            entities: article.entities || [],
          });
        }
      } catch (err) {
        log(
          "cluster",
          `assign error for ${article.id}: ${
            err instanceof Error ? err.message : err
          }`
        );
        continue;
      }
    }

    const totalRes = await supabase
      .from("clusters")
      .select("id", { count: "exact", head: true });
    const totalClusters = totalRes.count ?? "?";

    log(
      "cluster",
      `cycle ${cycleNum}: ${stats.matched} match / ${stats.created} new / skipped-same-source=${stats.skippedDupes} (total clusters: ${totalClusters})`
    );
    logCycle("cluster", `cycle ${cycleNum} end`);
  }

  return { runOneCycle, invalidateContextCache: invalidateClusterContextCache };
}

// ---------------------------------------------------------------------------
// 8. Main loop + shutdown — runs only when this file is invoked directly via
//    `node scripts/cluster-worker.mjs`. When the route handler imports
//    createClusterEngine, this main() is skipped.
// ---------------------------------------------------------------------------

async function main() {
  loadDotEnvLocal();

  const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  // DEBUG=1 enables verbose per-event logging (e.g. every ensemble match).
  // Production runs leave it off so status.log stays scannable — tailers grep
  // for `cycle=` to find the structured summaries.
  const DEBUG = process.env.DEBUG === "1";

  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    log("cluster", `fatal: ${err.message}`);
    process.exit(1);
  }

  // Log a normalized shutdown message via the shared helper before the
  // shared installShutdownHandler fires its own exit timer. Both listeners
  // run because Node dispatches all registered handlers for a signal.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => log("cluster", "cluster-worker: shutting down gracefully"));
  }
  const shutdown = installShutdownHandler("cluster-worker");

  const engine = createClusterEngine({
    supabase,
    isShuttingDown: shutdown.isShuttingDown,
    debug: DEBUG,
  });

  // 3-tier adaptive sleep: tight cadence under load, slow down when idle.
  // Backed by the shared adaptiveSleep helper so the heuristic lives in one
  // place across workers. Same thresholds as the previous inline version:
  //   processed === 0   → idle   (60s)
  //   processed > 10    → busy   (15s)
  //   otherwise (1..10) → normal (30s)
  const pickSleepMs = adaptiveSleep({
    productive: CYCLE_INTERVAL_BUSY_MS,
    small: CYCLE_INTERVAL_NORMAL_MS,
    idle: CYCLE_INTERVAL_IDLE_MS,
  });

  log(
    "cluster",
    `cluster-worker starting (DRY_RUN=${DRY_RUN ? "1" : "0"}, DEBUG=${DEBUG ? "1" : "0"}, adaptive interval=${CYCLE_INTERVAL_BUSY_MS / 1000}/${CYCLE_INTERVAL_NORMAL_MS / 1000}/${CYCLE_INTERVAL_IDLE_MS / 1000}s, batch=${BATCH_SIZE})`
  );
  log(
    "cluster",
    `POLITICS FILTER ACTIVE (${POLITICS_CATEGORIES.join(", ")})`
  );

  let cycleNum = 0;

  if (DRY_RUN) {
    cycleNum++;
    let stats = emptyStats(cycleNum);
    try {
      stats = await engine.runOneCycle(cycleNum);
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      log("cluster", `cycle threw: ${msg}`);
      log("cluster", `cycle ${cycleNum} ERROR ${msg.slice(0, 120)}`);
    }
    // DRY_RUN exits after one cycle — sleep=0 is a sentinel meaning
    // "no next cycle". Format stays consistent so tailers grep the same shape.
    log("cluster", formatCycleSummary(stats, 0));
    log("cluster", "DRY_RUN complete — exiting");
    process.exit(0);
  }

  while (!shutdown.isShuttingDown()) {
    cycleNum++;
    let stats = emptyStats(cycleNum);
    try {
      stats = await engine.runOneCycle(cycleNum);
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      log("cluster", `cycle threw: ${msg}`);
      log("cluster", `cycle ${cycleNum} ERROR ${msg.slice(0, 120)}`);
      // A thrown cycle might leave the cache in a half-updated state;
      // force the next cycle to refetch.
      engine.invalidateContextCache();
    }
    if (shutdown.isShuttingDown()) break;
    const sleepMs = pickSleepMs(stats.processed);
    log("cluster", formatCycleSummary(stats, sleepMs));
    await sleep(sleepMs);
  }
}

const isMainModule = (() => {
  try {
    if (!process.argv[1]) return false;
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch { return false; }
})();

if (isMainModule) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    log("cluster", `fatal: ${msg}`);
    process.exit(1);
  });
}
