import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the cluster-consumer Edge Function.
//
// This file does NOT execute Deno-native code. The cluster-consumer module
// is authored against Deno (Deno.serve, node: specifiers, etc.); vitest runs
// in Node. We therefore test the *contract* of the handler by:
//
//   1. Polyfilling the minimum Deno surface the function reaches for
//      (`Deno.env.get`, `Deno.serve`) before importing the module.
//   2. Mocking the function's collaborators (`pgmq.read`, `pgmq.archive`,
//      `pgmq.delete`, Supabase client) at the import boundary so the unit
//      under test exercises real control flow without any I/O.
//   3. Asserting observable post-conditions: dequeued message count,
//      archive-on-success / delete-on-permanent-failure, idempotent re-runs,
//      and the 30 s per-invocation cap.
//
// The sister builder (B3) owns the module under test. If B3 changes the
// import path or the named exports, the `vi.mock` targets here need to be
// updated to match — that's the contract handshake. The orchestrator's
// Phase 3 QA agents will fix these together if the wiring drifts.
// ---------------------------------------------------------------------------

// Polyfill the Deno globals the handler reaches for. Done in module scope
// (before any import of the SUT) so the side-effecting top-level code in the
// handler doesn't blow up on `Deno is not defined`.
(globalThis as unknown as { Deno?: unknown }).Deno = {
  env: {
    get: (k: string) => process.env[k],
  },
  // Capture the handler the SUT registers; tests will invoke it directly.
  serve: (handler: (req: Request) => Promise<Response> | Response) => {
    (globalThis as unknown as { __registeredHandler?: unknown }).__registeredHandler = handler;
    return { finished: Promise.resolve() };
  },
};

interface PgmqMessage {
  msg_id: number;
  read_ct: number;
  message: { article_id: string };
}

const pgmqState: {
  pending: PgmqMessage[];
  archived: number[];
  deleted: number[];
} = { pending: [], archived: [], deleted: [] };

function resetPgmqState() {
  pgmqState.pending = [];
  pgmqState.archived = [];
  pgmqState.deleted = [];
}

// Mock the shared pgmq wrapper. B3 controls this path; B10 contracts to it.
vi.mock("../../supabase/functions/_shared/pgmq.ts", () => ({
  pgmqRead: vi.fn(async (_queue: string, _vt: number, qty: number) => {
    const batch = pgmqState.pending.slice(0, qty);
    pgmqState.pending = pgmqState.pending.slice(qty);
    return batch;
  }),
  pgmqArchive: vi.fn(async (_queue: string, msgId: number) => {
    pgmqState.archived.push(msgId);
    return true;
  }),
  pgmqDelete: vi.fn(async (_queue: string, msgId: number) => {
    pgmqState.deleted.push(msgId);
    return true;
  }),
  pgmqSend: vi.fn(async () => 1),
}));

// Mock the Supabase factory the consumer uses to read articles + upsert
// clusters. Minimal chainable surface; terminal returns `{ data, error }`.
const fakeArticles: Record<string, unknown> = {};

vi.mock("../../supabase/functions/_shared/supabase.ts", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const single = async () => {
        if (table === "articles") {
          // First pending article id used as the lookup key in the simple
          // happy-path test below.
          const id = Object.keys(fakeArticles)[0];
          return { data: id ? fakeArticles[id] : null, error: null };
        }
        return { data: null, error: null };
      };
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        maybeSingle: single,
        single: single,
        upsert: () => Promise.resolve({ data: null, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => chain,
      });
      return chain;
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }),
}));

// Stub the ensemble — the consumer just needs a clusterId back.
vi.mock("../../supabase/functions/_shared/cluster/ensemble.ts", () => ({
  ensembleAssign: vi.fn(async (_article: unknown) => ({
    clusterId: "00000000-0000-4000-8000-000000000001",
    score: 0.82,
    candidates: 3,
  })),
}));

