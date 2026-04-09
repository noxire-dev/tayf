import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  apiBadRequest,
  apiError,
  withApiErrors,
} from "@/lib/api/errors";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

// Mutating admin actions: 20-token bucket, refilling at 0.2 tokens/sec
// (1 token every 5s). Bursts of ~20 are fine, sustained spam gets 429'd.
// GET (read-only stats) is intentionally NOT limited because the admin UI
// polls it.
const adminPostLimit = createRateLimiter("admin-post", {
  capacity: 20,
  refillPerSecond: 0.2,
});

export const GET = withApiErrors(async () => {
  const supabase = createServerClient();

  const [
    { count: articleCount },
    { count: sourceCount },
    { count: clusterCount },
    { count: noImageCount },
  ] = await Promise.all([
    supabase.from("articles").select("*", { count: "exact", head: true }),
    supabase.from("sources").select("*", { count: "exact", head: true }),
    supabase.from("clusters").select("*", { count: "exact", head: true }),
    supabase
      .from("articles")
      .select("*", { count: "exact", head: true })
      .is("image_url", null),
  ]);

  const { data: sourcesList } = await supabase
    .from("sources")
    .select("id, name, slug, url, rss_url, bias, active")
    .order("bias");

  return NextResponse.json({
    articles: articleCount ?? 0,
    sources: sourceCount ?? 0,
    clusters: clusterCount ?? 0,
    missingImages: noImageCount ?? 0,
    sourcesList: sourcesList ?? [],
  });
});

export const POST = withApiErrors(async (request: Request) => {
  const rl = adminPostLimit(clientKey(request));
  if (!rl.allowed) {
    return apiError(429, "Too many requests", {
      details: { retryAfterMs: rl.retryAfterMs },
    });
  }

  const body = await request.json();
  const { action } = body;
  const supabase = createServerClient();

  switch (action) {
    case "nuke_articles": {
      await supabase.from("cluster_articles").delete().gte("cluster_id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("clusters").delete().gte("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("articles").delete().gte("id", "00000000-0000-0000-0000-000000000000");
      return NextResponse.json({ success: true, message: "All articles and clusters deleted" });
    }

    case "nuke_clusters": {
      await supabase.from("cluster_articles").delete().gte("cluster_id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("clusters").delete().gte("id", "00000000-0000-0000-0000-000000000000");
      return NextResponse.json({ success: true, message: "All clusters deleted" });
    }

    case "ingest": {
      const baseUrl = request.headers.get("origin") || "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/cron/ingest`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    case "backfill_images": {
      const baseUrl = request.headers.get("origin") || "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/cron/backfill-images`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    case "toggle_source": {
      const { slug, active } = body;
      const { error } = await supabase
        .from("sources")
        .update({ active })
        .eq("slug", slug);
      if (error) return apiError(500, error.message);
      return NextResponse.json({ success: true, message: `${slug} is now ${active ? "active" : "disabled"}` });
    }

    case "add_source": {
      const { name, slug, url, rss_url, bias } = body;
      if (!name || !slug || !url || !rss_url || !bias) {
        return apiBadRequest("All fields are required");
      }
      const { error } = await supabase.from("sources").insert({
        name,
        slug,
        url,
        rss_url,
        bias,
        active: true,
      });
      if (error) return apiError(500, error.message);
      return NextResponse.json({ success: true, message: `${name} added` });
    }

    case "update_source": {
      const { id, name, slug, url, rss_url, bias, active } = body;
      if (!id) return apiBadRequest("Source id is required");
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (slug !== undefined) updates.slug = slug;
      if (url !== undefined) updates.url = url;
      if (rss_url !== undefined) updates.rss_url = rss_url;
      if (bias !== undefined) updates.bias = bias;
      if (active !== undefined) updates.active = active;
      const { error } = await supabase.from("sources").update(updates).eq("id", id);
      if (error) return apiError(500, error.message);
      return NextResponse.json({ success: true, message: `${name || "Source"} updated` });
    }

    case "delete_source": {
      const { id } = body;
      if (!id) return apiBadRequest("Source id is required");
      const { error } = await supabase.from("sources").delete().eq("id", id);
      if (error) return apiError(500, error.message);
      return NextResponse.json({ success: true, message: "Source deleted" });
    }

    default:
      return apiBadRequest("Unknown action");
  }
});
