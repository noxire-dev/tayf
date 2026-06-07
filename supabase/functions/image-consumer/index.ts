// supabase/functions/image-consumer/index.ts
//
// Image-backfill consumer Edge Function. Drains messages from the
// `image_backfill` pgmq queue, fetches og:image / twitter:image for the
// referenced article URL through the SSRF-guarded fetcher, and updates
// `articles.image_url` on success.
//
// Triggered by a pg_cron schedule ("*/5 * * * *" per ADR-001). Each
// invocation drains a bounded batch, then returns. Module-scoped state
// (Supabase client, source-slug map) is reused across warm invocations.
//
// Lifecycle per message:
//   1. pgmq.read('image_backfill', vt=30, qty=BATCH_SIZE).
//   2. For each message:
//      a. If read_ct > MAX_READS → pgmq.delete (permanent failure path).
//      b. Load the article row; skip if missing or already imaged.
//      c. Pick the extractor (fetchHeroImage for the three audit-flagged
//         slugs, fetchOgImage otherwise).
//      d. On success: update articles.image_url + reset attempts, archive.
//      e. On not-found / errored: bump image_backfill_attempts +
//         attempted_at, archive. We do NOT requeue — the AFTER UPDATE
//         trigger and the safety-net resweep handle re-discovery.
//   3. Stops when the wall budget is exhausted or the queue is empty.

import { createServiceClient, type SupabaseClient } from "../_shared/supabase.ts";
import {
  archive as pgmqArchive,
  deleteMessage as pgmqDelete,
  readBatch as pgmqRead,
  type PgmqMessage,
} from "../_shared/pgmq.ts";
import {
  fetchHeroImage,
  fetchOgImage,
  isValidImageUrl,
} from "../_shared/og-image.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const QUEUE_NAME = "image_backfill";
// Per-message visibility timeout. Fetch + update + archive comfortably
// finishes inside 30s for healthy hosts; messages from a killed invocation
// become re-readable after 30s and the next pg_cron tick picks them up.
const VISIBILITY_TIMEOUT_S = 30;
// Batch size per pgmq.read call. 20 keeps each invocation cheap while
// keeping pace with the pg_cron interval (every 5 min).
const BATCH_SIZE = 20;
// Per-message permanent-failure cap. After this many reads pgmq.delete is
// called so the message stops bouncing.
const MAX_READS = 3;
// Per-row attempt cap. Mirrors scripts/image-worker.mjs / migration 022 so
// the queue path and the legacy worker agree on parking behaviour.
const IMG_BACKFILL_MAX_ATTEMPTS = 5;
const IMG_BACKFILL_PARK_MS = 7 * 24 * 3600 * 1000;
// Edge Functions hard limit is 400s, but we cap ourselves well under to
// leave headroom for the pg_cron wrapper + cold-start jitter.
const WALL_BUDGET_MS = 30_000;
// Per-fetch HTTP timeout — matches scripts/image-worker.mjs's tuned-down 5s.
const REQUEST_TIMEOUT_MS = 5000;
// Slugs that get the extended-window hero-image extractor (audit IMG1).
const HERO_IMAGE_SLUGS = new Set([
  "haberler-com",
  "trt-haber",
  "anadolu-ajansi",
]);

// ---------------------------------------------------------------------------
// Module-scoped state (survives across warm invocations on the same instance)
// ---------------------------------------------------------------------------

let supabase: SupabaseClient | null = null;
let supabaseInitError: string | null = null;
try {
  supabase = createServiceClient();
} catch (err) {
  supabaseInitError = err instanceof Error ? err.message : String(err);
  console.error(`[image-consumer] FATAL: ${supabaseInitError}`);
}

// Source id → slug map. Loaded lazily on the first invocation; cached
// across warm invocations because sources change rarely.
let sourceSlugMap: Map<string, string> | null = null;
let sourceSlugMapLoadedAt = 0;
const SOURCE_MAP_TTL_MS = 30 * 60 * 1000;

async function getSourceSlugMap(client: SupabaseClient): Promise<Map<string, string>> {
  const now = Date.now();
  if (sourceSlugMap && now - sourceSlugMapLoadedAt < SOURCE_MAP_TTL_MS) {
    return sourceSlugMap;
  }
  const { data, error } = await client.from("sources").select("id, slug");
  if (error) {
    console.error(`[image-consumer] source slug map load failed: ${error.message}`);
    return sourceSlugMap ?? new Map();
  }
  const next = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; slug: string }>) {
    if (row?.id && row?.slug) next.set(row.id, row.slug);
  }
  sourceSlugMap = next;
  sourceSlugMapLoadedAt = now;
  return next;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageJob {
  article_id?: string;
}

