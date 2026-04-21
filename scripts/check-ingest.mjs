#!/usr/bin/env node
// One-off diagnostic: when did we last ingest anything, how fresh is it,
// and is clustering keeping up? Run with: `node scripts/check-ingest.mjs`.
import { loadDotEnvLocal } from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";

loadDotEnvLocal();
const sb = createServiceClient();

const now = Date.now();
const windows = [
  ["5m",   5 * 60_000],
  ["15m", 15 * 60_000],
  ["1h",   60 * 60_000],
  ["6h",   6 * 60 * 60_000],
  ["24h", 24 * 60 * 60_000],
  ["48h", 48 * 60 * 60_000],
  ["7d",   7 * 24 * 60 * 60_000],
];

async function countSince(col, ms) {
  const since = new Date(now - ms).toISOString();
  const { count, error } = await sb
    .from("articles")
    .select("*", { count: "exact", head: true })
    .gte(col, since);
  return error ? `ERR ${error.message}` : count;
}

// 1. Most recent and oldest
const { data: latest } = await sb
  .from("articles")
  .select("created_at, published_at, title")
  .order("created_at", { ascending: false })
  .limit(1);
const { data: oldest } = await sb
  .from("articles")
  .select("created_at, published_at")
  .order("created_at", { ascending: true })
  .limit(1);

console.log("=== Articles table ===");
if (latest?.[0]) {
  const l = latest[0];
  const ageMin = ((now - new Date(l.created_at).getTime()) / 60_000).toFixed(1);
  const pAge = ((now - new Date(l.published_at).getTime()) / 60_000).toFixed(1);
  console.log(`Most recent created_at:   ${l.created_at} (${ageMin} min ago)`);
  console.log(`  ↳ published_at:          ${l.published_at} (${pAge} min ago)`);
  console.log(`  ↳ title: ${l.title?.slice(0, 80)}`);
}
if (oldest?.[0]) {
  const o = oldest[0];
  const ageH = ((now - new Date(o.created_at).getTime()) / 3_600_000).toFixed(1);
  console.log(`Oldest created_at:        ${o.created_at} (${ageH} h ago)`);
}

console.log("\n=== Counts by created_at (ingest time) ===");
for (const [label, ms] of windows) {
  console.log(`  ${label.padStart(4)}: ${await countSince("created_at", ms)}`);
}

console.log("\n=== Counts by published_at (article's own date) ===");
for (const [label, ms] of windows) {
  console.log(`  ${label.padStart(4)}: ${await countSince("published_at", ms)}`);
}

