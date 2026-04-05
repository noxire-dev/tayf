import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAllFeeds } from "@/lib/rss/fetcher";
import { normalizeArticles } from "@/lib/rss/normalize";
import { batchFetchOgImages } from "@/lib/rss/og-image";
import type { Source } from "@/types";

export const maxDuration = 120;

export async function GET(request: Request) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();

  // 1. Fetch active sources
  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("*")
    .eq("active", true);

  if (sourcesError || !sources?.length) {
    return NextResponse.json(
      { error: "Failed to fetch sources", details: sourcesError?.message },
      { status: 500 }
    );
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
}
