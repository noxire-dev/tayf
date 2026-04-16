#!/usr/bin/env node
// scripts/merge-duplicate-clusters.mjs
//
// One-shot: find politics clusters that share ≥1 strict fingerprint with
// another cluster (i.e. they contain wire-copies of the same story) and
// merge them into the oldest canonical cluster.
//
// Why this exists: the 2026-04-17 audit found 88 duplicate cluster-families
// in 48h — wire-copy stories split across multiple clusters because the
// cluster-context cache's `.limit(2000)` on updated_at meant older clusters
// were missing from the seed index when their wire-copy twin arrived. The
// cluster-worker's new member-level fp index + fast-path prevents FUTURE
// fragmentation, but already-split clusters stay split until we merge them.
//
// Algorithm:
//   1. Pull (cluster_id, fingerprint) pairs for every politics member.
//   2. Union-find over shared fingerprints → groups of clusters that share
//      ≥1 wire-copy member.
//   3. For each group with ≥2 clusters: canonical = oldest first_published.
//   4. Re-parent every cluster_articles row from dup → canonical, skip on
//      (cluster_id, article_id) conflict.
//   5. Delete dup cluster rows (cascade takes remaining links).
//   6. Recompute canonical aggregates (article_count, bias_distribution,
//      first_published, blindspot).
//
// Usage:
//   node scripts/merge-duplicate-clusters.mjs
//   DRY_RUN=1 node scripts/merge-duplicate-clusters.mjs     # report only

import { loadDotEnvLocal } from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";

loadDotEnvLocal();

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const POLITICS_CATEGORIES = ["politika", "son_dakika"];

const supabase = createServiceClient();

const BIAS_KEYS = [
  "pro_government", "gov_leaning", "state_media",
  "center", "opposition_leaning", "opposition",
  "nationalist", "islamist_conservative",
  "pro_kurdish", "international",
];

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

async function pagedSelect(table, select, filter = null, pageSize = 1000) {
  const out = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select(select);
    if (filter) q = filter(q);
    q = q.range(offset, offset + pageSize - 1);
    const res = await q;
    if (res.error) throw new Error(`paged(${table}): ${res.error.message}`);
    const rows = res.data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 10_000_000) break;
  }
  return out;
}

async function inChunked(table, select, column, values, chunkSize = 100) {
  if (values.length === 0) return [];
  const out = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    const slice = values.slice(i, i + chunkSize);
    const res = await supabase.from(table).select(select).in(column, slice);
    if (res.error) throw new Error(`in(${table}): ${res.error.message}`);
    for (const row of res.data ?? []) out.push(row);
  }
  return out;
}

