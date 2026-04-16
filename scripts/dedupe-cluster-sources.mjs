#!/usr/bin/env node
// scripts/dedupe-cluster-sources.mjs
//
// One-shot: for each cluster that contains >1 article from the same source,
// keep ONE article per (cluster, source) and orphan the rest by deleting
// their cluster_articles rows.
//
// Why this exists: the per-source dedupe guard in cluster-worker
// (addArticleToCluster) prevents FUTURE duplicates, but historical merges —
// notably merge-duplicate-clusters.mjs run on 2026-04-17 — can unify two
// dup clusters that each held an article from source X, producing a single
// canonical cluster with source X twice. The UI's bias distribution uses
// per-article bias, so duplicate sources inflate the count for that side.
//
// Picking rule: **keep the oldest article per (cluster, source)** so the
// cluster's "seed" (oldest member) stays stable across runs — the cluster
// worker's seedByCluster map identifies seeds the same way.
//
// Orphaned articles drop back into the unclustered pool and the next worker
// cycle will re-route them via the strict-fp fast-path or ensemble scoring.
//
// Usage:
//   node scripts/dedupe-cluster-sources.mjs
//   DRY_RUN=1 node scripts/dedupe-cluster-sources.mjs

import { loadDotEnvLocal } from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";

loadDotEnvLocal();

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const POLITICS_CATEGORIES = ["politika", "son_dakika"];

const supabase = createServiceClient();

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

async function main() {
  console.log(`dedupe-cluster-sources starting (DRY_RUN=${DRY_RUN ? "1" : "0"})`);

  // 1. Pull politics articles with cluster + source + published_at.
  const articles = await pagedSelect(
    "articles",
    "id, source_id, category, published_at",
    (q) => q.in("category", POLITICS_CATEGORIES),
  );
  const articleIds = articles.map((a) => a.id);
  const byId = new Map(articles.map((a) => [a.id, a]));
  console.log(`  ${articles.length} politics articles loaded`);

  // 2. Cluster membership.
  const caRows = await inChunked(
    "cluster_articles",
    "cluster_id, article_id",
    "article_id",
    articleIds,
    100,
  );
  console.log(`  ${caRows.length} cluster_articles rows`);

  // 3. Group articles by (cluster_id, source_id).
  //    Map<clusterId, Map<sourceId, articleRow[]>>
  const grouped = new Map();
  for (const row of caRows) {
    const art = byId.get(row.article_id);
    if (!art || !art.source_id) continue;
    let perCluster = grouped.get(row.cluster_id);
    if (!perCluster) {
      perCluster = new Map();
      grouped.set(row.cluster_id, perCluster);
    }
    const list = perCluster.get(art.source_id) || [];
    list.push(art);
    perCluster.set(art.source_id, list);
  }

  // 4. Find violations: (cluster, source) with ≥2 articles.
  const orphanTargets = [];  // { clusterId, articleId }
  const touchedClusters = new Set();
  for (const [clusterId, perSource] of grouped.entries()) {
    for (const [sourceId, arts] of perSource.entries()) {
      if (arts.length < 2) continue;
      touchedClusters.add(clusterId);
      // Keep oldest, orphan the rest.
      arts.sort(
        (a, b) =>
          new Date(a.published_at).getTime() -
          new Date(b.published_at).getTime(),
      );
      for (let i = 1; i < arts.length; i++) {
        orphanTargets.push({ clusterId, articleId: arts[i].id, sourceId });
      }
    }
  }

  console.log(`violations: ${touchedClusters.size} cluster(s), ${orphanTargets.length} article(s) to orphan`);

  if (orphanTargets.length === 0) {
    console.log("nothing to do.");
    return;
  }

  // 5. Delete cluster_articles rows for the extras.
  let deleted = 0;
  for (const t of orphanTargets) {
    if (!DRY_RUN) {
      const del = await supabase
        .from("cluster_articles")
        .delete()
        .eq("cluster_id", t.clusterId)
        .eq("article_id", t.articleId);
      if (del.error) {
        console.error(
          `delete (${t.clusterId.slice(0, 8)}, ${t.articleId.slice(0, 8)}): ${del.error.message}`,
        );
        continue;
      }
    }
    deleted++;
  }

  // 6. Recompute aggregates for touched clusters (article_count +
  //    bias_distribution). Even though orphaning only drops duplicates of
  //    a source that's still represented, the stored article_count needs to
  //    reflect the smaller member set, and bias_distribution was inflated
  //    by the duplicate bias label.
  const sourcesRes = await supabase.from("sources").select("id, bias");
  if (sourcesRes.error) throw new Error(sourcesRes.error.message);
  const biasById = new Map((sourcesRes.data ?? []).map((s) => [s.id, s.bias]));

  const BIAS_KEYS = [
    "pro_government", "gov_leaning", "state_media",
    "center", "opposition_leaning", "opposition",
    "nationalist", "islamist_conservative",
    "pro_kurdish", "international",
  ];
  const buildDist = (labels) => {
    const d = Object.fromEntries(BIAS_KEYS.map((k) => [k, 0]));
    for (const b of labels) if (b in d) d[b]++;
    return d;
  };
  const detectBlindspot = (d) => {
    const entries = Object.entries(d).filter(([, n]) => n > 0);
    if (entries.length === 1) return { is_blindspot: true, blindspot_side: entries[0][0] };
    return { is_blindspot: false, blindspot_side: null };
  };

  let recomputed = 0;
  if (!DRY_RUN) {
    for (const clusterId of touchedClusters) {
      const memRes = await supabase
        .from("cluster_articles")
        .select("article_id")
        .eq("cluster_id", clusterId);
      if (memRes.error) {
        console.error(`members for ${clusterId.slice(0, 8)}: ${memRes.error.message}`);
        continue;
      }
      const memberIds = (memRes.data ?? []).map((r) => r.article_id);
      if (memberIds.length === 0) continue;
      const artRes = await inChunked(
        "articles",
        "id, source_id, published_at",
        "id",
        memberIds,
        100,
      );
      const labels = artRes
        .map((a) => biasById.get(a.source_id))
        .filter(Boolean);
      const dist = buildDist(labels);
      const { is_blindspot, blindspot_side } = detectBlindspot(dist);
      const times = artRes
        .map((a) => new Date(a.published_at).getTime())
        .filter((t) => !Number.isNaN(t));
      const firstPublishedIso = times.length
        ? new Date(Math.min(...times)).toISOString()
        : new Date().toISOString();
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
        .eq("id", clusterId);
      if (up.error) {
        console.error(`update ${clusterId.slice(0, 8)}: ${up.error.message}`);
        continue;
      }
      recomputed++;
    }
  }

  console.log("");
  console.log("done.");
  console.log(`  articles orphaned (cluster_articles rows deleted): ${deleted}`);
  console.log(`  clusters with aggregates recomputed: ${recomputed}`);
}

main().catch((err) => {
  console.error("dedupe failed:", err);
  process.exit(1);
});
