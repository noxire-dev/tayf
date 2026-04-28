import { connection, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  apiError,
  apiUnauthorized,
  withApiErrors,
} from "@/lib/api/errors";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
// The factory is defined in scripts/cluster-worker.mjs alongside the
// long-running tmux entrypoint, so both code paths share the same algorithm.
// Path resolves: src/app/api/cron/cluster/route.ts → ../../../../../scripts/...
import { createClusterEngine } from "../../../../../scripts/cluster-worker.mjs";

// Pro tier ceiling. Clustering can take 30–60s on a backlog (500 articles +
// rolling-window context refresh + 48h cluster scoring); 300s gives plenty
// of headroom for ad-hoc catch-up runs after a host outage.
export const maxDuration = 300;

// Same rate-limiter shape as cron/ingest: 5-token bucket refilling 1/min.
// The cron only ticks every few minutes so it never hits the cap; the
// limiter is here to guard the admin "Kümele" button (when added) and
// the occasional manual curl from getting weaponised.
const clusterLimit = createRateLimiter("cron-cluster", {
  capacity: 5,
  refillPerSecond: 1 / 60,
});

/**
 * Manual-trigger cluster endpoint — the Vercel-hosted fallback for the
 * continuous tmux cluster-worker.
 *
 * DUAL-PATH ARCHITECTURE
 * ----------------------
 * Mirrors the pattern in `cron/ingest/route.ts`:
 *
 *   1. PRIMARY — `scripts/cluster-worker.mjs` runs continuously in tmux on
 *      the dev/prod host, looping every 15/30/60s depending on load. Owned
 *      by the main team.
 *
 *   2. FALLBACK — this HTTP route. Used by Vercel Cron (see `vercel.ts`)
 *      when the project is deployed without background workers, and by
 *      ad-hoc curl during ops.
 *
 * The route imports the worker's `createClusterEngine` factory, builds an
 * engine bound to a Next.js-side Supabase client, and runs ONE cycle.
 *
 * SKIP GUARD
 * ----------
 * `cluster_articles` has no `created_at` column, so we use `clusters.created_at`
 * as a soft "is anyone else clustering right now" signal — both workers
 * create new clusters on most cycles, so a 60-second window reliably detects
 * a busy peer. An idle host produces no clusters either, in which case the
 * guard waves us through and the cycle finishes as a no-op. Concurrent runs
 * are still safe — `cluster_articles` PK + the per-source dedupe guard in
 * `addArticleToCluster` prevent any duplicate (cluster, article) rows — but
 * skipping avoids wasted DB round-trips.
 */
export const GET = withApiErrors(async (request: Request) => {
  // Next.js 16 with cacheComponents prerenders GET handlers at build time.
  // `await connection()` returns a hanging promise during prerender so
  // `request.headers` below is never touched until an actual request hits.
  // See https://nextjs.org/docs/messages/next-prerender-sync-request.
  await connection();

  // Verify cron secret in production.
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return apiUnauthorized();
  }

  const rl = clusterLimit(clientKey(request));
  if (!rl.allowed) {
    return apiError(429, "Too many requests", {
      details: { retryAfterMs: rl.retryAfterMs },
    });
  }

  const supabase = createServerClient();

  // Skip-if-recent guard — see SKIP GUARD comment above.
  const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentClusters, error: recentErr } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true })
    .gte("created_at", sixtySecondsAgo);

  // Soft guard: only honour the skip on a successful count. A broken count
  // query shouldn't block manual catch-up runs.
  if (!recentErr && (recentClusters ?? 0) > 0) {
    return NextResponse.json({
      skipped: true,
      reason: "worker active",
      recent_clusters: recentClusters ?? 0,
      timestamp: new Date().toISOString(),
    });
  }

  const engine = createClusterEngine({
    supabase,
    isShuttingDown: () => false,
    debug: false,
  });

  // One cycle. The worker's adaptive 15/30/60s sleep doesn't apply here —
  // we run, return stats, exit. Vercel cron schedules the next tick.
  const stats = await engine.runOneCycle(1);

  return NextResponse.json({
    success: true,
    ...stats,
    timestamp: new Date().toISOString(),
  });
});