// Union-find -----------------------------------------------------------------
function makeUF() {
  const p = new Map();
  const find = (x) => {
    let r = x;
    while (p.get(r) !== r) r = p.get(r);
    let c = x;
    while (p.get(c) !== r) { const n = p.get(c); p.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => {
    if (!p.has(a)) p.set(a, a);
    if (!p.has(b)) p.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) p.set(ra, rb);
  };
  return { p, find, union };
}

async function main() {
  console.log(`merge-duplicate-clusters starting (DRY_RUN=${DRY_RUN ? "1" : "0"})`);

  // 1. Pull politics articles with cluster link.
  console.log("loading politics articles...");
  const articles = await pagedSelect(
    "articles",
    "id, fingerprint, category, source_id, published_at",
    (q) => q.in("category", POLITICS_CATEGORIES).not("fingerprint", "is", null),
  );
  const articleIds = articles.map((a) => a.id);
  const fpById = new Map(articles.map((a) => [a.id, a.fingerprint]));
  console.log(`  ${articles.length} politics articles with fingerprints`);

  // 2. Cluster links for these articles.
  console.log("loading cluster_articles...");
  const caRows = await inChunked(
    "cluster_articles",
    "cluster_id, article_id",
    "article_id",
    articleIds,
    100,
  );
  console.log(`  ${caRows.length} cluster_articles rows`);

  // 3. Build (fingerprint → clusterIds) and (clusterId → articleIds).
  const clustersByFp = new Map();
  const articlesByCluster = new Map();
  for (const row of caRows) {
    const fp = fpById.get(row.article_id);
    if (!fp) continue;
    const set = clustersByFp.get(fp) || new Set();
    set.add(row.cluster_id);
    clustersByFp.set(fp, set);

    const arr = articlesByCluster.get(row.cluster_id) || [];
    arr.push(row.article_id);
    articlesByCluster.set(row.cluster_id, arr);
  }

  // 4. Union-find: clusters sharing any fingerprint are in the same family.
  const uf = makeUF();
  for (const set of clustersByFp.values()) {
    if (set.size < 2) continue;
    const arr = [...set];
    for (let i = 1; i < arr.length; i++) uf.union(arr[0], arr[i]);
  }

  // Group by root.
  const families = new Map();
  for (const key of uf.p.keys()) {
    const r = uf.find(key);
    const list = families.get(r) || [];
    list.push(key);
    families.set(r, list);
  }
  const mergeFamilies = [...families.values()].filter((c) => c.length >= 2);
  console.log(`found ${mergeFamilies.length} duplicate cluster-families covering ${mergeFamilies.reduce((n, f) => n + f.length, 0)} clusters`);

  if (mergeFamilies.length === 0) {
    console.log("nothing to merge.");
    return;
  }

  // 5. Fetch cluster metadata for all involved clusters.
  const allFamilyClusterIds = [...new Set(mergeFamilies.flat())];
  const clusterRows = await inChunked(
    "clusters",
    "id, title_tr, first_published, article_count",
    "id",
    allFamilyClusterIds,
    100,
  );
  const clusterMeta = new Map(clusterRows.map((c) => [c.id, c]));

  // 6. Sources (for bias recomputation).
  const sourcesRes = await supabase.from("sources").select("id, bias");
  if (sourcesRes.error) throw new Error(sourcesRes.error.message);
  const biasById = new Map((sourcesRes.data ?? []).map((s) => [s.id, s.bias]));

  let familiesMerged = 0;
  let linksRewritten = 0;
  let linksDropped = 0;
  let clustersDeleted = 0;
  const sampleLog = [];

  // 7. Process families.
  for (const family of mergeFamilies) {
    // Pick canonical: oldest first_published (ties → most members).
    const metas = family
      .map((id) => clusterMeta.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        const da = new Date(a.first_published).getTime();
        const db = new Date(b.first_published).getTime();
        if (da !== db) return da - db;
        return (b.article_count || 0) - (a.article_count || 0);
      });
    if (metas.length < 2) continue;
    const canonical = metas[0];
    const dups = metas.slice(1);

    // Existing canonical article set.
    const canonicalArticleIds = new Set(articlesByCluster.get(canonical.id) || []);

    if (sampleLog.length < 5) {
      sampleLog.push({
        canonical: { id: canonical.id.slice(0, 8), title: canonical.title_tr?.slice(0, 80) },
        dups: dups.map((d) => ({ id: d.id.slice(0, 8), title: d.title_tr?.slice(0, 80) })),
      });
    }

    // Transfer links.
    for (const dup of dups) {
      const dupArticleIds = articlesByCluster.get(dup.id) || [];
      for (const aid of dupArticleIds) {
        if (canonicalArticleIds.has(aid)) {
          linksDropped++;
          continue;
        }
        if (!DRY_RUN) {
          // Move the cluster_articles row to the canonical cluster.
          const up = await supabase
            .from("cluster_articles")
            .update({ cluster_id: canonical.id })
            .eq("cluster_id", dup.id)
            .eq("article_id", aid);
          if (up.error) {
            console.error(`update failed ${dup.id.slice(0,8)} → ${canonical.id.slice(0,8)}: ${up.error.message}`);
            continue;
          }
        }
        canonicalArticleIds.add(aid);
        linksRewritten++;
      }

      // Delete the dup cluster. Cascade removes any remaining
      // cluster_articles rows (the in-conflict ones we skipped above).
      if (!DRY_RUN) {
        const del = await supabase.from("clusters").delete().eq("id", dup.id);
        if (del.error) {
          console.error(`delete dup ${dup.id.slice(0,8)}: ${del.error.message}`);
          continue;
        }
      }
      clustersDeleted++;
    }

    // Recompute canonical aggregates from final member set.
    if (!DRY_RUN) {
      const memberIds = [...canonicalArticleIds];
      const artRes = await inChunked(
        "articles",
        "id, source_id, published_at",
        "id",
        memberIds,
        100,
      );
      const biasLabels = artRes
        .map((a) => biasById.get(a.source_id))
        .filter(Boolean);
      const dist = buildBiasDistribution(biasLabels);
      const { is_blindspot, blindspot_side } = detectBlindspot(dist);
      const times = artRes.map((a) => new Date(a.published_at).getTime()).filter((t) => !Number.isNaN(t));
      const firstPublishedIso = times.length
        ? new Date(Math.min(...times)).toISOString()
        : canonical.first_published;
      const up = await supabase
        .from("clusters")
        .update({
          article_count: artRes.length,
          bias_distribution: dist,
          is_blindspot,
          blindspot_side,
          first_published: firstPublishedIso,
          updated_at: new Date().toISOString(),
        })
        .eq("id", canonical.id);
      if (up.error) console.error(`canonical update ${canonical.id.slice(0,8)}: ${up.error.message}`);
    }

    familiesMerged++;
  }

  console.log("");
  console.log("done.");
  console.log(`  families merged:     ${familiesMerged}`);
  console.log(`  links rewritten:     ${linksRewritten}`);
  console.log(`  links dropped (conflict with canonical): ${linksDropped}`);
  console.log(`  clusters deleted:    ${clustersDeleted}`);
  console.log("");
  console.log("sample merges (first 5):");
  for (const s of sampleLog) {
    console.log(`  canonical ${s.canonical.id}: ${s.canonical.title}`);
    for (const d of s.dups) {
      console.log(`    ← dup ${d.id}: ${d.title}`);
    }
  }
}

main().catch((err) => {
  console.error("merge failed:", err);
  process.exit(1);
});
