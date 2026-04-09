#!/usr/bin/env node
// scripts/image-worker.mjs
//
// Continuous og:image backfill worker for Tayf.
//
// About 23.5% of ingested articles land in Supabase with image_url = NULL
// because the RSS item didn't include any media field. The existing Next.js
// cron route at /api/cron/backfill-images fetches og:image for the 30 oldest
// image-less rows per invocation — fine for the admin button, but too slow
// to keep up with a continuously ingesting politics feed. This worker does
// the same thing continuously in the background. As of the I4-WORKER
// backlog-drain pass it processes ALL categories (home is still
// politics-only, but the cluster detail page and /sources directory want
// hero images for every story), and hands the three known-hard sources
// (haberler-com, anadolu-ajansi, trt-haber) to I2's fetchHeroImage
// site-specific extractors when they're available.
//
// Architecture parity:
//   - Follows the ESM / shared-helper pattern of scripts/rss-worker.mjs and
//     scripts/cluster-worker.mjs.
//   - Bounded concurrency pool of IMG_CONCURRENCY (default 5).
//   - Per-request 5s timeout via fetchOgImage (shared helper). Dropped from
//     8s in W4-Q10: og:image lives in <head>, so if a site hasn't returned
//     5s of HTML it's not going to give us og:image anyway.
//   - Adaptive sleep: 30s if a cycle did work, 120s if nothing to do.
//   - Dead-host circuit breaker: 3 consecutive failures per hostname →
//     skip that host for 30 minutes. Mirrors the rss-worker dead-feed
//     breaker, keyed by hostname instead of source slug.
//   - SKIP_SOURCES blocklist: img-1's source-level audit
//     (team/logs/image-audit.md, section 3b) confirmed haberler-com,
//     anadolu-ajansi, trt-haber, sol-haber, aa.com.tr, cnn-turk all sit at
//     0% og:image presence. We resolve their source_ids once at startup
//     and exclude them from every candidate query — that alone removes
//     the dominant time-waster from each cycle.
//   - Attempted-timestamp rotation: each candidate is ordered by
//     image_backfill_attempted_at NULLS FIRST and bumped after every
//     attempt (success or not). Stops the worker re-picking the same
//     head-of-queue rows on every cycle and lets it drain the tail of the
//     null backlog. Backed by migration 015_image_attempted_at.sql.
//     Every 10 cycles (RESET_STALE_CYCLE_INTERVAL) we bulk-clear
//     attempted_at for rows last tried > 24h ago, so that transient CDN
//     outages don't permanently wedge rows into the back of the rotation.
//   - DRY_RUN=1 → one cycle then exit.
//   - SIGINT/SIGTERM → graceful shutdown via installShutdownHandler.
//
// Important: does NOT modify src/lib/rss/og-image.ts or scripts/rss-worker.mjs.
// Those are owned by the cron route and another agent respectively.
//
// Usage:
//   node scripts/image-worker.mjs              # run forever
//   DRY_RUN=1 node scripts/image-worker.mjs    # one cycle, exit

import {
  loadDotEnvLocal,
  log,
  logCycle,
  ts,
  installShutdownHandler,
  twoTierSleep,
  sleep,
} from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";
import { fetchOgImage, isValidImageUrl } from "./lib/shared/og-image.mjs";
// Namespace import used to probe for I2's optional `fetchHeroImage` export
// without crashing at module-load time if it isn't present yet. I2 owns
// og-image.mjs; we don't touch it, we just feature-detect what it ships.
import * as ogImageModule from "./lib/shared/og-image.mjs";
const fetchHeroImage =
  typeof ogImageModule.fetchHeroImage === "function"
    ? ogImageModule.fetchHeroImage
    : null;
// Slugs I2 is known to have site-specific extractors for (per spec). We only
// prefer fetchHeroImage for these three hard cases; everything else stays on
// the generic fetchOgImage path so we don't regress sources that already work.
const HERO_IMAGE_SLUGS = new Set(["haberler-com", "anadolu-ajansi", "trt-haber"]);
import { createCircuitBreaker } from "./lib/shared/circuit-breaker.mjs";
import { runPool } from "./lib/shared/pool.mjs";

// ---------------------------------------------------------------------------
// 1. Env + config
// ---------------------------------------------------------------------------

