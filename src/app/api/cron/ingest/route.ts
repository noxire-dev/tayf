import { connection, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAllFeeds } from "@/lib/rss/fetcher";
import { normalizeArticles } from "@/lib/rss/normalize";
import { batchFetchOgImages } from "@/lib/rss/og-image";
import {
  apiError,
  apiUnauthorized,
  withApiErrors,
} from "@/lib/api/errors";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import type { Source } from "@/types";

export const maxDuration = 120;

// Manual / cron ingest is expensive (RSS + OG fetches against many upstreams),
// so cap at 5 burst then refill ~1/min. Vercel Cron and the admin "Çek"
// button each count as one client by IP — the tmux worker bypasses HTTP
// entirely and is unaffected.
const ingestLimit = createRateLimiter("cron-ingest", {
  capacity: 5,
  refillPerSecond: 1 / 60,
});

/**
 * Manual-trigger ingest endpoint (historically "cron/ingest").
 *
 * DUAL-PATH ARCHITECTURE
 * ----------------------
 * Tayf has two ingestion paths that share the same `articles` table:
 *
 *   1. PRIMARY — `scripts/rss-worker.mjs` runs continuously in a tmux pane
 *      on the dev/prod host, looping every 60 seconds. This is the normal
 *      path and is owned by the main team.
 *
 *   2. FALLBACK / MANUAL — this HTTP route. It is used by:
 *        - The admin panel "Çek" button (`runAction("ingest")` → `/api/admin`
 *          → this route) for one-off manual refreshes.
 *        - Vercel Cron (see `vercel.json`) as a fallback when the project
 *          is deployed to a host without background workers.
 *
 * Both paths upsert with `onConflict: "url"` so duplicate rows are impossible,
 * but running them concurrently wastes DNS, bandwidth, and Supabase quota.
 * To avoid that we do a 30-second recent-insert check below: if the tmux
 * worker inserted any article in the last 30 seconds it is still live, so
 * this manual invocation returns `{ skipped: true, reason: "worker active" }`
 * instead of re-ingesting.
 */
export const GET = withApiErrors(async (request: Request) => {
  // Next.js 16 with cacheComponents prerenders GET handlers at build time.
  // `await connection()` returns a hanging promise during prerender so
  // `request.headers` below is never touched until an actual request hits.
  // See https://nextjs.org/docs/messages/next-prerender-sync-request.
  await connection();
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return apiUnauthorized();
  }

  const rl = ingestLimit(clientKey(request));
  if (!rl.allowed) {
    return apiError(429, "Too many requests", {
      details: { retryAfterMs: rl.retryAfterMs },
    });
  }

  const supabase = createServerClient();

  // 0. Skip if the tmux RSS worker is already active. We detect this by
  // counting rows inserted in the last 30 seconds — the worker cycles every
  // 60s, so any recent insert means the worker is handling ingestion and
  // this manual trigger would just duplicate the fetch work.
  const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
  const { count: recentInserts, error: recentErr } = await supabase
    .from("articles")
    .select("*", { count: "exact", head: true })
    .gte("created_at", thirtySecondsAgo);

  // Only honor the skip on a successful count. On error, fall through and
  // run the ingest anyway — a broken guard shouldn't break the manual path.
  if (!recentErr && (recentInserts ?? 0) > 0) {
    return NextResponse.json({
      skipped: true,
      reason: "worker active",
      recent_inserts: recentInserts ?? 0,
      timestamp: new Date().toISOString(),
    });
  }

  // 1. Fetch active sources
  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("*")
    .eq("active", true);

  if (sourcesError || !sources?.length) {
    return apiError(500, "Failed to fetch sources", {
      details: sourcesError?.message
        ? { supabase: sourcesError.message }
        : undefined,
    });
  }

  // 2. Fetch all RSS feeds in parallel
  const feedResults = await fetchAllFeeds(sources as Source[]);

  // 3. Normalize all articles
  let totalInserted = 0;
  let totalOgFetched = 0;
  let totalErrors = 0;
  const sourceResults: Record<string, { inserted: number; ogImages?: number; error?: string }> = {};

  for (const result of feedResults) {
    if (result.error) {
      sourceResults[result.source.slug] = { inserted: 0, error: result.error };
      totalErrors++;
      continue;
    }

    const normalized = normalizeArticles(result.source, result.items);

    if (normalized.length === 0) {
      sourceResults[result.source.slug] = { inserted: 0 };
      continue;
    }

    // 4. Fetch og:image for articles missing images
    const ogImages = await batchFetchOgImages(normalized);
    let ogCount = 0;

    if (ogImages.size > 0) {
      for (const article of normalized) {
        if (!article.image_url && ogImages.has(article.url)) {
          article.image_url = ogImages.get(article.url)!;
          ogCount++;
        }
      }
    }

    totalOgFetched += ogCount;

    // 5. Upsert — skip duplicates via url unique constraint
    const { data, error: insertError } = await supabase
      .from("articles")
      .upsert(normalized, {
        onConflict: "url",
        ignoreDuplicates: true,
      })
      .select("id");

    const inserted = data?.length ?? 0;
    totalInserted += inserted;
    sourceResults[result.source.slug] = {
      inserted,
      ogImages: ogCount || undefined,
      error: insertError?.message,
    };

    if (insertError) totalErrors++;
  }

  return NextResponse.json({
    success: true,
    totalInserted,
    totalOgFetched,
    totalErrors,
    sources: sourceResults,
    timestamp: new Date().toISOString(),
  });
});