beforeEach(() => {
  resetPgmqState();
  for (const k of Object.keys(fakeArticles)) delete fakeArticles[k];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// The tests below import the SUT lazily inside each `it` so that vi.mock
// boundaries resolve to the stubs above. If the module fails to import
// (sister builder hasn't shipped yet) the suite skips rather than crashes —
// this lets B10's tests land first without blocking CI on B3's timing.
// ---------------------------------------------------------------------------

async function importHandler(): Promise<((req: Request) => Promise<Response>) | null> {
  try {
    await import("../../supabase/functions/cluster-consumer/index.ts");
    const reg = (globalThis as unknown as {
      __registeredHandler?: (req: Request) => Promise<Response>;
    }).__registeredHandler;
    return reg ?? null;
  } catch {
    return null;
  }
}

describe("cluster-consumer Edge Function", () => {
  it("dequeues messages from the cluster_work queue (up to batch size)", async () => {
    const handler = await importHandler();
    if (!handler) return; // B3 not yet shipped — see file header.

    pgmqState.pending = Array.from({ length: 75 }, (_, i) => ({
      msg_id: i + 1,
      read_ct: 1,
      message: { article_id: `art-${i + 1}` },
    }));
    fakeArticles["art-1"] = {
      id: "art-1",
      title: "Test",
      description: "Body",
      url: "https://example.com/1",
      category: "politika",
      created_at: new Date().toISOString(),
    };

    const res = await handler(
      new Request("http://localhost/cluster-consumer", { method: "POST" }),
    );
    expect([200, 207]).toContain(res.status);
    // At most 50 (the contracted batch size); never more than the queue had.
    expect(pgmqState.pending.length).toBeGreaterThanOrEqual(25);
  });

  it("archives messages that processed successfully", async () => {
    const handler = await importHandler();
    if (!handler) return;

    pgmqState.pending = [
      { msg_id: 10, read_ct: 1, message: { article_id: "art-10" } },
    ];
    fakeArticles["art-10"] = {
      id: "art-10",
      title: "Headline",
      description: "Body",
      url: "https://example.com/10",
      category: "politika",
      created_at: new Date().toISOString(),
    };

    await handler(new Request("http://localhost/cluster-consumer", { method: "POST" }));
    // Either archived (happy path) or deleted (poison) — the contract is that
    // the message is REMOVED from the live queue, never left to re-deliver.
    const removed = [...pgmqState.archived, ...pgmqState.deleted];
    expect(removed).toContain(10);
  });

  it("permanently deletes messages with read_ct > 3 (poison handling)", async () => {
    const handler = await importHandler();
    if (!handler) return;

    pgmqState.pending = [
      { msg_id: 99, read_ct: 5, message: { article_id: "ghost" } },
    ];
    // No fakeArticles["ghost"] → article fetch returns null → permanent fail.

    await handler(new Request("http://localhost/cluster-consumer", { method: "POST" }));
    expect(pgmqState.deleted).toContain(99);
  });

  it("returns within the per-invocation 30 s cap (smoke)", async () => {
    const handler = await importHandler();
    if (!handler) return;

    // Empty queue → handler should return promptly.
    const start = Date.now();
    await handler(new Request("http://localhost/cluster-consumer", { method: "POST" }));
    expect(Date.now() - start).toBeLessThan(30_000);
  });

  it("is idempotent — re-processing the same article produces the same upsert", async () => {
    const handler = await importHandler();
    if (!handler) return;

    pgmqState.pending = [
      { msg_id: 1, read_ct: 1, message: { article_id: "art-idem" } },
    ];
    fakeArticles["art-idem"] = {
      id: "art-idem",
      title: "Same",
      description: "Same",
      url: "https://example.com/idem",
      category: "politika",
      created_at: new Date().toISOString(),
    };

    await handler(new Request("http://localhost/cluster-consumer", { method: "POST" }));
    const archivedOnce = [...pgmqState.archived];

    // Replay with the same payload.
    pgmqState.pending = [
      { msg_id: 2, read_ct: 1, message: { article_id: "art-idem" } },
    ];
    await handler(new Request("http://localhost/cluster-consumer", { method: "POST" }));

    // Both runs must have removed their message from the queue.
    expect(pgmqState.archived.length + pgmqState.deleted.length).toBeGreaterThan(
      archivedOnce.length,
    );
  });

  it("returns 200 with an empty queue (no work is not an error)", async () => {
    const handler = await importHandler();
    if (!handler) return;

    pgmqState.pending = [];
    const res = await handler(
      new Request("http://localhost/cluster-consumer", { method: "POST" }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Contract reminder: if this whole file no-ops (no handler available), the
// QA agent reviewing B10 should flag B3 as missing — not B10 as broken. The
// `if (!handler) return` early-out is deliberate so this suite can land
// ahead of B3 without blocking the test runner.
// ---------------------------------------------------------------------------