loadDotEnvLocal();

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

// Adaptive sleep: 30s after a productive cycle, 120s when there was nothing
// to do. We're not latency-sensitive — og:image backfill is a catch-up job.
const CYCLE_SLEEP_WORK_MS = 30_000;
const CYCLE_SLEEP_IDLE_MS = 120_000;

// Bumped 50 → 100 in I4-WORKER backlog-drain tuning. Q10's politics filter
// kept each cycle cheap enough that 50 was the right ceiling; now that we
// process every category (see runCycle) we still have headroom and a
// larger batch drains the tail faster without hurting cycle latency.
const BATCH_LIMIT = 100;

// Reset cycle for stale image_backfill_attempted_at rows. CDNs go down and
// come back; running the bulk reset every 10 cycles amortises the DB write
// cost while still giving dead hosts a chance to be retried.
const RESET_STALE_CYCLE_INTERVAL = 10;
const RESET_STALE_AGE_MS = 24 * 3600 * 1000;

// Per-row attempt cap (A7-IMGLOOP). After this many consecutive failed
// fetches, the worker pushes image_backfill_attempted_at IMG_BACKFILL_PARK_MS
// into the future so the row exits the active candidate pool until it
// ages back in. Without this, ~70 rows from sources whose slug isn't on
// the SKIP_SOURCES blocklist (al-ain-turkce, birgun, etc.) cycle forever
// because every attempt sets attempted_at = now() and the 24h stale reset
// re-NULLs them faster than they can graduate. Backed by migration
// 022_image_backfill_attempts.sql.
const IMG_BACKFILL_MAX_ATTEMPTS = 5;
const IMG_BACKFILL_PARK_MS = 7 * 24 * 3600 * 1000; // 7 days

// Sources that img-1's source-level audit (team/logs/image-audit.md §3b)
// confirmed have zero og:image presence in their HTML. Scraping them is a
// pure waste of network budget — they dominated the baseline cycles where
// the worker fetched 50 pages and found 0 og:images. Slugs MUST match the
// values in the `sources.slug` column. (`aa.com.tr` is included as a slug
// alias because the spec called it out, even though img-1 audited it as
// `anadolu-ajansi`; sources whose slug is unknown to the DB are silently
// ignored at startup.)
const SKIP_SOURCES = [
  "haberler-com",
  "anadolu-ajansi",
  "trt-haber",
  "sol-haber",
  "aa.com.tr",
  "cnn-turk",
];

const IMG_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.IMG_CONCURRENCY || "5", 10) || 5
);

// Per-request HTTP timeout for fetchOgImage. Dropped from 8s to 5s in
// W4-Q10: og:image is in <head>, so if a site hasn't shipped 5s of HTML
// it's not going to give us a useful answer.
const REQUEST_TIMEOUT_MS = 5000;

// Dead-host circuit breaker — backed by the shared createCircuitBreaker
// helper, keyed by hostname because a single bad upstream shouldn't take
// the whole cycle down. rss-worker uses the same module keyed by source slug.
const DEAD_FAIL_THRESHOLD = 3;
const DEAD_SKIP_MS = 30 * 60 * 1000; // 30 minutes
const hostBreaker = createCircuitBreaker({
  failureThreshold: DEAD_FAIL_THRESHOLD,
  cooldownMs: DEAD_SKIP_MS,
});

let supabase;
try {
  supabase = createServiceClient();
} catch (err) {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
}

const shutdown = installShutdownHandler("image-worker");

// Source-id blocklist resolved once at startup from SKIP_SOURCES. We can't
// JOIN sources inside a PostgREST `.select(...).is(...)` chain, so we look
// the IDs up once and pass them to a `.not('source_id', 'in', ...)` filter
// on every cycle. Slugs that aren't present in `sources` are silently
// dropped — the worker just operates on whatever subset matched.
let skipSourceIds = [];

// source_id → slug map, loaded once at startup. Used to pick the
// hero-image extractor per row (HERO_IMAGE_SLUGS). Populated by
// loadSourceSlugMap().
/** @type {Map<string, string>} */
const sourceSlugMap = new Map();

// Monotonic cycle counter; used to run the stale-attempted-at reset every
// RESET_STALE_CYCLE_INTERVAL cycles instead of every cycle.
let cycleCount = 0;

