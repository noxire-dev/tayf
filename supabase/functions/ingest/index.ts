// supabase/functions/ingest/index.ts
//
// Tayf RSS ingest Edge Function. Replaces the long-running `scripts/rss-worker.mjs`
// tmux pattern with a per-cycle invocation pokeable from Vercel cron
// (`/api/cron/ingest`) on a 3-minute schedule. Per cycle this function:
//
//   1. Pulls every active row from `sources`.
//   2. Fans out concurrent fetches (pool of 16) using `fetchFeed`.
//      Each fetch is charset-aware (HTTP header → XML prolog → UTF-8 default),
//      honours conditional GET (ETag + Last-Modified) within a single
//      Edge Function instance, and aborts on a 10 s timeout.
//   3. Normalises each item via `normalizeItem`, which produces the canonical
//      sha1-of-shingles `content_hash` (audit T7 P1-21 fix).
//   4. Upserts every produced row in batches of 500 with
//      `on_conflict=url&ignore_duplicates=true`. The `AFTER INSERT ON articles`
//      trigger (migration 025) takes over from here to enqueue `cluster_work`
//      and `image_backfill` messages.
//
// Wall-clock budget: 60 s (the Edge Functions hard ceiling is 400 s). We
// stay well under because the 16-way pool keeps the slowest tail fetch
// from blocking the cycle. On per-source failure we just log and move on;
// transient outlet outages must not poison the cycle.

import { fetchFeed } from "../_shared/rss/fetcher.ts";
import type { RssSource } from "../_shared/rss/fetcher.ts";
import type { NormalizedArticle } from "../_shared/rss/normalize.ts";
import { normalizeArticles } from "../_shared/rss/normalize.ts";
import { requireServiceRoleBearer } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_CONCURRENCY = 16;
const UPSERT_BATCH = 500;
// Wall-clock safety. Edge Functions allow ≤400 s; we cap well below so a
// pathological tail can't push us past the slot. The Vercel cron retries
// every 3 min so partial progress is harmless.
const CYCLE_DEADLINE_MS = 60_000;

// ---------------------------------------------------------------------------
// In-instance caches
// ---------------------------------------------------------------------------
//
// Edge Function instances pool requests for a few minutes between cold
// starts, so a `Map` declared at module scope survives across invocations.
// We use that to keep ETag / Last-Modified validators warm — the second
// poll against a healthy outlet should land on `304 Not Modified` and
// skip XML parsing entirely.
const conditionalCache = new Map<
  string,
  { etag?: string; lastModified?: string }
>();

// ---------------------------------------------------------------------------
// Concurrency-bounded pool
// ---------------------------------------------------------------------------

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  deadline?: number,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);
  const runners: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    runners.push(
      (async () => {
        while (true) {
          if (deadline && Date.now() > deadline) return;
          const i = cursor++;
          if (i >= items.length) return;
          try {
            await worker(items[i] as T, i);
          } catch {
            // Worker is expected to absorb its own errors; this is the
            // safety net so one pathological row cannot kill the pool.
          }
        }
      })(),
    );
  }
  await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

interface CycleStats {
  sources: number;
  fetched: number;
  failed: number;
  notModified: number;
  itemsNormalized: number;
  inserted: number;
  durationMs: number;
}

async function runCycle(): Promise<CycleStats> {
  const startedAt = Date.now();
  const deadline = startedAt + CYCLE_DEADLINE_MS;
  const supabase = createServiceClient();

  const stats: CycleStats = {
    sources: 0,
    fetched: 0,
    failed: 0,
    notModified: 0,
    itemsNormalized: 0,
    inserted: 0,
    durationMs: 0,
  };

  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("id, name, slug, url, rss_url")
    .eq("active", true)
    .order("slug");

  if (sourcesError) {
    stats.durationMs = Date.now() - startedAt;
    throw new Error(`fetch sources failed: ${sourcesError.message}`);
  }
  const liveSources = (sources ?? []) as RssSource[];
  stats.sources = liveSources.length;
  if (liveSources.length === 0) {
    stats.durationMs = Date.now() - startedAt;
    return stats;
  }

  const allRows: NormalizedArticle[] = [];
  // Per-source intra-cycle de-dup so two section-slug variants of the same
  // article inside one feed collapse before the upsert. Keyed by
  // `${source_id}\x1f${content_hash}`.
  const seenIntraCycle = new Set<string>();

  await runPool(
    liveSources,
    FETCH_CONCURRENCY,
    async (source) => {
      const result = await fetchFeed(source, {
        conditionalCache,
        timeoutMs: FETCH_TIMEOUT_MS,
      });

      if (result.error) {
        stats.failed++;
        console.error(`[ingest] ${source.slug} fetch failed: ${result.error}`);
        return;
      }
      if (result.notModified) {
        stats.notModified++;
        return;
      }

      stats.fetched++;
      const normalized = normalizeArticles(source, result.items);
      stats.itemsNormalized += normalized.length;

      for (const row of normalized) {
        const key = `${row.source_id}\x1f${row.content_hash}`;
        if (seenIntraCycle.has(key)) continue;
        seenIntraCycle.add(key);
        allRows.push(row);
      }
    },
    deadline,
  );

  // Single batched upsert at cycle end. `ignoreDuplicates: true` against the
  // `url` UNIQUE constraint preserves the legacy "first insert wins" semantic
  // while the `(source_id, content_hash)` UNIQUE constraint (migration 013)
  // is the backstop for any seen-set miss. The AFTER INSERT trigger from
  // migration 025 fans queue work for every truly inserted row.
  if (allRows.length > 0 && Date.now() <= deadline) {
    for (let i = 0; i < allRows.length; i += UPSERT_BATCH) {
      if (Date.now() > deadline) break;
      const chunk = allRows.slice(i, i + UPSERT_BATCH);
      const { data: upserted, error: upsertError } = await supabase
        .from("articles")
        .upsert(chunk, { onConflict: "url", ignoreDuplicates: true })
        .select("id");
      if (upsertError) {
        console.error(
          `[ingest] batched upsert (chunk ${i}-${i + chunk.length}) failed: ${upsertError.message}`,
        );
        // Per-row fallback so one bad row can't poison the rest of the chunk.
        for (const row of chunk) {
          if (Date.now() > deadline) break;
          const { data: one, error: oneErr } = await supabase
            .from("articles")
            .upsert([row], { onConflict: "url", ignoreDuplicates: true })
            .select("id");
          if (oneErr) continue;
          stats.inserted += one?.length ?? 0;
        }
      } else {
        stats.inserted += upserted?.length ?? 0;
      }
    }
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // Only the Vercel cron endpoint (or `supabase functions invoke`) should
  // reach this — Supabase Edge Functions sit behind a service-role bearer
  // gate by default, so an explicit allowlist here is a defence-in-depth
  // step rather than the primary access control.
  const denied = requireServiceRoleBearer(req);
  if (denied) return denied;

  // GET is a cheap liveness probe (no feed fetches, no DB writes). The
  // Vercel cron poke and operator-driven runs both come in as POST.
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, ready: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  try {
    const stats = await runCycle();
    return new Response(JSON.stringify({ ok: true, ...stats }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const request_id = crypto.randomUUID();
    // Log the full error (stack + message) to Edge Function logs only.
    console.error(`[ingest] ${request_id}`, err);
    return new Response(
      JSON.stringify({ ok: false, error: "internal-error", request_id }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});
