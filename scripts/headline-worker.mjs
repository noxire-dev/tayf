#!/usr/bin/env node
// scripts/headline-worker.mjs
//
// Continuous neutral-headline rewrite worker for Tayf.
//
// Background (per A3 audit + migration 019_neutral_headlines.sql):
//   46% of seed cluster titles fail clarity/neutrality checks and 38%
//   leak the source's tone. To fix this without losing the original
//   title we keep three columns on `clusters`:
//     - title_tr           (current display title; seed-inherited)
//     - title_tr_original  (snapshot of the seed title for transparency)
//     - title_tr_neutral   (LLM-rewritten neutral version, NULL until
//                           this worker fills it in)
//     - title_neutral_at   (timestamp of last successful rewrite)
//
// This worker walks the index `idx_clusters_needs_rewrite`
// (`title_neutral_at IS NULL AND article_count >= 3`) in small batches,
// fetches member titles, calls H1's `rewriteClusterHeadline()` from
// scripts/lib/shared/llm-headlines.mjs (which talks to claude-haiku-4-5
// via the Anthropic REST API), and writes the result back into
// `title_tr_neutral` plus a `title_neutral_at = now()` stamp. The page
// consumers (politics-query.ts, cluster-detail-query.ts) coalesce
// `title_tr_neutral` over `title_tr` so neutralized titles win as soon
// as they're available without a second migration step.
//
// Cost discipline:
//   - Batch size 5 (LLM_BATCH) — small on purpose. Per A3, total monthly
//     spend on claude-haiku-4-5 should stay under $1 even at full corpus
//     coverage; 5 rewrites every 60s = 7,200/day, well within budget.
//   - Sleep 60s between productive batches, 300s when there's nothing
//     to rewrite. We're not latency-sensitive — neutral titles are a
//     polish layer over already-published content.
//   - If ANTHROPIC_API_KEY is missing we log a warning and sleep 600s
//     before re-checking. The worker stays running so the operator can
//     drop a key into .env.local and reload (next ssh restart) without
//     hand-restarting this process.
//
// Architecture parity:
//   - ESM, Node 20, no TypeScript. Mirrors scripts/cluster-worker.mjs and
//     scripts/image-worker.mjs structure.
//   - Uses the shared helpers in scripts/lib/shared/ (env, supabase,
//     log, signal, sleep) so worker conventions stay DRY.
//   - DRY_RUN=1 → run a single cycle and exit. If the API key is missing,
//     DRY_RUN logs the "no key" warning and exits 0 (it does NOT sleep
//     for 600s — that would defeat the point of a smoke test).
//   - SIGINT/SIGTERM → graceful shutdown via installShutdownHandler.
//
// Important: does NOT modify scripts/lib/shared/llm-headlines.mjs (H1's
// territory) — we only call its exported rewriteClusterHeadline().
//
// Usage:
//   node scripts/headline-worker.mjs              # run forever
//   DRY_RUN=1 node scripts/headline-worker.mjs    # one cycle, exit

import {
  loadDotEnvLocal,
  log,
  logCycle,
  ts,
  installShutdownHandler,
  sleep,
} from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";
import { rewriteClusterHeadline } from "./lib/shared/llm-headlines.mjs";

// ---------------------------------------------------------------------------
// 1. Env + config
// ---------------------------------------------------------------------------

loadDotEnvLocal();

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

// Batch / sleep tuning. Kept conservative on purpose — see header comment.
const LLM_BATCH = 5;
const CYCLE_SLEEP_PRODUCTIVE_MS = 60_000;   // 60s between productive batches
const CYCLE_SLEEP_IDLE_MS = 300_000;        // 5m when nothing to rewrite
const NO_KEY_SLEEP_MS = 600_000;            // 10m re-check when API key missing

// Minimum article_count to trigger rewrite — matches the partial index
// `idx_clusters_needs_rewrite` from migration 019. Anything smaller
// would burn LLM budget on noise / single-source clusters.
const MIN_ARTICLE_COUNT = 3;

// Cap on how many member titles we hand to the LLM. The rewriter itself
// already slices to 8 (see llm-headlines.mjs); we ask for a couple extra
// here so the slice is meaningful even after dedupe.
const MEMBER_TITLES_CAP = 16;

let supabase;
try {
  supabase = createServiceClient();
} catch (err) {
  log("headline", `fatal: ${err.message}`);
  process.exit(1);
}