async function loadSkipSourceIds() {
  const { data, error } = await supabase
    .from("sources")
    .select("id, slug")
    .in("slug", SKIP_SOURCES);
  if (error) {
    log(
      "image-worker",
      `WARN: failed to resolve SKIP_SOURCES (${error.message}) — proceeding without source blocklist`
    );
    return [];
  }
  const matched = (data || []).map((row) => row.id);
  const matchedSlugs = (data || []).map((row) => row.slug).sort();
  const missing = SKIP_SOURCES.filter((s) => !matchedSlugs.includes(s));
  log(
    "image-worker",
    `SKIP_SOURCES resolved: ${matched.length}/${SKIP_SOURCES.length} matched (${matchedSlugs.join(",") || "<none>"})${missing.length ? ` — unknown slugs ignored: ${missing.join(",")}` : ""}`
  );
  return matched;
}

/**
 * Populate the module-scoped sourceSlugMap once at startup so processArticle
 * can cheaply map row.source_id → slug when deciding whether to use
 * fetchHeroImage (which takes a slug for its site-specific extractors).
 * Failures are logged and swallowed — an empty map just means every row
 * falls back to the generic fetchOgImage path, which is the pre-change
 * behaviour anyway.
 */
async function loadSourceSlugMap() {
  const { data, error } = await supabase
    .from("sources")
    .select("id, slug");
  if (error) {
    log(
      "image-worker",
      `WARN: failed to load source slug map (${error.message}) — hero-image slug routing disabled`
    );
    return;
  }
  sourceSlugMap.clear();
  for (const row of data || []) {
    if (row?.id && row?.slug) sourceSlugMap.set(row.id, row.slug);
  }
  log(
    "image-worker",
    `source slug map loaded: ${sourceSlugMap.size} sources (hero-image-slugs=${[...HERO_IMAGE_SLUGS].join(",")})`
  );
}

/**
 * Clear image_backfill_attempted_at for rows whose last attempt is older
 * than RESET_STALE_AGE_MS. CDNs go down and come back; a 24h cooldown gives
 * dead hosts a chance to recover. Called every RESET_STALE_CYCLE_INTERVAL
 * cycles from runCycle(), not every cycle, to keep DB write pressure bounded.
 */
async function resetStaleAttemptedAt() {
  const cutoffIso = new Date(Date.now() - RESET_STALE_AGE_MS).toISOString();
  const { error: resetErr } = await supabase
    .from("articles")
    .update({ image_backfill_attempted_at: null })
    .is("image_url", null)
    .lt("image_backfill_attempted_at", cutoffIso);
  if (resetErr) {
    log("image-worker", `reset failed: ${resetErr.message}`);
  } else {
    log("image-worker", `reset stale image_backfill_attempted_at (cutoff=${cutoffIso})`);
  }
}

// ---------------------------------------------------------------------------
// 2. Helpers
// ---------------------------------------------------------------------------

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function recordHostFailure(host) {
  if (!host) return;
  const { tripped } = hostBreaker.recordFailure(host);
  if (tripped) {
    log(
      "image-worker",
      `[${host}] reached ${DEAD_FAIL_THRESHOLD} consecutive failures — circuit open for ${DEAD_SKIP_MS / 60000} min`
    );
  }
}

function recordHostSuccess(host) {
  hostBreaker.recordSuccess(host);
}

// ---------------------------------------------------------------------------
// 3. Per-article worker: fetch + validate + update
// ---------------------------------------------------------------------------

/**
 * Bump `image_backfill_attempted_at` for the given article and increment
 * the per-row attempt counter. Called after every failed attempt
 * (not-found, errored) so the rotation index pushes already-tried rows
 * to the back of the queue AND escalates serial failers out of the pool.
 *
 * Once `image_backfill_attempts` reaches IMG_BACKFILL_MAX_ATTEMPTS, the
 * row's attempted_at is pushed IMG_BACKFILL_PARK_MS into the future so
 * the worker stops re-picking it. Only the 24h stale-reset can pull it
 * back, and only after that future timestamp has actually passed (the
 * stale-reset filters by `lt(now-24h)` so future timestamps are safe).
 *
 * @param {{id: string, image_backfill_attempts?: number | null}} article
 */
