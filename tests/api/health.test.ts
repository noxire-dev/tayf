import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Supabase mock plumbing.
//
// The health route calls:
//   supabase.from("sources").select("id").limit(1)
//   supabase.from("articles").select("created_at").order(...).limit(1).maybeSingle()
//
// We replace `@supabase/supabase-js` at the module boundary with a factory
// that returns a chainable client whose terminal methods are driven by the
// `responders` map below. Each test sets the responders it needs before
// importing the route.
// ---------------------------------------------------------------------------

type TableName = "sources" | "articles";

interface SelectResponse {
  data?: unknown;
  error?: { message: string } | null;
}

const responders: {
  sourcesSelect: () => Promise<SelectResponse>;
  articlesMaybeSingle: () => Promise<SelectResponse>;
} = {
  sourcesSelect: async () => ({ data: [{ id: "s1" }], error: null }),
  articlesMaybeSingle: async () => ({
    data: { created_at: new Date().toISOString() },
    error: null,
  }),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    function sourcesChain() {
      const chain = {
        select: () => chain,
        limit: () => responders.sourcesSelect(),
      };
      return chain;
    }
    function articlesChain() {
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => responders.articlesMaybeSingle(),
      };
      return chain;
    }
    return {
      from: (table: TableName) => {
        if (table === "sources") return sourcesChain();
        if (table === "articles") return articlesChain();
        throw new Error(`Unexpected table: ${table}`);
      },
    };
  },
}));

// Save + restore env so one test can't poison another.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  // Reset responders to "healthy" defaults.
  responders.sourcesSelect = async () => ({
    data: [{ id: "s1" }],
    error: null,
  });
  responders.articlesMaybeSingle = async () => ({
    data: { created_at: new Date().toISOString() },
    error: null,
  });
});

afterEach(() => {
  // Restore env keys we touched to their original values (or delete if they
  // weren't there before).
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
  const mod = await import("@/app/api/health/route");
  const res = await mod.GET();
  const body = await res.json();
  return { status: res.status, body };
}

describe("GET /api/health", () => {
  it("returns 200 healthy when every check passes", async () => {
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.checks.env.ok).toBe(true);
    expect(body.checks.env.missing).toEqual([]);
    expect(body.checks.database.ok).toBe(true);
    expect(typeof body.checks.database.latencyMs).toBe("number");
    expect(body.checks.ingestion.ok).toBe(true);
    expect(typeof body.checks.ingestion.lastArticleAgeSec).toBe("number");
  });

  it("returns 503 unhealthy when required env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { status, body } = await callGet();
    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.checks.env.ok).toBe(false);
    expect(body.checks.env.missing).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
      ])
    );
    // When env is broken the route should short-circuit without running
    // the other probes; their `ok` remains false from the initial state.
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.ingestion.ok).toBe(false);
  });

  it("returns 503 unhealthy when the database probe errors", async () => {
    responders.sourcesSelect = async () => ({
      data: null,
      error: { message: "connection refused" },
    });
    const { status, body } = await callGet();
    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.error).toMatch(/connection refused/);
  });

  it("returns 200 degraded when ingestion is stale but DB is fine", async () => {
    // 2 hours ago is well past the 10-minute threshold.
    const staleIso = new Date(
      Date.now() - 2 * 60 * 60 * 1000
    ).toISOString();
    responders.articlesMaybeSingle = async () => ({
      data: { created_at: staleIso },
      error: null,
    });
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.ingestion.ok).toBe(false);
    expect(body.checks.ingestion.lastArticleAgeSec).toBeGreaterThan(600);
    expect(body.checks.database.ok).toBe(true);
  });

  it("treats no articles as degraded, not unhealthy", async () => {
    responders.articlesMaybeSingle = async () => ({
      data: null,
      error: null,
    });
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.ingestion.ok).toBe(false);
    expect(body.checks.ingestion.error).toBe("no articles");
  });

  it("surfaces an ingestion query error in the payload", async () => {
    responders.articlesMaybeSingle = async () => ({
      data: null,
      error: { message: "boom" },
    });
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.ingestion.ok).toBe(false);
    expect(body.checks.ingestion.error).toBe("boom");
  });
});
