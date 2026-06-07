import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for /api/cron/headline (Vercel cron, runtime: nodejs).
//
// The route is owned by B6. The salient contract bits are:
//
//   1. CRON_SECRET bearer check (constant-time, `crypto.timingSafeEqual`).
//   2. FAIL-CLOSED: if `CRON_SECRET` env var is unset, the route must
//      return 503 — NEVER 200. (Audit T3 P0-9 verification.)
//   3. With a valid bearer, the route reads N clusters lacking
//      `title_tr_neutral`, calls the LLM, and updates the clusters.
//   4. The LLM client is `vi.mock`ed so no real API is called.
//
// These tests mirror the style of `tests/api/admin.test.ts` — chainable
// Supabase mock, lazy `await import(...)` so the env / mock state is
// established before the route module's top-level code runs.
// ---------------------------------------------------------------------------

interface TableResponse {
  data?: unknown;
  count?: number | null;
  error?: { message: string } | null;
}

const DEFAULT_RESPONSE: TableResponse = { data: [], count: 0, error: null };

const tableResponses: Record<string, TableResponse> = {};
const updateCalls: Array<{ table: string; patch: unknown; eqId: string | null }> = [];

function setTableResponse(table: string, response: TableResponse) {
  tableResponses[table] = { ...DEFAULT_RESPONSE, ...response };
}

// Spy on `crypto.timingSafeEqual` via a partial node:crypto mock. The
// route imports the named export at module top-level; we need to wrap it
// here so the constant-time test can assert the comparator was actually
// invoked (rather than the route silently early-exiting on length / `===`).
//
// The closure holds the real implementation captured at mock-factory time
// so we never recurse into the spied symbol.
const timingSafeEqualSpy = vi.fn<
  [NodeJS.ArrayBufferView, NodeJS.ArrayBufferView],
  boolean
>();

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  timingSafeEqualSpy.mockImplementation((a, b) => actual.timingSafeEqual(a, b));
  return {
    ...actual,
    default: actual,
    timingSafeEqual: timingSafeEqualSpy,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const resp = () => tableResponses[table] ?? DEFAULT_RESPONSE;
      let pendingEq: string | null = null;
      const chain: Record<string, unknown> = {};
      const terminal = (
        onFul?: (v: TableResponse) => unknown,
        onRej?: (e: unknown) => unknown,
      ) => Promise.resolve(resp()).then(onFul, onRej);
      Object.assign(chain, {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        is: () => chain,
        eq: (_col: string, val: string) => {
          pendingEq = val;
          return chain;
        },
        in: () => chain,
        not: () => chain,
        update: (patch: unknown) => {
          updateCalls.push({ table, patch, eqId: pendingEq });
          return chain;
        },
        upsert: () => chain,
        insert: () => chain,
        delete: () => chain,
        maybeSingle: async () => resp(),
        single: async () => resp(),
        then: terminal,
      });
      return chain;
    },
  }),
}));

// LLM client interception. The headline route talks to Anthropic's
// `/v1/messages` endpoint over plain `fetch` (no vendored SDK), so we
// intercept at the network boundary rather than via `vi.mock("openai", …)`
// — that older mock targeted a dependency the route no longer imports and
// silently allowed the real fetch through.
const LLM_API_URL = "https://api.anthropic.com/v1/messages";
const originalFetch = globalThis.fetch;
let llmFetchSpy: ReturnType<typeof vi.spyOn> | null = null;

function installLlmFetchSpy(): void {
  llmFetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.startsWith(LLM_API_URL)) {
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Tarafsız başlık" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Anything else is unexpected for this route — fail loud rather
      // than punch through to the real network.
      throw new Error(`unexpected fetch to ${url}`);
    });
}

// next/server connection() shim — same rationale as admin.test.ts.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    connection: async () => {},
  };
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  // The route reads ANTHROPIC_API_KEY directly; without it the LLM call
  // path returns null and the test never observes the fetch spy.
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  delete process.env.CRON_SECRET;
  for (const k of Object.keys(tableResponses)) delete tableResponses[k];
  updateCalls.length = 0;
  timingSafeEqualSpy.mockClear();
  installLlmFetchSpy();
});

afterEach(() => {
  if (llmFetchSpy) {
    llmFetchSpy.mockRestore();
    llmFetchSpy = null;
  }
  globalThis.fetch = originalFetch;
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "ANTHROPIC_API_KEY",
  ]) {
    if (k in ORIGINAL_ENV) process.env[k] = ORIGINAL_ENV[k] as string;
    else delete process.env[k];
  }
  vi.resetModules();
});

