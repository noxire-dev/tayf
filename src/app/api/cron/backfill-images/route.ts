import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchOgImage } from "@/lib/rss/og-image";

export const maxDuration = 120;

/**
 * Backfill og:image for articles that are missing images.
 * Hit this endpoint once to fix existing articles, then rely on the
 * regular ingest cron which now fetches og:image automatically.
 *
 * Processes in batches of 20 to stay within timeout.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
}