async function markAttempted(article) {
  const prevAttempts = Number.isFinite(article.image_backfill_attempts)
    ? article.image_backfill_attempts
    : 0;
  const nextAttempts = prevAttempts + 1;
  const shouldPark = nextAttempts >= IMG_BACKFILL_MAX_ATTEMPTS;
  const attemptedAtIso = shouldPark
    ? new Date(Date.now() + IMG_BACKFILL_PARK_MS).toISOString()
    : new Date().toISOString();
  const { error } = await supabase
    .from("articles")
    .update({
      image_backfill_attempted_at: attemptedAtIso,
      image_backfill_attempts: nextAttempts,
    })
    .eq("id", article.id);
  if (error) {
    console.error(
      `${ts()} [image-worker] markAttempted failed for ${article.id}: ${error.message}`
    );
    return;
  }
  if (shouldPark) {
    log(
      "image-worker",
      `parked ${article.id} after ${nextAttempts} failed attempts (cooldown ${IMG_BACKFILL_PARK_MS / 86400000}d)`
    );
  }
}

/**
 * Process one article: try to fetch og:image, update the row if we find a
 * valid one. Returns the outcome so the cycle can tally summary stats.
 * Always bumps `image_backfill_attempted_at` (unless the host circuit
 * breaker is open) so the rotation order in the next cycle's query
 * advances even when nothing is found.
 *
 * When I2's `fetchHeroImage` helper is available AND the row's source slug
 * is one of HERO_IMAGE_SLUGS, we prefer that site-specific extractor over
 * the generic `fetchOgImage`. Everything else stays on the og:image path
 * so we don't regress sources that already work.
 *
 * @param {{ id: string, url: string, source_id?: string, image_backfill_attempts?: number | null }} article
 * @returns {Promise<"found" | "not-found" | "errored" | "skipped-dead-host">}
 */
