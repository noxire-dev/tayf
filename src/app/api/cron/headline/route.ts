import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { connection, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  apiError,
  apiUnauthorized,
  withApiErrors,
} from "@/lib/api/errors";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

/**
 * Vercel cron — neutral-headline rewriter.
 *
 * Replaces the long-running `scripts/headline-worker.mjs` tmux process with a
 * stateless serverless invocation that runs every 5 minutes (see `vercel.ts`).
 *
 * BEHAVIOUR
 * ---------
 * Walks the partial index `idx_clusters_needs_rewrite`
 * (`title_neutral_at IS NULL AND article_count >= 3`) in a small batch,
 * fetches the member article titles for each candidate cluster, asks the
 * Anthropic API (`claude-haiku-4-5`) for a neutral Turkish summary headline,
 * then writes the result into `clusters.title_tr_neutral` and stamps
 * `title_neutral_at = now()`. Per A3 the LLM cost stays under $1/month at
 * the default cadence — keep the batch small.
 *
 * AUTH
 * ----
 * Bearer token comparison uses `crypto.timingSafeEqual` to avoid leaking the
 * secret through string-compare timing. The route is FAIL-CLOSED: if
 * `CRON_SECRET` is unset (or empty) in the runtime environment, we return
 * 503 rather than allowing unauthenticated invocations. Vercel cron pings
 * this endpoint with `Authorization: Bearer <CRON_SECRET>` automatically;
 * any external caller must supply the same header.
 */

// Node runtime — the LLM call uses `fetch` against api.anthropic.com plus
// the Supabase JS client, which is happiest on Node 24.x rather than Edge.
export const runtime = "nodejs";

// Vercel Pro Hobby/Pro tier ceiling for cron routes. Per-cycle work is
// LLM-bound (one network round-trip per cluster, sequential) so 60s leaves
// headroom even on slow Anthropic responses while still keeping the cron
// quick enough to overlap cleanly with the */5 schedule.
export const maxDuration = 60;

// Token-bucket guard — the cron itself ticks every 5 minutes (well under
// the limit), so this exists mainly to protect against accidental curl
// floods if the endpoint is hit ad-hoc with a valid secret.
const headlineLimit = createRateLimiter("cron-headline", {
  capacity: 5,
  refillPerSecond: 1 / 60,
});

// LLM batch size. Matches `scripts/headline-worker.mjs` — small on purpose
// so a transient Anthropic 5xx doesn't blow the whole cycle and so monthly
// spend stays bounded.
const LLM_BATCH = 5;

// Same `MEMBER_TITLES_CAP` as the tmux worker. The rewriter slices to 8
// internally; we ask for a couple extra so the slice is meaningful even
// after dedupe / nulls.
const MEMBER_TITLES_CAP = 16;

const MIN_ARTICLE_COUNT = 3;

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

/**
 * Constant-time bearer-token check.
 *
 * Returns true iff `header` is exactly `Bearer ${secret}` and the suffix
 * matches `secret` byte-for-byte. `timingSafeEqual` requires equal-length
 * buffers, so we short-circuit on length mismatch BEFORE the call to avoid
 * the throw — but only on length, never on content, so an attacker cannot
 * distinguish "wrong length" from "wrong bytes" via response time within
 * the same length class.
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

interface ClusterCandidate {
  id: string;
  title_tr: string | null;
  summary_tr: string | null;
  article_count: number;
}

interface ClusterArticleRow {
  articles: { title: string | null; published_at: string | null } | null;
}

/**
 * Ask Claude Haiku for a neutral, factual aggregator headline for a cluster.
 * Ports the prompt + parsing logic from `scripts/lib/shared/llm-headlines.mjs`
 * so the tmux worker and this cron emit identical output for the same input.
 */
