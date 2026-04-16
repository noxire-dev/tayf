#!/usr/bin/env node
// scripts/refingerprint.mjs
//
// One-shot backfill: walk all politics articles, recompute fingerprint +
// entities from current title/description, persist rows that drifted from
// the DB-stored values.
//
// Why this exists: the 2026-04-17 audit found wire-copy articles whose
// persisted fingerprints no longer matched what the current algorithm
// would produce on the same title — title-mutating migrations (018, 019)
// ran after ingestion, so the stored hash was stuck on the pre-rewrite
// shingles. That broke the strict-fingerprint auto-accept path at cluster
// time: articles that should have merged as wire-copies got split across
// clusters instead.
//
// The cluster-worker's enrichArticles() now always recomputes, so new
// articles stay consistent. This script is the one-time catch-up for
// historical rows.
//
// Usage:
//   node scripts/refingerprint.mjs
//   DRY_RUN=1 node scripts/refingerprint.mjs    # scan + report, no writes

import { fingerprint } from "./lib/cluster/fingerprint.mjs";
import { extractEntities } from "./lib/cluster/entities.mjs";
import { loadDotEnvLocal } from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";

loadDotEnvLocal();

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const POLITICS_CATEGORIES = ["politika", "son_dakika"];
const PAGE = 1000;
const UPSERT_CHUNK = 100;

const supabase = createServiceClient();

function entsEqual(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const e of b) if (!s.has(e)) return false;
  return true;
}

async function main() {
  console.log(`refingerprint starting (DRY_RUN=${DRY_RUN ? "1" : "0"})`);
  let scanned = 0;
  let drifted = 0;
  let persisted = 0;
  const drifts = [];

  // Page through politics articles.
  for (let offset = 0; offset < 10_000_000; offset += PAGE) {
    const res = await supabase
      .from("articles")
      .select(
        "id, source_id, title, description, url, published_at, content_hash, fingerprint, entities, category",
      )
      .in("category", POLITICS_CATEGORIES)
      .order("published_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (res.error) throw new Error(`fetch page: ${res.error.message}`);
    const rows = res.data ?? [];
    if (rows.length === 0) break;

    const updates = [];
    for (const a of rows) {
      scanned++;
      const fp = fingerprint(a.title || "", a.description || "");
      const freshEnts =
        extractEntities(`${a.title || ""} ${a.description || ""}`) || [];
      const oldEnts = Array.isArray(a.entities) ? a.entities : [];

      const fpChanged = a.fingerprint !== fp.strict;
      const entsChanged = !entsEqual(oldEnts, freshEnts);
      if (!fpChanged && !entsChanged) continue;

      drifted++;
      drifts.push({
        id: a.id,
        title: String(a.title || "").slice(0, 80),
        fpChanged,
        entsChanged,
      });
      updates.push({
        id: a.id,
        source_id: a.source_id,
        title: a.title,
        description: a.description ?? null,
        url: a.url,
        published_at: a.published_at,
        content_hash: a.content_hash,
        fingerprint: fp.strict,
        entities: freshEnts,
      });
    }

    if (updates.length > 0 && !DRY_RUN) {
      for (let i = 0; i < updates.length; i += UPSERT_CHUNK) {
        const slice = updates.slice(i, i + UPSERT_CHUNK);
        const up = await supabase
          .from("articles")
          .upsert(slice, { onConflict: "id" });
        if (up.error) {
          console.error(`upsert chunk failed: ${up.error.message}`);
          continue;
        }
        persisted += slice.length;
      }
    } else if (updates.length > 0) {
      persisted += updates.length;  // report as "would-persist" in dry-run
    }

    process.stdout.write(
      `scanned=${scanned} drifted=${drifted} ${DRY_RUN ? "would-persist" : "persisted"}=${persisted}\r`,
    );

    if (rows.length < PAGE) break;
  }

  console.log("");
  console.log("done.");
  console.log(`  scanned:   ${scanned}`);
  console.log(`  drifted:   ${drifted}  (${((100 * drifted) / Math.max(1, scanned)).toFixed(1)}%)`);
  console.log(`  ${DRY_RUN ? "would-persist" : "persisted"}: ${persisted}`);

  if (drifts.length > 0) {
    console.log("\nfirst 10 drifts:");
    for (const d of drifts.slice(0, 10)) {
      const flags = [d.fpChanged ? "fp" : "", d.entsChanged ? "ents" : ""]
        .filter(Boolean)
        .join("+");
      console.log(`  [${flags}]  ${d.id.slice(0, 8)}  ${d.title}`);
    }
  }
}

main().catch((err) => {
  console.error("refingerprint failed:", err);
  process.exit(1);
});
