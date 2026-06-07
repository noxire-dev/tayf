import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { connection, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { withApiErrors } from "@/lib/api/errors";

/**
 * Lightweight health check endpoint (E1 / Observability + B8 worker-stream
 * additions).
 *
 * Returns 200 + JSON when every critical subsystem is reachable, or 503 +
 * JSON with per-check details when something critical is wrong. The
 * `ingestion`, `clustering`, and `queues` checks are best-effort: stale data
 * (or a malformed `worker_metrics` view) downgrades the affected probe to a
 * non-critical "degraded" signal but never flips the whole endpoint to 503,
 * since these are operational concerns rather than user-facing outages.
 *
 * RESPONSE SHAPES
 * ---------------
 *   - Anonymous callers receive only `{ status, timestamp }`. We do not
 *     expose internal probe data to the open internet because that data
 *     (queue depths, article-age, missing env-var names) is operational
 *     reconnaissance an attacker can use to time pressure on the pipeline.
 *   - Callers authenticated via `Authorization: Bearer ${CRON_SECRET}`
 *     receive the full per-check breakdown. The bearer check re-uses the
 *     same constant-time helper as `/api/cron/headline`.
 *
 * Constraints:
 *   - Must never block the caller for more than ~2s per check. Each
 *     subsystem call is wrapped in `withTimeout` so a hung Postgres
 *     connection can't pin the request open forever.
 *   - Must stay GET-only and dynamic so platform caches (Vercel CDN,
 *     browser) can't serve stale "healthy" responses while the underlying
 *     service melts down.
 *   - Wrapped in `withApiErrors` so unexpected throws land in Sentry and
 *     return the canonical JSON-500 envelope instead of Next's default
 *     HTML error page.
 */

interface QueueMetric {
  queue: string;
  queueLength: number;
  oldestMsgAgeSec: number | null;
}

type HealthVerdict = "healthy" | "degraded" | "unhealthy";

interface HealthChecks {
  database: { ok: boolean; latencyMs?: number; error?: string };
  env: { ok: boolean; missing: string[] };
  ingestion: { ok: boolean; lastArticleAgeSec?: number; error?: string };
  clustering: {
    ok: boolean;
    lastClusterAgeSec?: number;
    error?: string;
  };
  queues: { ok: boolean; metrics?: QueueMetric[]; error?: string };
}

interface DetailedHealthBody {
  status: HealthVerdict;
  timestamp: string;
  checks: HealthChecks;
}

interface AnonymousHealthBody {
  status: HealthVerdict;
  timestamp: string;
}

const PER_CHECK_TIMEOUT_MS = 2000;
const STALE_INGESTION_THRESHOLD_SEC = 600; // 10 minutes — see AGENTS.md
// B8: clustering must move within 15 minutes; the consumer drains every
// minute via pg_cron so a 15-minute gap means the consumer (or pgmq) is
// stuck. This matches the threshold the ADR-001 audit row called out.
// We track `updated_at` rather than `created_at` so the probe reflects
// active processing (clusters being re-scored as new articles arrive) and
// not just the first time each cluster was inserted; under steady-state
// traffic many minutes can pass with no NEW clusters formed even while
// the consumer is happily ack-ing messages.
const STALE_CLUSTERING_THRESHOLD_SEC = 15 * 60;
// B8: queue-depth alarm. The cluster_work consumer batches 50 messages per
// invocation and runs every minute; the image_backfill consumer batches 20
// every 5 minutes. We consider 500 messages in-flight a sign of a stuck
// consumer rather than a normal backlog. Oldest-message-age over 30 min is
// a stronger signal — a single message that's been visible for 30+ min
// almost certainly means the consumer is failing to archive it.
const QUEUE_DEPTH_THRESHOLD = 500;
const QUEUE_OLDEST_AGE_THRESHOLD_SEC = 30 * 60;

/**
 * Constant-time bearer-token check. Mirrors the helper in
 * `/api/cron/headline`. Returns true iff `header` is exactly
 * `Bearer ${secret}`. Length is compared first so `timingSafeEqual`'s
 * equal-length precondition is satisfied without throwing; length leakage
 * is unavoidable and not a real attack surface here.
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

/**
 * Run a probe function inside an outer try/catch so an unexpected throw
 * (malformed view, missing column, etc.) degrades the single affected
 * probe rather than 500-ing the whole endpoint. Returns the same tagged
 * shape `withTimeout` produces so call-sites stay uniform.
 */
async function safeProbe<T>(
  fn: () => Promise<T>,
  label: string
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return await withTimeout(fn(), PER_CHECK_TIMEOUT_MS, label);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${label} threw: ${message}` };
  }
}

export const GET = withApiErrors(async (request?: Request) => {
  // Next.js 16 with cacheComponents prerenders GET handlers at build time.
  // Touching `request.headers` during prerender raises
  // `NEXT_PRERENDER_INTERRUPTED`, which `withApiErrors` re-throws through
  // `unstable_rethrow`. `await connection()` is the documented escape
  // hatch — it hangs forever during prerender and resolves only on a real
  // request, so the handler stays fully dynamic.
  await connection();

  const checks: HealthChecks = {
    database: { ok: false },
    env: { ok: false, missing: [] },
    ingestion: { ok: false },
    clustering: { ok: false },
    queues: { ok: false },
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
    return respond("unhealthy", checks, 503, request);
  }

  // 2. DB check — `select 1`-equivalent against a tiny, always-present table.
  //    We use `sources` because it's small and read-only in normal traffic,
  //    so the query is effectively free even on a busy primary.
  const dbResult = await safeProbe(async () => {
    const supabase = createServerClient();
    const t0 = performance.now();
    const { error } = await supabase.from("sources").select("id").limit(1);
    const latencyMs = Math.round(performance.now() - t0);
    if (error) {
      return { ok: false as const, latencyMs, error: error.message };
    }
    return { ok: true as const, latencyMs };
  }, "database");
  if (dbResult.ok) {
    checks.database = dbResult.value;
  } else {
    checks.database = { ok: false, error: dbResult.error };
  }

  // 3. Ingestion check — newest article's age. We treat "no rows" as a soft
  //    failure (degraded, not unhealthy) because a fresh deploy / cold DB
  //    legitimately has zero articles until the first cron tick.
  const ingestionResult = await safeProbe(async () => {
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
  }, "ingestion");
  if (ingestionResult.ok) {
    checks.ingestion = ingestionResult.value;
  } else {
    checks.ingestion = { ok: false, error: ingestionResult.error };
  }

  // 4. Clustering check (B8) — most recently TOUCHED cluster. We look at
  //    `updated_at` (not `created_at`) so the probe reflects active
  //    processing: every cluster-consumer pass updates a cluster row even
  //    when no new cluster is formed. Under normal load the freshest
  //    `updated_at` should be within the last 15 minutes. A gap larger
  //    than that means either (a) the consumer is stuck (pgmq
  //    visibility-timeout exhaustion, Deno panic, etc.) or (b) no
  //    articles are being ingested — and (b) is already reflected in the
  //    ingestion check above. We keep the two signals separate so an
  //    alert can tell us WHICH side of the pipeline is broken.
  const clusteringResult = await safeProbe(async () => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("clusters")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return { ok: false as const, error: error.message };
    }
    if (!data) {
      // No clusters at all is degraded (fresh deploy), not unhealthy.
      return { ok: false as const, error: "no clusters" };
    }
    const ageSec =
      (Date.now() - new Date(data.updated_at).getTime()) / 1000;
    return {
      ok: ageSec < STALE_CLUSTERING_THRESHOLD_SEC,
      lastClusterAgeSec: Math.round(ageSec),
    };
  }, "clustering");
  if (clusteringResult.ok) {
    checks.clustering = clusteringResult.value;
  } else {
    checks.clustering = { ok: false, error: clusteringResult.error };
  }

  // 5. Queues check (B8) — read the `worker_metrics` view that B1's
  //    migration exposes (filtered pgmq.metrics_all). A deep queue or an
  //    old oldest-message age means the consumer isn't keeping up. This
  //    is downgraded to "degraded" rather than "unhealthy" because a
  //    transient backlog doesn't warrant paging on-call; the clustering
  //    check above is the canonical "workers are dead" signal.
  //
  //    `oldest_msg_age_sec` is coerced through `Number()` and gated by
  //    `Number.isFinite` so a string / NaN coming back from the view
  //    (driver quirks, BIGINT serialisation, etc.) can't accidentally
  //    pass a numeric comparison against the threshold.
  const queuesResult = await safeProbe(async () => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("worker_metrics")
      .select("queue_name, queue_length, oldest_msg_age_sec");
    if (error) {
      return { ok: false as const, error: error.message };
    }
    if (!data || data.length === 0) {
      // Empty result means the view exists but pgmq.metrics_all() returned
      // nothing for our queues — typically because the queues haven't been
      // created yet (migration 024 didn't run). Surface as a soft failure.
      return { ok: false as const, error: "no queue metrics" };
    }
    type Row = {
      queue_name: string;
      queue_length: number | null;
      oldest_msg_age_sec: number | string | null;
    };
    const rows = data as Row[];
    const metrics: QueueMetric[] = rows.map((r) => {
      const ageRaw = r.oldest_msg_age_sec;
      const ageNum = ageRaw === null ? null : Number(ageRaw);
      const oldestMsgAgeSec =
        ageNum !== null && Number.isFinite(ageNum) ? ageNum : null;
      return {
        queue: r.queue_name,
        queueLength: r.queue_length ?? 0,
        oldestMsgAgeSec,
      };
    });
    const overDepth = metrics.find(
      (m) => m.queueLength > QUEUE_DEPTH_THRESHOLD
    );
    const overAge = metrics.find(
      (m) =>
        m.oldestMsgAgeSec !== null &&
        m.oldestMsgAgeSec > QUEUE_OLDEST_AGE_THRESHOLD_SEC
    );
    if (overDepth) {
      return {
        ok: false as const,
        metrics,
        error: `queue ${overDepth.queue} depth ${overDepth.queueLength} exceeds ${QUEUE_DEPTH_THRESHOLD}`,
      };
    }
    if (overAge) {
      return {
        ok: false as const,
        metrics,
        error: `queue ${overAge.queue} oldest message age ${overAge.oldestMsgAgeSec}s exceeds ${QUEUE_OLDEST_AGE_THRESHOLD_SEC}s`,
      };
    }
    return { ok: true as const, metrics };
  }, "queues");
  if (queuesResult.ok) {
    checks.queues = queuesResult.value;
  } else {
    checks.queues = { ok: false, error: queuesResult.error };
  }

  // Status rollup:
  //   - DB or env failure                  -> unhealthy / 503 (page someone)
  //   - ingestion / clustering / queues    -> degraded / 200 (warn, no page)
  //   - everything green                   -> healthy / 200
  //
  // Clustering and queues are intentionally NOT critical: a stuck consumer
  // is bad but not a user-facing outage (the homepage keeps serving the
  // last good cluster set). DB / env failures break every page render and
  // SHOULD page.
  const anyCritical = !checks.database.ok || !checks.env.ok;
  const allOk =
    checks.database.ok &&
    checks.env.ok &&
    checks.ingestion.ok &&
    checks.clustering.ok &&
    checks.queues.ok;
  const verdict: HealthVerdict = allOk
    ? "healthy"
    : anyCritical
      ? "unhealthy"
      : "degraded";

  return respond(verdict, checks, anyCritical ? 503 : 200, request);
});

/**
 * Build the JSON response. Authenticated callers (CRON_SECRET bearer) get
 * the full probe breakdown; anonymous callers get only the rollup verdict
 * + timestamp. Cache-Control is `no-store` so neither the CDN nor the
 * browser can serve a stale "healthy" snapshot while the pipeline is
 * actually on fire.
 */
function respond(
  verdict: HealthVerdict,
  checks: HealthChecks,
  status: number,
  request?: Request
): Response {
  const timestamp = new Date().toISOString();
  const secret = process.env.CRON_SECRET;
  const authed =
    typeof secret === "string" &&
    secret.length > 0 &&
    request !== undefined &&
    isAuthorized(request.headers.get("authorization"), secret);

  const headers = { "Cache-Control": "no-store" };

  if (authed) {
    const body: DetailedHealthBody = { status: verdict, timestamp, checks };
    return NextResponse.json(body, { status, headers });
  }

  const body: AnonymousHealthBody = { status: verdict, timestamp };
  return NextResponse.json(body, { status, headers });
}
