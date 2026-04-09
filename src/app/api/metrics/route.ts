import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Metrics {
  timestamp: string;
  articles: {
    total: number;
    last24h: number;
    lastHour: number;
    politicsNullImage: number;
    withImage: number;
  };
  clusters: {
    total: number;
    multiArticle: number;
    blindspots: number;
    avgArticlesPerCluster: number;
  };
  sources: {
    total: number;
    active: number;
  };
}

export async function GET(): Promise<Response> {
  const supabase = createServerClient();

  // Run all the counts in parallel
  const [
    articlesTotal,
    articlesLast24h,
    articlesLastHour,
    politicsNullImage,
    articlesWithImage,
    clustersTotal,
    clustersMulti,
    clustersBlindspots,
    sourcesTotal,
    sourcesActive,
  ] = await Promise.all([
    supabase.from("articles").select("*", { count: "exact", head: true }),
    supabase.from("articles").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()),
    supabase.from("articles").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 3600_000).toISOString()),
    supabase.from("articles").select("*", { count: "exact", head: true }).is("image_url", null).in("category", ["politika", "son_dakika"]),
    supabase.from("articles").select("*", { count: "exact", head: true }).not("image_url", "is", null),
    supabase.from("clusters").select("*", { count: "exact", head: true }),
    supabase.from("clusters").select("*", { count: "exact", head: true }).gte("article_count", 2),
    supabase.from("clusters").select("*", { count: "exact", head: true }).eq("is_blindspot", true),
    supabase.from("sources").select("*", { count: "exact", head: true }),
    supabase.from("sources").select("*", { count: "exact", head: true }).eq("active", true),
  ]);

  const clustersCount = clustersTotal.count ?? 0;
  const totalArticles = articlesTotal.count ?? 0;

  const body: Metrics = {
    timestamp: new Date().toISOString(),
    articles: {
      total: totalArticles,
      last24h: articlesLast24h.count ?? 0,
      lastHour: articlesLastHour.count ?? 0,
      politicsNullImage: politicsNullImage.count ?? 0,
      withImage: articlesWithImage.count ?? 0,
    },
    clusters: {
      total: clustersCount,
      multiArticle: clustersMulti.count ?? 0,
      blindspots: clustersBlindspots.count ?? 0,
      avgArticlesPerCluster: clustersCount > 0 ? Math.round((totalArticles / clustersCount) * 100) / 100 : 0,
    },
    sources: {
      total: sourcesTotal.count ?? 0,
      active: sourcesActive.count ?? 0,
    },
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