async function processArticle(article) {
  const host = hostnameOf(article.url) || "unknown";

  if (!hostBreaker.allow(host)) {
    // Don't bump attempted_at — the row didn't actually get a network try.
    // Once the breaker cools down it'll be retried, and the rotation order
    // will still treat it as "older" because attempted_at hasn't moved.
    console.log(`${ts()} [${host}] skipped (circuit open)`);
    return "skipped-dead-host";
  }

  // Route the fetch: prefer I2's site-specific hero-image extractor for the
  // hard sources (haberler-com, anadolu-ajansi, trt-haber) when it's been
  // exported. If I2 hasn't shipped fetchHeroImage yet (startup feature
  // detection), `fetchHeroImage` is null and we fall through to fetchOgImage.
  const slug =
    article.source_id && sourceSlugMap.has(article.source_id)
      ? sourceSlugMap.get(article.source_id)
      : null;
  const useHero =
    fetchHeroImage && slug && HERO_IMAGE_SLUGS.has(slug);

  let ogImage;
  try {
    if (useHero) {
      ogImage = await fetchHeroImage(article.url, slug);
    } else {
      ogImage = await fetchOgImage(article.url, {
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    }
  } catch (err) {
    // fetchOgImage is contracted to never throw, but belt-and-suspenders:
    // treat an unexpected throw as an error and bump the breaker.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${ts()} [${host}] fetch threw: ${msg}`);
    recordHostFailure(host);
    await markAttempted(article);
    return "errored";
  }

  if (!ogImage) {
    // Distinguish "site responded but had no og:image" from "network died".
    // fetchOgImage collapses both into null, so we optimistically treat
    // null as a clean not-found and do NOT trip the breaker — otherwise a
    // site that simply doesn't publish og:image tags would get blackholed.
    console.log(`${ts()} [${host}] no og:image`);
    await markAttempted(article);
    return "not-found";
  }

  if (!isValidImageUrl(ogImage)) {
    console.log(`${ts()} [${host}] rejected og:image (invalid): ${ogImage.slice(0, 80)}`);
    await markAttempted(article);
    return "not-found";
  }

  // Successful fetch that returned a real image → reset the breaker.
  recordHostSuccess(host);

  if (DRY_RUN) {
    // DRY_RUN still writes — the spec's verification step expects the null
    // count to drop after a dry run. "Dry" here means "one cycle", not
    // "read-only". This mirrors how rss-worker/cluster-worker interpret it.
  }

  // Single update sets image_url AND attempted_at AND resets attempts —
  // saves a round-trip vs calling markAttempted separately on the success
  // path. The row will leave the candidate pool because image_url is no
  // longer null, but we still reset image_backfill_attempts to 0 so any
  // future re-clear (e.g. moderation removing a broken image_url) starts
  // fresh instead of being immediately parked.
  const { error: updateError } = await supabase
    .from("articles")
    .update({
      image_url: ogImage,
      image_backfill_attempted_at: new Date().toISOString(),
      image_backfill_attempts: 0,
    })
    .eq("id", article.id);

  if (updateError) {
    console.error(
      `${ts()} [${host}] update failed for ${article.id}: ${updateError.message}`
    );
    return "errored";
  }

  console.log(`${ts()} [${host}] found og:image`);
  return "found";
}

// ---------------------------------------------------------------------------
// 4. One cycle
// ---------------------------------------------------------------------------

async function runCycle() {
  const startedAt = Date.now();
  cycleCount += 1;
  logCycle("image-cycle", "start");

  // Stale-attempt reset: clear image_backfill_attempted_at for any row last
  // tried more than RESET_STALE_AGE_MS (24h) ago. Runs every
  // RESET_STALE_CYCLE_INTERVAL cycles so the DB write doesn't fire on every
  // tick. This un-sticks the worker from rows whose CDN was briefly down.
  if (cycleCount % RESET_STALE_CYCLE_INTERVAL === 0) {
    try {
      await resetStaleAttemptedAt();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("image-worker", `reset threw: ${msg}`);
    }
  }

  // Build the candidate query:
  //   - image_url IS NULL                                 (the backfill target)
  //   - source_id NOT IN SKIP_SOURCES                     (proven hopeless, §3b)
  //   - ORDER BY image_backfill_attempted_at NULLS FIRST  (rotate the tail)
  //
  // Category filter REMOVED in I4-WORKER pass: used to be
  // `category IN (politika, son_dakika)` because the home feed was the only
  // surface that showed images. Now the cluster detail page for any story
  // and the /sources directory both want hero images, so every category is
  // worth a backfill attempt. SKIP_SOURCES still culls the proven-hopeless
  // hosts before they eat network budget.
  //
  // The NULLS FIRST sort means "rows that have never been tried" run before
  // "rows tried longest ago" — both are scored as "older" than rows tried
  // recently, so the worker drains the tail of the backlog instead of
  // looping on the same head every cycle.
  let query = supabase
    .from("articles")
    .select("id, url, source_id, image_backfill_attempts")
    .is("image_url", null);

  if (skipSourceIds.length > 0) {
    // PostgREST `not.in` takes a parenthesised, comma-joined list as a raw
    // string filter. supabase-js exposes it via `.not(column, 'in', value)`.
    query = query.not("source_id", "in", `(${skipSourceIds.join(",")})`);
  }

  // A7-IMGLOOP: exclude rows whose attempted_at is in the future. markAttempted
  // pushes attempted_at IMG_BACKFILL_PARK_MS into the future once a row hits
  // IMG_BACKFILL_MAX_ATTEMPTS, taking it out of the candidate pool until the
  // 7-day cooldown elapses. Without this filter, NULLS-FIRST ordering on the
  // attempted_at column will still surface parked rows whenever the rest of
  // the unparked pool is empty — which is exactly the wedge IMAGE-CYCLE was
  // burning 8.6 min/hr on. We use `or(is.null,lt.<nowIso>)` so unattempted
  // rows (NULL) and rows whose cooldown has expired both stay in scope.
  const nowIso = new Date().toISOString();
  query = query.or(
    `image_backfill_attempted_at.is.null,image_backfill_attempted_at.lt.${nowIso}`
  );

  const { data: articles, error } = await query
    .order("image_backfill_attempted_at", {
      ascending: true,
      nullsFirst: true,
    })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error(`${ts()} [image-worker] fetch failed: ${error.message}`);
    const elapsed = (Date.now() - startedAt) / 1000;
    logCycle(
      "image-cycle",
      `end: 0 found / 0 not-found / 0 errored in ${elapsed.toFixed(1)}s (query error)`
    );
    return 0;
  }

  if (!articles || articles.length === 0) {
    const elapsed = (Date.now() - startedAt) / 1000;
    logCycle(
      "image-cycle",
      `end: 0 found / 0 not-found / 0 errored in ${elapsed.toFixed(1)}s (no candidates)`
    );
    return 0;
  }

  console.log(
    `${ts()} [image-worker] picked ${articles.length} image-less articles (concurrency=${IMG_CONCURRENCY}, all-categories)`
  );

  let found = 0;
  let notFound = 0;
  let errored = 0;
  let skippedDeadHost = 0;

  // Bounded-concurrency pool — backed by the shared runPool helper. Each
  // worker invocation classifies its outcome into one of four buckets and
  // updates the closure-scoped counters; processArticle is already
  // internally try/catch-ed, but we keep an outer rejected-result branch
  // as a defensive guard since a logic bug must never abort the cycle.
  const results = await runPool(articles, {
    concurrency: IMG_CONCURRENCY,
    shouldStop: () => shutdown.isShuttingDown(),
    worker: (article) => processArticle(article),
  });
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      switch (r.value) {
        case "found":
          found++;
          break;
        case "not-found":
          notFound++;
          break;
        case "errored":
          errored++;
          break;
        case "skipped-dead-host":
          skippedDeadHost++;
          break;
      }
    } else {
      errored++;
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(
        `${ts()} [image-worker] processArticle threw for ${articles[i].id}: ${msg}`
      );
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  logCycle(
    "image-cycle",
    `end: ${found} found / ${notFound} not-found / ${errored} errored in ${elapsed.toFixed(1)}s` +
      (skippedDeadHost > 0 ? ` (skipped-dead-host=${skippedDeadHost})` : "")
  );
  log(
    "image-worker",
    `cycle → ${found} found / ${notFound} not-found / ${errored} errored (batch=${articles.length})`
  );

  return found + errored;
}

// ---------------------------------------------------------------------------
// 5. Main loop
// ---------------------------------------------------------------------------

// 2-tier sleep: 30s after a productive cycle, 120s when nothing to do.
// Backed by the shared twoTierSleep helper so the heuristic lives in one
// place across workers.
const pickSleepMs = twoTierSleep({
  work: CYCLE_SLEEP_WORK_MS,
  idle: CYCLE_SLEEP_IDLE_MS,
});

async function main() {
  log(
    "image-worker",
    `image-worker starting (DRY_RUN=${DRY_RUN ? "1" : "0"}, concurrency=${IMG_CONCURRENCY}, batch=${BATCH_LIMIT}, timeout=${REQUEST_TIMEOUT_MS}ms, categories=all, hero-image=${fetchHeroImage ? "enabled" : "unavailable"}, max-attempts=${IMG_BACKFILL_MAX_ATTEMPTS}, park=${IMG_BACKFILL_PARK_MS / 86400000}d)`
  );

  // Resolve the source-slug blocklist into IDs once. We re-resolve nothing
  // mid-loop — sources are added/removed rarely enough that a worker
  // restart is the right time to pick up new ones.
  skipSourceIds = await loadSkipSourceIds();

  // Load the source_id → slug map used by processArticle to route known-hard
  // sources to fetchHeroImage (when I2 has exported it). Same rationale for
  // one-shot loading: sources rarely change, restart picks up new ones.
  await loadSourceSlugMap();

  if (DRY_RUN) {
    try {
      await runCycle();
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      console.error(`${ts()} [image-worker] cycle threw: ${msg}`);
    }
    log("image-worker", "DRY_RUN complete — exiting");
    process.exit(0);
  }

  while (!shutdown.isShuttingDown()) {
    let work = 0;
    try {
      work = (await runCycle()) ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      console.error(`${ts()} [image-worker] cycle threw: ${msg}`);
      log("image-worker", `cycle ERROR ${msg.slice(0, 120)}`);
    }
    if (shutdown.isShuttingDown()) break;
    const sleepMs = pickSleepMs(work > 0);
    log(
      "image-worker",
      `cycle complete → sleeping ${sleepMs / 1000}s (work=${work})`
    );
    await sleep(sleepMs);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`${ts()} [image-worker] fatal: ${msg}`);
  process.exit(1);
});