// 2. Clustering — if the home feed shows clusters, do clusters exist for
// recent articles?
console.log("\n=== Clusters ===");
{
  const { count: totalClusters } = await sb
    .from("clusters")
    .select("*", { count: "exact", head: true });
  console.log(`Total clusters: ${totalClusters}`);

  // Most recently CREATED cluster (i.e. cluster-worker formed a new one).
  const { data: latestCreated } = await sb
    .from("clusters")
    .select("created_at, updated_at, title_tr, article_count")
    .order("created_at", { ascending: false })
    .limit(1);
  if (latestCreated?.[0]) {
    const c = latestCreated[0];
    const ageMin = ((now - new Date(c.created_at).getTime()) / 60_000).toFixed(1);
    console.log(`Newest cluster.created_at: ${c.created_at} (${ageMin} min ago)`);
    console.log(`  title: ${c.title_tr?.slice(0, 80)}`);
    console.log(`  article_count: ${c.article_count}`);
  }

  // Most recently UPDATED cluster (cluster-worker attached a new article to
  // an existing cluster). This is what the home feed orders by, so its
  // freshness directly drives "how old does the feed feel".
  const { data: latestUpdated } = await sb
    .from("clusters")
    .select("updated_at, title_tr, article_count")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (latestUpdated?.[0]) {
    const c = latestUpdated[0];
    const ageMin = ((now - new Date(c.updated_at).getTime()) / 60_000).toFixed(1);
    console.log(`Newest cluster.updated_at: ${c.updated_at} (${ageMin} min ago)`);
    console.log(`  title: ${c.title_tr?.slice(0, 80)}`);
  }

  // Clusters created per window — is the cluster-worker alive?
  console.log("Clusters created per window:");
  for (const [label, ms] of [["15m", 900_000], ["1h", 3600_000], ["6h", 21600_000], ["24h", 86400_000]]) {
    const since = new Date(now - ms).toISOString();
    const { count, error } = await sb
      .from("clusters")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);
    console.log(`  ${label.padStart(4)}: ${error ? "ERR "+error.message : count}`);
  }
  console.log("Clusters updated per window:");
  for (const [label, ms] of [["15m", 900_000], ["1h", 3600_000], ["6h", 21600_000], ["24h", 86400_000]]) {
    const since = new Date(now - ms).toISOString();
    const { count, error } = await sb
      .from("clusters")
      .select("*", { count: "exact", head: true })
      .gte("updated_at", since);
    console.log(`  ${label.padStart(4)}: ${error ? "ERR "+error.message : count}`);
  }

  // Articles with no cluster — ingested but not yet grouped.
  // `cluster_articles` is the join table.
  const since1h = new Date(now - 3600_000).toISOString();
  // Fetch recent article ids, then ask which of them have a cluster_articles row.
  const { data: recentArticles, error: recErr } = await sb
    .from("articles")
    .select("id")
    .gte("created_at", since1h);
  if (!recErr && recentArticles) {
    const ids = recentArticles.map((a) => a.id);
    let joined = 0;
    // Batch the .in() calls — PostgREST has url length limits.
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { data } = await sb
        .from("cluster_articles")
        .select("article_id")
        .in("article_id", chunk);
      joined += data?.length ?? 0;
    }
    const total = ids.length;
    console.log(`Articles ingested in last 1h: ${total} total, ${joined} clustered, ${total - joined} unclustered`);
  }
}

// 3. Active sources — who's working, who's dead?
const { data: sources } = await sb
  .from("sources")
  .select("id, slug, name, active")
  .eq("active", true);

console.log(`\n=== Sources (${sources.length} active) ===`);

const staleness = await Promise.all(
  sources.map(async (s) => {
    const { data: row } = await sb
      .from("articles")
      .select("created_at")
      .eq("source_id", s.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const ts = row?.[0]?.created_at;
    return {
      slug: s.slug,
      name: s.name,
      last: ts,
      ageMin: ts ? (now - new Date(ts).getTime()) / 60_000 : Infinity,
    };
  })
);

staleness.sort((a, b) => b.ageMin - a.ageMin);

const neverSeen = staleness.filter((s) => s.ageMin === Infinity);
const over24h = staleness.filter((s) => s.ageMin !== Infinity && s.ageMin > 24 * 60);
const between6and24 = staleness.filter((s) => s.ageMin > 360 && s.ageMin <= 1440);
const under6h = staleness.filter((s) => s.ageMin <= 360);

console.log(`  NEVER ingested:   ${neverSeen.length}`);
console.log(`  > 24h stale:      ${over24h.length}`);
console.log(`  6h–24h stale:     ${between6and24.length}`);
console.log(`  < 6h fresh:       ${under6h.length}`);

if (neverSeen.length) {
  console.log("\nNEVER ingested (top 20):");
  for (const s of neverSeen.slice(0, 20)) {
    console.log(`    ${s.slug.padEnd(28)} ${s.name}`);
  }
}
if (over24h.length) {
  console.log("\n>24h stale (top 10):");
  for (const s of over24h.slice(0, 10)) {
    const age = s.ageMin > 1440
      ? `${(s.ageMin / 1440).toFixed(1)}d`
      : `${(s.ageMin / 60).toFixed(1)}h`;
    console.log(`    ${age.padStart(7)}  ${s.slug.padEnd(28)} ${s.name}`);
  }
}
