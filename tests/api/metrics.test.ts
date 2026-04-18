import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Supabase mock plumbing for /api/metrics.
//
// The route issues Promise.all over ten count queries. Each one starts with
// `supabase.from("<table>").select("*", { count: "exact", head: true })` and
// then chains zero or more filter predicates (.gte / .is / .in / .not / .eq).
// Every chain is thenable (the route `await`s on them directly via Promise.all)
// and resolves to `{ count: <number>, error: null }`.
//
// The `counts` map below lets each test dial in exactly what every call
// returns. The identity of each Promise.all entry is positional, not
// semantic — the mock tracks calls in the order they're made and returns the
// configured count for that index.
// ---------------------------------------------------------------------------

interface CountResponse {
  count: number | null;
  error: { message: string } | null;
}

// Default counts, in the order the route issues them. Matches the
// Promise.all in src/app/api/metrics/route.ts.
const DEFAULT_COUNTS: CountResponse[] = [
  { count: 100, error: null }, // articlesTotal
  { count: 20, error: null }, // articlesLast24h
  { count: 5, error: null }, // articlesLastHour
  { count: 3, error: null }, // politicsNullImage
  { count: 77, error: null }, // articlesWithImage
  { count: 40, error: null }, // clustersTotal
  { count: 12, error: null }, // clustersMulti
  { count: 2, error: null }, // clustersBlindspots
  { count: 8, error: null }, // sourcesTotal
  { count: 7, error: null }, // sourcesActive
];

let currentCounts: CountResponse[] = [...DEFAULT_COUNTS];
let callIndex = 0;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      // Each `.from()` opens a fresh chain. The terminal behavior is a
      // thenable whose resolved value is the next configured CountResponse.
      const thenable: {
        then: Promise<CountResponse>["then"];
        select: () => typeof thenable;
        gte: () => typeof thenable;
        is: () => typeof thenable;
        in: () => typeof thenable;
        not: () => typeof thenable;
        eq: () => typeof thenable;
        order: () => typeof thenable;
        limit: () => typeof thenable;
        maybeSingle: () => typeof thenable;
      } = {} as never;

      const chain: {
        select: () => typeof thenable;
        gte: () => typeof thenable;
        is: () => typeof thenable;
        in: () => typeof thenable;
        not: () => typeof thenable;
        eq: () => typeof thenable;
        order: () => typeof thenable;
        limit: () => typeof thenable;
        maybeSingle: () => typeof thenable;
        then: Promise<CountResponse>["then"];
      } = {
        select: () => thenable,
        gte: () => thenable,
        is: () => thenable,
        in: () => thenable,
        not: () => thenable,
        eq: () => thenable,
        order: () => thenable,
        limit: () => thenable,
        maybeSingle: () => thenable,
        then: (onFulfilled, onRejected) => {
          const idx = callIndex++;
          const response =
            currentCounts[idx] ?? { count: 0, error: null };
          return Promise.resolve(response).then(onFulfilled, onRejected);
        },
      };
      Object.assign(thenable, chain);
      return thenable;
    },
  }),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  currentCounts = [...DEFAULT_COUNTS];
  callIndex = 0;
});

afterEach(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (k in ORIGINAL_ENV) {
      process.env[k] = ORIGINAL_ENV[k] as string;
    } else {
      delete process.env[k];
    }
  }
  vi.resetModules();
});

async function callGet() {
  const mod = await import("@/app/api/metrics/route");
  const res = await mod.GET();
  const body = await res.json();
  return { res, status: res.status, body };
}

describe("GET /api/metrics", () => {
  it("returns 200 with the documented metric shape", async () => {
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body).toHaveProperty("timestamp");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(body.articles).toEqual({
      total: 100,
      last24h: 20,
      lastHour: 5,
      politicsNullImage: 3,
      withImage: 77,
    });

    expect(body.clusters).toEqual({
      total: 40,
      multiArticle: 12,
      blindspots: 2,
      // 100 / 40 = 2.5 (rounded to 2 decimal places)
      avgArticlesPerCluster: 2.5,
    });

    expect(body.sources).toEqual({
      total: 8,
      active: 7,
    });
  });

  it("sets a 60-second public cache header", async () => {
    const { res } = await callGet();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("treats null count values as 0", async () => {
    currentCounts = DEFAULT_COUNTS.map(() => ({ count: null, error: null }));
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.articles.total).toBe(0);
    expect(body.articles.last24h).toBe(0);
    expect(body.articles.lastHour).toBe(0);
    expect(body.articles.politicsNullImage).toBe(0);
    expect(body.articles.withImage).toBe(0);
    expect(body.clusters.total).toBe(0);
    expect(body.clusters.multiArticle).toBe(0);
    expect(body.clusters.blindspots).toBe(0);
    expect(body.sources.total).toBe(0);
    expect(body.sources.active).toBe(0);
  });

  it("sets avgArticlesPerCluster to 0 when there are no clusters (avoids div-by-zero)", async () => {
    currentCounts = [...DEFAULT_COUNTS];
    // clustersTotal is index 5
    currentCounts[5] = { count: 0, error: null };
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.clusters.total).toBe(0);
    expect(body.clusters.avgArticlesPerCluster).toBe(0);
  });

  it("rounds avgArticlesPerCluster to two decimal places", async () => {
    currentCounts = [...DEFAULT_COUNTS];
    // 7 articles / 3 clusters = 2.3333... → rounds to 2.33
    currentCounts[0] = { count: 7, error: null }; // articlesTotal
    currentCounts[5] = { count: 3, error: null }; // clustersTotal
    const { body } = await callGet();
    expect(body.clusters.avgArticlesPerCluster).toBe(2.33);
  });
});
