import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { connection, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  apiError,
  apiUnauthorized,
  withApiErrors,
} from "@/lib/api/errors";

/**
 * Operational metrics endpoint.
 *
 * Emits row counts for articles / clusters / sources plus a couple of
 * derived ratios used by the on-call dashboards and the post-deploy smoke
 * scripts. The shape is intentionally flat-and-stable: dashboards key off
 * specific field names and breaking changes here cascade into the alert
 * runbooks. Bump the contract carefully.
 *
 * AUTH
 * ----
 * Gated behind `Authorization: Bearer ${CRON_SECRET}`. The data exposed
 * (queue depths, article-age, blindspot counts) is operational
 * reconnaissance — useful to anyone running the dashboards, dangerous in
 * an attacker's hands when timing pressure on the pipeline. The bearer
 * check mirrors `/api/cron/headline` byte-for-byte (constant-time
 * compare, FAIL-CLOSED when `CRON_SECRET` is unset).
 *
 * Wrapped in `withApiErrors` so an unexpected throw (Supabase RPC quirk,
 * row-count overflow, etc.) returns the canonical JSON-500 envelope and
 * lands in Sentry rather than rendering Next's default HTML error page.
 */

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

/**
 * Constant-time bearer-token check. Mirrors `/api/cron/headline`. Length
 * is compared first so `timingSafeEqual`'s equal-length precondition is
 * satisfied without throwing; length leakage is not a real attack surface
 * here.
 */
function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(secret, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export const GET = withApiErrors(async (request: Request) => {
  // Stay dynamic — `cacheComponents` would otherwise prerender this and
  // pin a "100 articles, 0 clusters" snapshot into the CDN forever.
  await connection();

  // FAIL-CLOSED: a missing or empty CRON_SECRET means we cannot enforce
  // bearer auth, so we refuse the request outright rather than serving
  // operational data anonymously. Same pattern as `/api/cron/headline`.
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    return apiError(503, "CRON_SECRET is not configured");
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorized(authHeader, secret)) {
    return apiUnauthorized();
  }

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

  // Auth-gated operational data — must NOT be CDN-cached. The previous
  // `public, max-age=60` is gone because we no longer want any cache
  // layer between Vercel and the dashboard.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
});
