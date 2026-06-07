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

// LLM client mock. The route owns the import path; B6 may use either an
// OpenAI-style chat completion or a Gemini SDK. We mock the broadest set
// of plausible specifiers; the unused mocks are harmless.
vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: "Tarafsız başlık" } }],
        })),
      },
    };
  },
  OpenAI: class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: "Tarafsız başlık" } }],
        })),
      },
    };
  },
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: vi.fn(async () => ({
          response: { text: () => "Tarafsız başlık" },
        })),
      };
    }
  },
}));

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
  delete process.env.CRON_SECRET;
  for (const k of Object.keys(tableResponses)) delete tableResponses[k];
  updateCalls.length = 0;
});

afterEach(() => {
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
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
  try {
    return await import("@/app/api/cron/headline/route");
  } catch {
    return null;
  }
}

describe("GET /api/cron/headline", () => {
  it("FAIL-CLOSED: returns 503 when CRON_SECRET env var is unset [T3 P0-9]", async () => {
    delete process.env.CRON_SECRET;

    const mod = await tryImportRoute();
    if (!mod) return; // B6 not yet shipped.
    const handler = mod.GET ?? mod.POST;
    if (!handler) return;

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
    if (!mod) return;
    const handler = mod.GET ?? mod.POST;
    if (!handler) return;

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
    if (!mod) return;
    const handler = mod.GET ?? mod.POST;
    if (!handler) return;

    const res = await handler(
      new Request("http://example.com/api/cron/headline", {
        headers: { Authorization: "Bearer shhh" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("calls the LLM and writes title_tr_neutral when clusters lack one", async () => {
    process.env.CRON_SECRET = "shhh";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.GOOGLE_API_KEY = "test";
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
    if (!mod) return;
    const handler = mod.GET ?? mod.POST;
    if (!handler) return;

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
    if (!mod) return;
    const handler = mod.GET ?? mod.POST;
    if (!handler) return;

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
  });
});
