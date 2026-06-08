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
    /**
     * Multi-article clusters eligible for the neutral-headline rewrite
     * (article_count >= 3 per the /api/cron/headline batch query). On-call
     * pages on the ratio vs `neutralized` below; if drift exceeds a
     * threshold, headline cron has stalled.
     */
    neutralizedEligible: number;
    /** Clusters where `title_tr_neutral` has already been written. */
    neutralized: number;
    /**
     * Ratio of neutralized clusters to eligible clusters, rounded to two
     * decimals. 1.0 means headline cron is fully caught up; values below
     * 0.9 typically indicate cron drift.
     */
    neutralizedRatio: number;
    /**
     * Age in seconds of the oldest eligible cluster that has NOT been
     * neutralized yet. The most actionable single signal for headline-
     * cron health — a value rising past ~600 means the cron has skipped
     * at least one batch. Null when no pending neutralization work
     * exists (or when the row has no first_published timestamp, which is
     * itself an upstream bug).
     */
    oldestPendingNeutralAgeSec: number | null;
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

  // Round-6 P1: the headline-cron health signals — `clustersNeutralizedEligible`,
  // `clustersNeutralized`, and `clustersOldestPendingNeutral` — are the
  // queries that make this endpoint actionable for the on-call rotation. The
  // ratio + age make headline-cron stalls page on age rather than on the
  // ratio alone (the ratio takes hours to drift visibly).
  const oldestPendingNeutralQuery = supabase
    .from("clusters")
    .select("first_published")
    .is("title_neutral_at", null)
    .gte("article_count", 3)
    .order("first_published", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Run all the counts in parallel.
  const queries = [
    { name: "articlesTotal", q: supabase.from("articles").select("*", { count: "exact", head: true }) },
    { name: "articlesLast24h", q: supabase.from("articles").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()) },
    { name: "articlesLastHour", q: supabase.from("articles").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 3600_000).toISOString()) },
    { name: "politicsNullImage", q: supabase.from("articles").select("*", { count: "exact", head: true }).is("image_url", null).in("category", ["politika", "son_dakika"]) },
    { name: "articlesWithImage", q: supabase.from("articles").select("*", { count: "exact", head: true }).not("image_url", "is", null) },
    { name: "clustersTotal", q: supabase.from("clusters").select("*", { count: "exact", head: true }) },
    { name: "clustersMulti", q: supabase.from("clusters").select("*", { count: "exact", head: true }).gte("article_count", 2) },
    { name: "clustersBlindspots", q: supabase.from("clusters").select("*", { count: "exact", head: true }).eq("is_blindspot", true) },
    { name: "clustersNeutralizedEligible", q: supabase.from("clusters").select("*", { count: "exact", head: true }).gte("article_count", 3) },
    { name: "clustersNeutralized", q: supabase.from("clusters").select("*", { count: "exact", head: true }).gte("article_count", 3).not("title_neutral_at", "is", null) },
    { name: "sourcesTotal", q: supabase.from("sources").select("*", { count: "exact", head: true }) },
    { name: "sourcesActive", q: supabase.from("sources").select("*", { count: "exact", head: true }).eq("active", true) },
  ];
  const [results, oldestPendingNeutralRes] = await Promise.all([
    Promise.all(queries.map((entry) => entry.q)),
    oldestPendingNeutralQuery,
  ]);

  // Surface any per-query Supabase errors instead of silently dropping them
  // into `?? 0` — the previous shape would flatline a metric on RPC failure
  // and the dashboard / on-call would see "zero articles" rather than a 5xx.
  // Round-4 critic finding documented this as a regression of an audit-era
  // anti-pattern resurfacing in a new file.
  const failed = results
    .map((r, i) => ({ name: queries[i]!.name, error: r.error }))
    .filter((entry) => entry.error !== null);
  if (failed.length > 0) {
    console.error("[metrics] supabase query failure", failed);
    return apiError(503, "metrics query failed", {
      code: "METRICS_QUERY_FAILED",
      details: { queries: failed.map((entry) => entry.name) },
    });
  }

  // results[i] is guaranteed defined: the `queries` array is a literal of
  // exactly 12 entries, so Promise.all returns exactly 12 results. The non-
  // null assertions below mirror that invariant for the strict tsconfig
  // (noUncheckedIndexedAccess); the alternative is a tuple type, which is
  // noisier for the same guarantee.
  const articlesTotal = results[0]!;
  const articlesLast24h = results[1]!;
  const articlesLastHour = results[2]!;
  const politicsNullImage = results[3]!;
  const articlesWithImage = results[4]!;
  const clustersTotal = results[5]!;
  const clustersMulti = results[6]!;
  const clustersBlindspots = results[7]!;
  const clustersNeutralizedEligible = results[8]!;
  const clustersNeutralized = results[9]!;
  const sourcesTotal = results[10]!;
  const sourcesActive = results[11]!;

  if (oldestPendingNeutralRes.error) {
    console.error(
      "[metrics] supabase oldest-pending-neutral query failure",
      oldestPendingNeutralRes.error,
    );
    return apiError(503, "metrics query failed", {
      code: "METRICS_QUERY_FAILED",
      details: { queries: ["oldestPendingNeutral"] },
    });
  }

  const clustersCount = clustersTotal.count ?? 0;
  const totalArticles = articlesTotal.count ?? 0;
  const eligibleCount = clustersNeutralizedEligible.count ?? 0;
  const neutralizedCount = clustersNeutralized.count ?? 0;
  const oldestPendingFirstPublished =
    (oldestPendingNeutralRes.data as { first_published: string | null } | null)
      ?.first_published ?? null;
  const oldestPendingAgeSec = oldestPendingFirstPublished
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(oldestPendingFirstPublished).getTime()) / 1000),
      )
    : null;

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
      neutralizedEligible: eligibleCount,
      neutralized: neutralizedCount,
      neutralizedRatio: eligibleCount > 0
        ? Math.round((neutralizedCount / eligibleCount) * 100) / 100
        : 1,
      oldestPendingNeutralAgeSec: oldestPendingAgeSec,
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
