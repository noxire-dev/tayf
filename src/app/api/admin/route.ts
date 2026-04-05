import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function GET() {
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
}

export async function POST(request: Request) {
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
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: `${slug} is now ${active ? "active" : "disabled"}` });
    }

    case "add_source": {
      const { name, slug, url, rss_url, bias } = body;
      if (!name || !slug || !url || !rss_url || !bias) {
        return NextResponse.json({ error: "All fields are required" }, { status: 400 });
      }
      const { error } = await supabase.from("sources").insert({
        name,
        slug,
        url,
        rss_url,
        bias,
        active: true,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: `${name} added` });
    }

    case "update_source": {
      const { id, name, slug, url, rss_url, bias, active } = body;
      if (!id) return NextResponse.json({ error: "Source id is required" }, { status: 400 });
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (slug !== undefined) updates.slug = slug;
      if (url !== undefined) updates.url = url;
      if (rss_url !== undefined) updates.rss_url = rss_url;
      if (bias !== undefined) updates.bias = bias;
      if (active !== undefined) updates.active = active;
      const { error } = await supabase.from("sources").update(updates).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: `${name || "Source"} updated` });
    }

    case "delete_source": {
      const { id } = body;
      if (!id) return NextResponse.json({ error: "Source id is required" }, { status: 400 });
      const { error } = await supabase.from("sources").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: "Source deleted" });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