// Log a normalized shutdown line via the shared helper before the
// installShutdownHandler fires its own exit timer. Both listeners run
// because Node dispatches all registered handlers for a signal.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () =>
    log("headline", "headline-worker: shutting down gracefully")
  );
}
const shutdown = installShutdownHandler("headline-worker");

// ---------------------------------------------------------------------------
// 2. Helpers
// ---------------------------------------------------------------------------

/**
 * Pull the next batch of clusters that still need a neutral title.
 * Mirrors the partial index from migration 019:
 *   title_neutral_at IS NULL AND article_count >= 3
 *
 * Ordered by article_count DESC so the most-impactful clusters (the ones
 * users are most likely to see on the home feed) get rewritten first.
 *
 * @returns {Promise<Array<{ id: string, title_tr: string, summary_tr: string | null, article_count: number }>>}
 */
async function pickClusters() {
  const { data, error } = await supabase
    .from("clusters")
    .select("id, title_tr, summary_tr, article_count")
    .is("title_neutral_at", null)
    .gte("article_count", MIN_ARTICLE_COUNT)
    .order("article_count", { ascending: false })
    .limit(LLM_BATCH);
  if (error) {
    throw new Error(`pickClusters: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Fetch the member article titles for a given cluster, in publication
 * order (newest first), capped at MEMBER_TITLES_CAP. We embed the join
 * cluster_articles → articles in a single PostgREST request.
 *
 * Returns an empty array on error so the caller can decide whether to
 * skip the cluster (we treat "no titles" as a soft skip — the LLM has
 * nothing to summarize).
 *
 * @param {string} clusterId
 * @returns {Promise<string[]>}
 */
async function fetchMemberTitles(clusterId) {
  const { data, error } = await supabase
    .from("cluster_articles")
    .select("articles ( title, published_at )")
    .eq("cluster_id", clusterId)
    .limit(MEMBER_TITLES_CAP);
  if (error) {
    log("headline", `fetchMemberTitles(${clusterId}): ${error.message}`);
    return [];
  }
  const rows = data ?? [];
  // Each row's `articles` is a single embedded object (many-to-one FK).
  // Drop nulls + missing titles, then sort newest-first so the LLM sees
  // the freshest framings of the story.
  const items = [];
  for (const r of rows) {
    const a = r.articles;
    if (!a || !a.title) continue;
    items.push({ title: a.title, published_at: a.published_at });
  }
  items.sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
    return tb - ta;
  });
  return items.map((i) => i.title);
}

/**
 * Persist the rewritten title back to the cluster row. Sets both
 * `title_tr_neutral` and `title_neutral_at = now()` in a single update.
 * The original `title_tr` is NOT touched — the page consumers coalesce
 * neutral over original at read time.
 *
 * @param {string} clusterId
 * @param {string} neutralTitle
 */
async function writeNeutralTitle(clusterId, neutralTitle) {
  const { error } = await supabase
    .from("clusters")
    .update({
      title_tr_neutral: neutralTitle,
      title_neutral_at: new Date().toISOString(),
    })
    .eq("id", clusterId);
  if (error) {
    throw new Error(`writeNeutralTitle(${clusterId}): ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// 3. One cycle
// ---------------------------------------------------------------------------

/**
 * Run a single rewrite cycle. Returns the number of clusters that
 * received a fresh neutral title (used by the main loop to pick the
 * next sleep interval).
 *
 * @returns {Promise<number>}
 */
async function runCycle() {
  const startedAt = Date.now();
  logCycle("headline-cycle", "start");

  let clusters;
  try {
    clusters = await pickClusters();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("headline", `pickClusters threw: ${msg}`);
    logCycle(
      "headline-cycle",
      `end: 0 rewrote / 0 skipped / 1 errored in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (pick error)`
    );
    return 0;
  }

  if (clusters.length === 0) {
    logCycle(
      "headline-cycle",
      `end: 0 rewrote / 0 skipped / 0 errored in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (no candidates)`
    );
    return 0;
  }

  log(
    "headline",
    `picked ${clusters.length} cluster(s) needing neutral rewrite`
  );

  let rewrote = 0;
  let skipped = 0;
  let errored = 0;

  // Sequential, not concurrent. The Anthropic API is happy with bursts
  // but cost-conscious mode says: do them one at a time so a transient
  // 5xx doesn't blow the whole batch and so we can bail mid-batch on
  // shutdown without leaving in-flight requests dangling.
  for (const c of clusters) {
    if (shutdown.isShuttingDown()) break;

    let titles;
    try {
      titles = await fetchMemberTitles(c.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("headline", `cluster ${c.id} fetchMemberTitles threw: ${msg}`);
      errored++;
      continue;
    }

    if (titles.length === 0) {
      log("headline", `cluster ${c.id} skipped (no member titles)`);
      skipped++;
      continue;
    }

    let neutral;
    try {
      neutral = await rewriteClusterHeadline({
        title_tr: c.title_tr,
        summary_tr: c.summary_tr ?? undefined,
        member_titles: titles,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("headline", `cluster ${c.id} rewrite failed: ${msg}`);
      errored++;
      continue;
    }

    if (!neutral || neutral.length === 0) {
      log("headline", `cluster ${c.id} rewrite returned empty`);
      errored++;
      continue;
    }

    if (DRY_RUN) {
      log(
        "headline",
        `[DRY_RUN] cluster ${c.id}: "${(c.title_tr || "").slice(0, 60)}" → "${neutral.slice(0, 60)}" (not persisted)`
      );
      rewrote++;
      continue;
    }

    try {
      await writeNeutralTitle(c.id, neutral);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("headline", `cluster ${c.id} write failed: ${msg}`);
      errored++;
      continue;
    }

    log(
      "headline",
      `cluster ${c.id} rewritten: "${neutral.slice(0, 80)}"`
    );
    rewrote++;
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  logCycle(
    "headline-cycle",
    `end: ${rewrote} rewrote / ${skipped} skipped / ${errored} errored in ${elapsed.toFixed(1)}s`
  );

  return rewrote;
}

// ---------------------------------------------------------------------------
// 4. Main loop
// ---------------------------------------------------------------------------

/**
 * Pick the next sleep interval based on whether the last cycle was
 * productive. Productive cycles (≥1 rewrite) sleep CYCLE_SLEEP_PRODUCTIVE_MS;
 * idle cycles (0 rewrites) sleep CYCLE_SLEEP_IDLE_MS so we don't hammer
 * the DB when the queue is drained.
 */
function pickSleepMs(rewroteCount) {
  return rewroteCount > 0 ? CYCLE_SLEEP_PRODUCTIVE_MS : CYCLE_SLEEP_IDLE_MS;
}

async function main() {
  log(
    "headline",
    `headline-worker starting (DRY_RUN=${DRY_RUN ? "1" : "0"}, batch=${LLM_BATCH}, productive_sleep=${CYCLE_SLEEP_PRODUCTIVE_MS / 1000}s, idle_sleep=${CYCLE_SLEEP_IDLE_MS / 1000}s)`
  );

  // DRY_RUN: one cycle and exit. If the API key is missing we log the
  // warning and exit 0 — DRY_RUN is a smoke test, not a long-poll.
  if (DRY_RUN) {
    if (!process.env.ANTHROPIC_API_KEY) {
      log(
        "headline",
        "WARN: ANTHROPIC_API_KEY not set — DRY_RUN cannot call the rewriter; exiting"
      );
      process.exit(0);
    }
    try {
      await runCycle();
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      console.error(`${ts()} [headline-worker] cycle threw: ${msg}`);
    }
    log("headline", "DRY_RUN complete — exiting");
    process.exit(0);
  }

  while (!shutdown.isShuttingDown()) {
    // API-key gate. We re-check on every iteration so an operator can
    // drop a key into .env.local and SIGHUP/restart the worker without
    // having to know whether it had previously errored out.
    if (!process.env.ANTHROPIC_API_KEY) {
      log(
        "headline",
        `WARN: ANTHROPIC_API_KEY not set — sleeping ${NO_KEY_SLEEP_MS / 1000}s before re-check`
      );
      await sleep(NO_KEY_SLEEP_MS);
      // Re-load .env.local in case the operator added a key while we
      // were asleep. loadDotEnvLocal() never overwrites already-set
      // env vars, so this is a safe no-op when nothing changed.
      loadDotEnvLocal();
      continue;
    }

    let rewrote = 0;
    try {
      rewrote = (await runCycle()) ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      console.error(`${ts()} [headline-worker] cycle threw: ${msg}`);
      log("headline", `cycle ERROR ${msg.slice(0, 120)}`);
    }

    if (shutdown.isShuttingDown()) break;
    const sleepMs = pickSleepMs(rewrote);
    log(
      "headline",
      `cycle complete → sleeping ${sleepMs / 1000}s (rewrote=${rewrote})`
    );
    await sleep(sleepMs);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`${ts()} [headline-worker] fatal: ${msg}`);
  process.exit(1);
});
