import { connection, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchOgImage } from "@/lib/rss/og-image";
import {
  apiError,
  apiUnauthorized,
  withApiErrors,
} from "@/lib/api/errors";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

export const maxDuration = 120;

// Backfill is the slowest path (per-article HTML fetch). Same shape as the
// ingest limiter: 5 burst, ~1 token per minute thereafter.
const backfillLimit = createRateLimiter("cron-backfill-images", {
  capacity: 5,
  refillPerSecond: 1 / 60,
});

/**
 * Canonical og:image backfill endpoint.
 *
 * DUAL-PATH ARCHITECTURE NOTE
 * ---------------------------
 * Unlike `/api/cron/ingest`, this route has NO continuous worker equivalent.
 * The tmux RSS worker (`scripts/rss-worker.mjs`) intentionally does NOT
 * follow article URLs to extract og:image — that belongs to this path so
 * one slow upstream page cannot stall the 60-second ingest cycle.
 *
 * This endpoint is the single source of truth for og:image backfill and
 * is invoked by:
 *   - The admin panel "Kapak Resimleri" button
 *     (`runAction("backfill_images")` → `/api/admin` → this route).
 *   - Manual / ad-hoc curl runs during development.
 *
 * It pulls the 30 oldest image-less articles, fetches og:image with
 * bounded concurrency, and updates them in place. Run it repeatedly until
 * the `remaining` field says "all done".
 */
export const GET = withApiErrors(async (request: Request) => {
  // Next.js 16 with cacheComponents prerenders GET handlers at build time.
  // `await connection()` returns a hanging promise during prerender so
  // `request.headers` below is never touched until an actual request hits.
  // See https://nextjs.org/docs/messages/next-prerender-sync-request.
  await connection();
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return apiUnauthorized();
  }

  const rl = backfillLimit(clientKey(request));
  if (!rl.allowed) {
    return apiError(429, "Too many requests", {
      details: { retryAfterMs: rl.retryAfterMs },
    });
  }

  const supabase = createServerClient();

  // Fetch articles with no image, newest first
  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, url")
    .is("image_url", null)
    .order("published_at", { ascending: false })
    .limit(30);

  if (error) {
    return apiError(500, error.message);
  }

  if (!articles?.length) {
    return NextResponse.json({ message: "No articles need images", updated: 0 });
  }

  let updated = 0;
  let failed = 0;
  const CONCURRENCY = 5;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (article) => {
        const ogImage = await fetchOgImage(article.url);
        if (ogImage) {
          await supabase
            .from("articles")
            .update({ image_url: ogImage })
            .eq("id", article.id);
          return true;
        }
        return false;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) updated++;
      else failed++;
    }
  }

  return NextResponse.json({
    success: true,
    processed: articles.length,
    updated,
    failed,
    remaining: articles.length === 30 ? "more articles may need images, run again" : "all done",
  });
});