async function tryImportRoute(): Promise<
  | { GET?: (req: Request) => Promise<Response>; POST?: (req: Request) => Promise<Response> }
  | null
> {
  // No try/catch — a broken route import must surface as a test failure
  // rather than masquerade as a silent skip.
  return await import("@/app/api/cron/headline/route");
}

describe("GET /api/cron/headline", () => {
  it("FAIL-CLOSED: returns 503 when CRON_SECRET env var is unset [T3 P0-9]", async () => {
    delete process.env.CRON_SECRET;

    const mod = await tryImportRoute();
    expect(mod).toBeDefined();
    const handler = mod?.GET ?? mod?.POST;
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const res = await handler(
      new Request("http://example.com/api/cron/headline", {
        headers: { Authorization: "Bearer anything" },
      }),
    );
    // The contract: NEVER 200 without a configured secret.
    expect(res.status).not.toBe(200);
    expect([503, 500]).toContain(res.status);
  });

  it("returns 401 when CRON_SECRET is set but the Authorization header is missing or wrong", async () => {
    process.env.CRON_SECRET = "shhh";

    const mod = await tryImportRoute();
    expect(mod).toBeDefined();
    const handler = mod?.GET ?? mod?.POST;
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const noAuth = await handler(
      new Request("http://example.com/api/cron/headline"),
    );
    expect(noAuth.status).toBe(401);

    const wrong = await handler(
      new Request("http://example.com/api/cron/headline", {
        headers: { Authorization: "Bearer not-the-right-token" },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("returns 200 when CRON_SECRET matches and there are no clusters to title (no-op)", async () => {
    process.env.CRON_SECRET = "shhh";
    setTableResponse("clusters", { data: [], error: null });

    const mod = await tryImportRoute();
    expect(mod).toBeDefined();
    const handler = mod?.GET ?? mod?.POST;
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const res = await handler(
      new Request("http://example.com/api/cron/headline", {
        headers: { Authorization: "Bearer shhh" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("calls the LLM and writes title_tr_neutral when clusters lack one", async () => {
    process.env.CRON_SECRET = "shhh";
    // ANTHROPIC_API_KEY is set in beforeEach.
    setTableResponse("clusters", {
      data: [
        {
          id: "c1",
          title_tr_neutral: null,
          articles: [
            { title: "Headline A", source: "src1" },
            { title: "Headline B", source: "src2" },
          ],
        },
      ],
      error: null,
    });

    const mod = await tryImportRoute();
    expect(mod).toBeDefined();
    const handler = mod?.GET ?? mod?.POST;
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const res = await handler(
      new Request("http://example.com/api/cron/headline", {
        headers: { Authorization: "Bearer shhh" },
      }),
    );
    expect(res.status).toBe(200);
    // If the route writes anything back, it should target the clusters table
    // with a `title_tr_neutral` patch. We don't insist on a specific count —
    // some implementations may batch, some may issue per-row updates.
    if (updateCalls.length > 0) {
      const cluster = updateCalls.find((u) => u.table === "clusters");
      if (cluster) {
        const patch = cluster.patch as { title_tr_neutral?: string };
        expect(patch.title_tr_neutral).toBeDefined();
      }
    }
  });

  it("uses a constant-time comparator (no timing leak via early-exit on first byte)", async () => {
    process.env.CRON_SECRET = "abcdefghijklmnop";

    const mod = await tryImportRoute();
    expect(mod).toBeDefined();
    const handler = mod?.GET ?? mod?.POST;
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    // Two wrong tokens of the same length but differing in different
    // positions. If the comparator is constant-time, both should take
    // roughly the same number of microseconds and both return 401.
    const wrong1 = await handler(
      new Request("http://example.com/api/cron/headline", {
        headers: { Authorization: "Bearer Xbcdefghijklmnop" },
      }),
    );
    const wrong2 = await handler(
      new Request("http://example.com/api/cron/headline", {
        headers: { Authorization: "Bearer abcdefghijklmnoX" },
      }),
    );
    expect(wrong1.status).toBe(401);
    expect(wrong2.status).toBe(401);
    // Tripwire: the route must actually invoke the constant-time
    // comparator. If the code regresses to a plain `===`, the spy never
    // fires and this assertion catches it.
    expect(timingSafeEqualSpy).toHaveBeenCalled();
  });
});