async function rewriteClusterHeadline(input: {
  member_titles: string[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const memberTitles = input.member_titles
    .slice(0, 8)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const prompt = `Aşağıda 8 farklı Türk haber kaynağının aynı haber için yazdığı başlıklar var. Bu haberleri toplu bir tarafsız başlığa indirgemen gerekiyor.

KURALLAR:
- En fazla 80 karakter
- Tarafsız, olgusal, sıfat içermeyen
- Hiçbir kaynağın tonunu kopyalama
- Açık şekilde olayı anlat
- "Şok!", "Son dakika!", "Kahreden..." gibi clickbait yasak
- Türkçe olmalı
- Sadece başlığı yaz, başka açıklama yok

KAYNAK BAŞLIKLARI:
${memberTitles}

TARAFSIZ TOPLU BAŞLIK:`;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  const text = data.content?.[0]?.text?.trim();
  if (!text) {
    throw new Error("Empty response from Anthropic");
  }

  // Strip stray wrapping quotes (curly + straight) the model sometimes adds.
  return text.replace(/^["'“‘]|["'”’]$/g, "").trim();
}

export const GET = withApiErrors(async (request: Request) => {
  // Next.js 16 with cacheComponents prerenders GET handlers at build time.
  // `await connection()` returns a hanging promise during prerender so
  // `request.headers` below is never touched until an actual request hits.
  // See https://nextjs.org/docs/messages/next-prerender-sync-request.
  await connection();

  // FAIL-CLOSED: if no CRON_SECRET is configured we refuse the request
  // outright rather than the legacy `if (process.env.CRON_SECRET && ...)`
  // pattern that silently waved everything through in dev / mis-deployed
  // environments. Audit T3 P0-9.
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    return apiError(503, "CRON_SECRET is not configured");
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorized(authHeader, secret)) {
    return apiUnauthorized();
  }

  const rl = headlineLimit(clientKey(request));
  if (!rl.allowed) {
    return apiError(429, "Too many requests", {
      details: { retryAfterMs: rl.retryAfterMs },
    });
  }

  // No ANTHROPIC_API_KEY → soft no-op. The cron will keep firing every 5
  // minutes, so an operator that drops a key into Vercel env vars and
  // redeploys gets healing on the very next tick — no manual kick needed.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      skipped: true,
      reason: "ANTHROPIC_API_KEY not set",
      timestamp: new Date().toISOString(),
    });
  }

  const supabase = createServerClient();

  // 1. Pick the next batch of clusters needing a neutral title. Ordered by
  // article_count DESC so the most-visible (multi-source) clusters get
  // rewritten first — same priority order as the tmux worker.
  const { data: clustersData, error: pickError } = await supabase
    .from("clusters")
    .select("id, title_tr, summary_tr, article_count")
    .is("title_neutral_at", null)
    .gte("article_count", MIN_ARTICLE_COUNT)
    .order("article_count", { ascending: false })
    .limit(LLM_BATCH);

  if (pickError) {
    return apiError(500, "Failed to pick clusters", {
      details: { supabase: pickError.message },
    });
  }

  const clusters = (clustersData ?? []) as ClusterCandidate[];

  if (clusters.length === 0) {
    return NextResponse.json({
      success: true,
      rewrote: 0,
      skipped: 0,
      errored: 0,
      reason: "no candidates",
      timestamp: new Date().toISOString(),
    });
  }

  let rewrote = 0;
  let skipped = 0;
  let errored = 0;
  const perCluster: Record<string, { status: string; error?: string }> = {};

  // Sequential. The Anthropic API is fine with bursts but cost-conscious
  // mode wants serialised retries; one bad cluster shouldn't blow the
  // whole batch and we want predictable wall time inside the 60s ceiling.
  for (const c of clusters) {
    // Fetch member titles for this cluster.
    const { data: memberRows, error: memberErr } = await supabase
      .from("cluster_articles")
      .select("articles ( title, published_at )")
      .eq("cluster_id", c.id)
      .limit(MEMBER_TITLES_CAP);

    if (memberErr) {
      perCluster[c.id] = { status: "errored", error: memberErr.message };
      errored++;
      continue;
    }

    const items: Array<{ title: string; published_at: string | null }> = [];
    for (const r of (memberRows ?? []) as ClusterArticleRow[]) {
      const a = r.articles;
      if (!a || !a.title) continue;
      items.push({ title: a.title, published_at: a.published_at });
    }
    // Newest-first so the LLM sees the freshest framings of the story.
    items.sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
    const memberTitles = items.map((i) => i.title);

    if (memberTitles.length === 0) {
      perCluster[c.id] = { status: "skipped" };
      skipped++;
      continue;
    }

    let neutral: string;
    try {
      neutral = await rewriteClusterHeadline({ member_titles: memberTitles });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      perCluster[c.id] = { status: "errored", error: msg };
      errored++;
      continue;
    }

    if (!neutral) {
      perCluster[c.id] = { status: "errored", error: "empty rewrite" };
      errored++;
      continue;
    }

    const { error: writeErr } = await supabase
      .from("clusters")
      .update({
        title_tr_neutral: neutral,
        title_neutral_at: new Date().toISOString(),
      })
      .eq("id", c.id);

    if (writeErr) {
      perCluster[c.id] = { status: "errored", error: writeErr.message };
      errored++;
      continue;
    }

    perCluster[c.id] = { status: "rewrote" };
    rewrote++;
  }

  return NextResponse.json({
    success: true,
    rewrote,
    skipped,
    errored,
    clusters: perCluster,
    timestamp: new Date().toISOString(),
  });
});
