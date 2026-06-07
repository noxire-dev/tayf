import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Lightweight health check endpoint (E1 / Observability + B8 worker-stream
 * additions).
 *
 * Returns 200 + JSON when every critical subsystem is reachable, or 503 +
 * JSON with per-check details when something critical is wrong. The
 * `ingestion` and `clustering` checks are best-effort: stale data downgrades
 * the status to "degraded" but does not flip us to 503, since stale data is
 * an operational concern rather than an outage. The `queues` check is
 * informational only — pgmq queue depth alone is not an outage signal; the
 * cluster-staleness check is the canonical "workers are dead" trigger.
 *
 * Constraints:
 *   - Must never block the caller for more than ~2s per check. Each
 *     subsystem call is wrapped in `withTimeout` so a hung Postgres
 *     connection can't pin the request open forever.
 *   - Must stay GET-only and dynamic so platform caches (Vercel CDN,
 *     browser) can't serve stale "healthy" responses while the underlying
 *     service melts down.
 */

interface QueueMetric {
  queue: string;
  queueLength: number;
  oldestMsgAgeSec: number | null;
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    env: { ok: boolean; missing: string[] };
    ingestion: { ok: boolean; lastArticleAgeSec?: number; error?: string };
    clustering: {
      ok: boolean;
      lastClusterAgeSec?: number;
      error?: string;
    };
    queues: { ok: boolean; metrics?: QueueMetric[]; error?: string };
  };
}

const PER_CHECK_TIMEOUT_MS = 2000;
const STALE_INGESTION_THRESHOLD_SEC = 600; // 10 minutes — see AGENTS.md
// B8: clustering must move within 15 minutes; the consumer drains every
// minute via pg_cron so a 15-minute gap means the consumer (or pgmq) is
// stuck. This matches the threshold the ADR-001 audit row called out.
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

  // 4. Clustering check (B8) — newest cluster's age. The cluster-consumer
  //    Edge Function dequeues every minute and the cluster_work queue is
  //    fed by an INSERT trigger on articles, so under normal load the
  //    most-recently-created cluster should always be within the last 15
  //    minutes. A gap larger than that means either (a) the consumer is
  //    stuck (pgmq visibility-timeout exhaustion, Deno panic, etc.) or
  //    (b) no articles are being ingested — and (b) is already reflected
  //    in the ingestion check above. We separate the two so an alert can
  //    tell us WHICH side of the pipeline is broken.
  const clusteringProbe = (async () => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("clusters")
      .select("created_at")
      .order("created_at", { ascending: false })
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
      (Date.now() - new Date(data.created_at).getTime()) / 1000;
    return {
      ok: ageSec < STALE_CLUSTERING_THRESHOLD_SEC,
      lastClusterAgeSec: Math.round(ageSec),
    };
  })();

  const clusteringResult = await withTimeout(
    clusteringProbe,
    PER_CHECK_TIMEOUT_MS,
    "clustering"
  );
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
  const queuesProbe = (async () => {
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
      oldest_msg_age_sec: number | null;
    };
    const rows = data as Row[];
    const metrics: QueueMetric[] = rows.map((r) => ({
      queue: r.queue_name,
      queueLength: r.queue_length ?? 0,
      oldestMsgAgeSec: r.oldest_msg_age_sec,
    }));
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
  })();

  const queuesResult = await withTimeout(
    queuesProbe,
    PER_CHECK_TIMEOUT_MS,
    "queues"
  );
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

  const body: HealthStatus = {
    status: allOk ? "healthy" : anyCritical ? "unhealthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, { status: anyCritical ? 503 : 200 });
}