interface ArticleRow {
  id: string;
  url: string | null;
  source_id: string | null;
  image_url: string | null;
  image_backfill_attempts: number | null;
}

type Outcome =
  | "found"
  | "not-found"
  | "errored"
  | "skipped-no-url"
  | "skipped-already-imaged"
  | "skipped-missing"
  | "permanent-failure";

// ---------------------------------------------------------------------------
// Per-message worker
// ---------------------------------------------------------------------------

async function processMessage(
  client: SupabaseClient,
  msg: PgmqMessage<ImageJob>,
): Promise<Outcome> {
  const articleId = msg.message?.article_id;

  // Malformed enqueue payload → permanent. Delete so we don't keep reading.
  if (!articleId || typeof articleId !== "string") {
    console.warn(`[image-consumer] msg ${msg.msg_id} missing article_id — deleting`);
    await safeArchiveOrDelete(client, msg.msg_id, "delete");
    return "permanent-failure";
  }

  // > MAX_READS reads → permanent. Delete; the article row's
  // image_backfill_attempts carries the audit trail.
  if (msg.read_ct > MAX_READS) {
    console.warn(
      `[image-consumer] msg ${msg.msg_id} (article=${articleId}) exceeded ${MAX_READS} reads — deleting`,
    );
    await safeArchiveOrDelete(client, msg.msg_id, "delete");
    return "permanent-failure";
  }

  // Load the article. Service role bypasses RLS.
  const { data: article, error: loadErr } = await client
    .from("articles")
    .select("id, url, source_id, image_url, image_backfill_attempts")
    .eq("id", articleId)
    .maybeSingle<ArticleRow>();

  if (loadErr) {
    console.error(`[image-consumer] article ${articleId} load failed: ${loadErr.message}`);
    // Transient — leave the message visible for the next read.
    return "errored";
  }

  if (!article) {
    console.warn(
      `[image-consumer] article ${articleId} not found — archiving msg ${msg.msg_id}`,
    );
    await safeArchiveOrDelete(client, msg.msg_id, "archive");
    return "skipped-missing";
  }

  if (article.image_url) {
    // Already backfilled (race / re-enqueue); archive and move on.
    await safeArchiveOrDelete(client, msg.msg_id, "archive");
    return "skipped-already-imaged";
  }

  if (!article.url) {
    await safeArchiveOrDelete(client, msg.msg_id, "archive");
    return "skipped-no-url";
  }

  // Pick the extractor. HERO_IMAGE_SLUGS get the extended 200KB window;
  // everything else gets the stock 50KB head-only path.
  const sources = await getSourceSlugMap(client);
  const slug = article.source_id ? sources.get(article.source_id) ?? null : null;
  const useHero = slug !== null && HERO_IMAGE_SLUGS.has(slug);

  let ogImage: string | null = null;
  try {
    ogImage = useHero
      ? await fetchHeroImage(article.url, slug, { timeoutMs: REQUEST_TIMEOUT_MS })
      : await fetchOgImage(article.url, { timeoutMs: REQUEST_TIMEOUT_MS });
  } catch (err) {
    // fetchOgImage / fetchHeroImage are contracted not to throw; this is
    // defensive. Any throw collapses to errored.
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[image-consumer] fetcher threw for ${article.id}: ${m}`);
    await bumpAttempt(client, article);
    await safeArchiveOrDelete(client, msg.msg_id, "archive");
    return "errored";
  }

  if (!ogImage || !isValidImageUrl(ogImage)) {
    await bumpAttempt(client, article);
    await safeArchiveOrDelete(client, msg.msg_id, "archive");
    return "not-found";
  }

  // Successful fetch. Single update sets image_url, resets attempts, and
  // bumps attempted_at.
  const { error: updateErr } = await client
    .from("articles")
    .update({
      image_url: ogImage,
      image_backfill_attempted_at: new Date().toISOString(),
      image_backfill_attempts: 0,
    })
    .eq("id", article.id);

  if (updateErr) {
    console.error(`[image-consumer] update failed for ${article.id}: ${updateErr.message}`);
    // Leave the message visible so the next read retries.
    return "errored";
  }

  await safeArchiveOrDelete(client, msg.msg_id, "archive");
  return "found";
}

/**
 * Bump image_backfill_attempts and image_backfill_attempted_at after a
 * failed fetch. Once attempts >= IMG_BACKFILL_MAX_ATTEMPTS, park the row
 * IMG_BACKFILL_PARK_MS into the future so it leaves the active pool.
 */
async function bumpAttempt(
  client: SupabaseClient,
  article: ArticleRow,
): Promise<void> {
  const prev = Number.isFinite(article.image_backfill_attempts as number)
    ? (article.image_backfill_attempts as number)
    : 0;
  const next = prev + 1;
  const shouldPark = next >= IMG_BACKFILL_MAX_ATTEMPTS;
  const attemptedAtIso = shouldPark
    ? new Date(Date.now() + IMG_BACKFILL_PARK_MS).toISOString()
    : new Date().toISOString();
  const { error } = await client
    .from("articles")
    .update({
      image_backfill_attempted_at: attemptedAtIso,
      image_backfill_attempts: next,
    })
    .eq("id", article.id);
  if (error) {
    console.error(`[image-consumer] bumpAttempt failed for ${article.id}: ${error.message}`);
  }
}

/**
 * Wrap pgmq.archive / pgmq.delete so a transient RPC failure doesn't abort
 * the whole drain. The pgmq helpers throw on error; we log and move on.
 */
async function safeArchiveOrDelete(
  client: SupabaseClient,
  msgId: number,
  mode: "archive" | "delete",
): Promise<void> {
  try {
    if (mode === "archive") await pgmqArchive(client, QUEUE_NAME, msgId);
    else await pgmqDelete(client, QUEUE_NAME, msgId);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[image-consumer] pgmq ${mode}(${msgId}) failed: ${m}`);
  }
}

