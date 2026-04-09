import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Lightweight health check endpoint (E1 / Observability).
 *
 * Returns 200 + JSON when every critical subsystem is reachable, or 503 +
 * JSON with per-check details when something critical is wrong. The
 * `ingestion` check is best-effort: a stale articles table downgrades the
 * status to "degraded" but does not flip us to 503, since stale data is an
 * operational concern rather than an outage.
 *
 * Constraints:
 *   - Must never block the caller for more than ~2s. Each subsystem call is
 *     wrapped in `withTimeout` so a hung Postgres connection can't pin the
 *     request open forever.
 *   - Must stay GET-only and dynamic so platform caches (Vercel CDN, browser)
 *     can't serve stale "healthy" responses while the underlying service
 *     melts down.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    env: { ok: boolean; missing: string[] };
    ingestion: { ok: boolean; lastArticleAgeSec?: number; error?: string };
  };
}

const PER_CHECK_TIMEOUT_MS = 2000;
const STALE_INGESTION_THRESHOLD_SEC = 600; // 10 minutes — see AGENTS.md

/**
 * Race a promise against a timer so a single hung subsystem can't blow our
 * 2s SLA. Resolves to a tagged union so callers can render a clean error
 * message instead of a generic "timed out".
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; error: string }>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: `${label} timed out after ${ms}ms` }),
      ms
    );
  });
  try {
    const value = await Promise.race([
      promise.then((v) => ({ ok: true as const, value: v })),
      timeout,
    ]);
    return value;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const checks: HealthStatus["checks"] = {
    database: { ok: false },
    env: { ok: false, missing: [] },
    ingestion: { ok: false },
  };

  // 1. Env check — cheap, synchronous, runs first so a misconfigured deploy
  //    can't even reach the DB layer with a bogus client.
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  checks.env = { ok: missing.length === 0, missing };

  // If env is broken there's no point hitting Supabase — the service-role
  // client will throw on construction. Short-circuit to a 503 with a useful
  // payload so on-call sees exactly what's missing.
  if (!checks.env.ok) {
    const body: HealthStatus = {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      checks,
    };
    return NextResponse.json(body, { status: 503 });
  }

  // 2. DB check — `select 1`-equivalent against a tiny, always-present table.
  //    We use `sources` because it's small and read-only in normal traffic,
  //    so the query is effectively free even on a busy primary.
  const dbProbe = (async () => {
    const supabase = createServerClient();
    const t0 = performance.now();
    const { error } = await supabase.from("sources").select("id").limit(1);
    const latencyMs = Math.round(performance.now() - t0);
    if (error) {
      return { ok: false as const, latencyMs, error: error.message };
    }
    return { ok: true as const, latencyMs };
  })();

  const dbResult = await withTimeout(dbProbe, PER_CHECK_TIMEOUT_MS, "database");
  if (dbResult.ok) {
    checks.database = dbResult.value;
  } else {
    checks.database = { ok: false, error: dbResult.error };
  }

  // 3. Ingestion check — newest article's age. We treat "no rows" as a soft
  //    failure (degraded, not unhealthy) because a fresh deploy / cold DB
  //    legitimately has zero articles until the first cron tick.
  const ingestionProbe = (async () => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("articles")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return { ok: false as const, error: error.message };
    }
    if (!data) {
      return { ok: false as const, error: "no articles" };
    }
    const ageSec =
      (Date.now() - new Date(data.created_at).getTime()) / 1000;
    return {
      ok: ageSec < STALE_INGESTION_THRESHOLD_SEC,
      lastArticleAgeSec: Math.round(ageSec),
    };
  })();

  const ingestionResult = await withTimeout(
    ingestionProbe,
    PER_CHECK_TIMEOUT_MS,
    "ingestion"
  );
  if (ingestionResult.ok) {
    checks.ingestion = ingestionResult.value;
  } else {
    checks.ingestion = { ok: false, error: ingestionResult.error };
  }

  // Status rollup:
  //   - DB or env failure  -> unhealthy / 503 (page someone)
  //   - ingestion stale    -> degraded / 200 (warn dashboards, no page)
  //   - everything green   -> healthy / 200
  const allOk =
    checks.database.ok && checks.env.ok && checks.ingestion.ok;
  const anyCritical = !checks.database.ok || !checks.env.ok;

  const body: HealthStatus = {
    status: allOk ? "healthy" : anyCritical ? "unhealthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, { status: anyCritical ? 503 : 200 });
}