// ---------------------------------------------------------------------------
// Drain loop
// ---------------------------------------------------------------------------

interface DrainSummary {
  drained: number;
  found: number;
  notFound: number;
  errored: number;
  skipped: number;
  permanentFailures: number;
  elapsedMs: number;
}

async function drain(client: SupabaseClient): Promise<DrainSummary> {
  const startedAt = Date.now();
  let drained = 0;
  let found = 0;
  let notFound = 0;
  let errored = 0;
  let skipped = 0;
  let permanentFailures = 0;

  while (Date.now() - startedAt < WALL_BUDGET_MS) {
    let batch: PgmqMessage<ImageJob>[] = [];
    try {
      batch = await pgmqRead<ImageJob>(client, QUEUE_NAME, VISIBILITY_TIMEOUT_S, BATCH_SIZE);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`[image-consumer] pgmq.read failed: ${m}`);
      break;
    }
    if (batch.length === 0) break;

    // Serial within an invocation: predictable resource footprint, plays
    // nicely with the legacy worker which runs IMG_CONCURRENCY=5 in parallel.
    for (const msg of batch) {
      if (Date.now() - startedAt >= WALL_BUDGET_MS) break;
      let outcome: Outcome;
      try {
        outcome = await processMessage(client, msg);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error(`[image-consumer] processMessage threw for msg ${msg.msg_id}: ${m}`);
        outcome = "errored";
      }
      drained += 1;
      switch (outcome) {
        case "found":
          found += 1;
          break;
        case "not-found":
          notFound += 1;
          break;
        case "errored":
          errored += 1;
          break;
        case "permanent-failure":
          permanentFailures += 1;
          break;
        case "skipped-no-url":
        case "skipped-already-imaged":
        case "skipped-missing":
          skipped += 1;
          break;
      }
    }
  }

  return {
    drained,
    found,
    notFound,
    errored,
    skipped,
    permanentFailures,
    elapsedMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Deno.serve entrypoint
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // GET → cheap health probe (no DB hits).
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: supabase !== null,
        queue: QUEUE_NAME,
        configured: supabase !== null,
        ...(supabaseInitError ? { error: supabaseInitError } : {}),
      }),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: supabaseInitError ?? "supabase client unavailable" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const summary = await drain(supabase);
    console.log(
      `[image-consumer] drain → ${summary.found} found / ${summary.notFound} not-found / ${summary.errored} errored / ${summary.skipped} skipped / ${summary.permanentFailures} pf in ${summary.elapsedMs}ms (drained=${summary.drained})`,
    );
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const m = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[image-consumer] drain fatal: ${m}`);
    return new Response(
      JSON.stringify({ error: "drain failed", detail: m.slice(0, 200) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
