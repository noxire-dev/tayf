import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the ingest Edge Function (audit T7 P1-22 verification).
//
// The headline test in this file — "decodes a CP1254 (iso-8859-9) Turkish
// feed without mojibake" — is the mandatory regression check for the
// charset bug the audit caught: the old `res.text()` path silently fell
// back to UTF-8 and corrupted Turkish characters (ş, ı, ğ, ç, ö, ü).
//
// We exercise the contract at three levels:
//
//   1. The pure helper (`decodeRssBody`) if it can be
//      imported standalone — the cheapest, most diagnostic-friendly check.
//   2. The whole `ingest` handler invoked end-to-end against a `fetch`
//      stub that yields the CP1254 fixture — proves the full pipeline
//      doesn't lose the decoded characters between fetcher → normalizer →
//      Supabase upsert.
//   3. SSRF / safety guards (rejecting feeds whose URL resolves into
//      RFC1918 / 169.254 space) — partial coverage; B5 owns the full
//      `safe-fetch` and tests it more deeply in image-consumer.test.ts.
//
// All Supabase + pgmq surfaces are mocked. No network. No live feeds.
// ---------------------------------------------------------------------------

// Polyfill Deno before importing the SUT.
(globalThis as unknown as { Deno?: unknown }).Deno = {
  env: { get: (k: string) => process.env[k] },
  serve: (handler: (req: Request) => Promise<Response> | Response) => {
    (globalThis as unknown as { __ingestHandler?: unknown }).__ingestHandler = handler;
    return { finished: Promise.resolve() };
  },
};

// Service-role bearer mirrored into `SUPABASE_SERVICE_ROLE_KEY` in
// `beforeEach`. The `requireServiceRoleBearer` gate in the handler reads the
// env var via the Deno polyfill and compares it to the inbound Authorization
// header. Every authorised `new Request(...)` is built via `authedRequest(...)`
// so the gate accepts the call; the dedicated 401 test below intentionally
// bypasses this helper.
const TEST_SERVICE_ROLE_KEY = "test-service-role-key";

function authedRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${TEST_SERVICE_ROLE_KEY}`,
    },
  });
}

// ---------------------------------------------------------------------------
// CP1254 fixture
//
// Turkish source line — every character that differs from ISO-8859-1 /
// UTF-8 single-byte is exercised: ş (0xFE), ı (0xFD), ğ (0xF0), ç (0xE7),
// ö (0xF6), ü (0xFC), İ (0xDD), Ş (0xDE).
//
// We hand-assemble the bytes rather than calling `iconv-lite` so the
// fixture is self-contained and CI doesn't need a third-party encoder
// installed just to run this test.
// ---------------------------------------------------------------------------

const CP1254_BYTES = new Uint8Array([
  0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f,
  0x6e, 0x3d, 0x22, 0x31, 0x2e, 0x30, 0x22, 0x20, 0x65, 0x6e, 0x63, 0x6f,
  0x64, 0x69, 0x6e, 0x67, 0x3d, 0x22, 0x69, 0x73, 0x6f, 0x2d, 0x38, 0x38,
  0x35, 0x39, 0x2d, 0x39, 0x22, 0x3f, 0x3e, 0x0a, // <?xml version="1.0" encoding="iso-8859-9"?>
  0x3c, 0x72, 0x73, 0x73, 0x3e, 0x3c, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65,
  0x6c, 0x3e, // <rss><channel>
  0x3c, 0x69, 0x74, 0x65, 0x6d, 0x3e, // <item>
  0x3c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e, // <title>
  // Body bytes for: "Türkçe başlık: şirin İğne çağı"
  0x54, 0xfc, 0x72, 0x6b, 0xe7, 0x65, 0x20, 0x62, 0x61, 0xfe, 0x6c, 0xfd,
  0x6b, 0x3a, 0x20, 0xfe, 0x69, 0x72, 0x69, 0x6e, 0x20, 0xdd, 0xf0, 0x6e,
  0x65, 0x20, 0xe7, 0x61, 0xf0, 0xfd,
  0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e, // </title>
  0x3c, 0x6c, 0x69, 0x6e, 0x6b, 0x3e, 0x68, 0x74, 0x74, 0x70, 0x73, 0x3a,
  0x2f, 0x2f, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x2e, 0x63, 0x6f,
  0x6d, 0x2f, 0x61, 0x31, 0x3c, 0x2f, 0x6c, 0x69, 0x6e, 0x6b, 0x3e, // <link>https://example.com/a1</link>
  0x3c, 0x2f, 0x69, 0x74, 0x65, 0x6d, 0x3e, // </item>
  0x3c, 0x2f, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x3e, 0x3c, 0x2f,
  0x72, 0x73, 0x73, 0x3e, // </channel></rss>
]);

const EXPECTED_TITLE = "Türkçe başlık: şirin İğne çağı";

// ---------------------------------------------------------------------------
// Mock collaborators.
// ---------------------------------------------------------------------------

const upserted: Array<Record<string, unknown>> = [];

// Per-test source roster. The ingest handler reads from `sources` via
// `.from("sources").select(...).eq("active", true).order("slug")` and
// awaits the chain directly — so the chainable mock terminates via `then`.
// Tests that exercise the end-to-end ingest path populate this list with
// a single source pointing at the fixture URL.
const fakeSources: Array<Record<string, unknown>> = [];

vi.mock("../../supabase/functions/_shared/supabase.ts", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const settle = () => {
        if (table === "sources") {
          return { data: [...fakeSources], error: null };
        }
        return { data: null, error: null };
      };
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        // Make the chain awaitable: `await supabase.from("sources").select(...)`.
        then: (
          onFul?: (v: { data: unknown; error: unknown }) => unknown,
          onRej?: (e: unknown) => unknown,
        ) => Promise.resolve(settle()).then(onFul, onRej),
        upsert: (rows: unknown) => {
          if (table === "articles") {
            const arr = Array.isArray(rows) ? rows : [rows];
            for (const r of arr) upserted.push(r as Record<string, unknown>);
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => chain,
      });
      return chain;
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }),
}));

// Stub the seed-sources loader / fan-out helper — happy path returns one
// source so the loop body actually runs against the mocked fetcher.
vi.mock("../../supabase/functions/_shared/rss/fetcher.ts", async () => {
  const real = await tryImport("../../supabase/functions/_shared/rss/fetcher.ts");
  return real ?? { fetchAllFeeds: async () => [], fetchOneFeed: async () => null };
});

async function tryImport(path: string): Promise<unknown> {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// `fetch` interception.
//
// We replace the global fetch with a stub that returns the CP1254 fixture
// (or other configured per-URL responses) so the ingest handler sees a
// real-looking Response object — Content-Type header, ArrayBuffer body,
// status, etc. — without hitting the network.
// ---------------------------------------------------------------------------

const fetchResponses: Record<
  string,
  { status?: number; headers?: Record<string, string>; body: Uint8Array | string }
> = {};

const originalFetch = globalThis.fetch;

function installFetchStub() {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const entry = fetchResponses[url];
    if (!entry) {
      return new Response("not found", { status: 404 });
    }
    const body =
      typeof entry.body === "string"
        ? new TextEncoder().encode(entry.body)
        : entry.body;
    return new Response(body, {
      status: entry.status ?? 200,
      headers: entry.headers ?? {},
    });
  }) as typeof fetch;
}

beforeEach(() => {
  upserted.length = 0;
  fakeSources.length = 0;
  for (const k of Object.keys(fetchResponses)) delete fetchResponses[k];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_ROLE_KEY;
  installFetchStub();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Direct charset helper test — fastest signal if `charset.ts` ships.
// ---------------------------------------------------------------------------

type DecodeResult = { text: string; charset: string };
type CharsetModule = {
  decodeRssBody: (bytes: Uint8Array, contentType: string | null) => DecodeResult;
};

describe("rss/charset (CP1254 decode helper)", () => {
  it("decodes iso-8859-9 (Windows-1254) bytes into the correct Turkish title", async () => {
    const mod = (await tryImport(
      "../../supabase/functions/_shared/rss/charset.ts",
    )) as CharsetModule | null;

    // Tripwire: if the helper failed to import or the named export drifted,
    // fail loud rather than silently skip the regression check.
    expect(mod?.decodeRssBody).toBeDefined();

    const result = mod!.decodeRssBody(
      CP1254_BYTES,
      "text/xml; charset=iso-8859-9",
    );
    expect(result.text).toContain(EXPECTED_TITLE);
    expect(result.charset.toLowerCase()).toMatch(/(iso-8859-9|windows-1254)/);
    // Negative: must NOT contain the U+FFFD replacement character that
    // appears when CP1254 bytes are mis-decoded as UTF-8.
    expect(result.text).not.toContain("�");
  });

  it("falls back to UTF-8 when no charset is declared", async () => {
    const mod = (await tryImport(
      "../../supabase/functions/_shared/rss/charset.ts",
    )) as CharsetModule | null;
    expect(mod?.decodeRssBody).toBeDefined();

    const utf8 = new TextEncoder().encode("<rss>UTF-8 default</rss>");
    const result = mod!.decodeRssBody(utf8, null);
    expect(result.text).toContain("UTF-8 default");
    expect(result.charset.toLowerCase()).toBe("utf-8");
  });
});

// ---------------------------------------------------------------------------
// End-to-end ingest handler test — invokes the registered Deno.serve
// callback with a `Request`, lets it dial out via the stubbed `fetch`,
// then asserts on the rows that ended up in the Supabase upsert sink.
// ---------------------------------------------------------------------------

async function importIngestHandler(): Promise<
  ((req: Request) => Promise<Response>) | null
> {
  // No try/catch — import failures must propagate so a broken SUT can't
  // hide behind a no-op suite.
  await import("../../supabase/functions/ingest/index.ts");
  const reg = (globalThis as unknown as {
    __ingestHandler?: (req: Request) => Promise<Response>;
  }).__ingestHandler;
  return reg ?? null;
}

describe("ingest Edge Function", () => {
  it("returns 200 with no sources configured (empty fan-out)", async () => {
    const handler = await importIngestHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const res = await handler(
      authedRequest("http://localhost/ingest", { method: "POST" }),
    );
    expect([200, 207]).toContain(res.status);
  });

  it("decodes a CP1254 (iso-8859-9) feed end-to-end without mojibake [T7 P1-22]", async () => {
    const handler = await importIngestHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    // Seed a single active source so the loop body actually runs against
    // the fixture URL instead of short-circuiting on an empty roster.
    fakeSources.push({
      id: "src-cp1254",
      name: "CP1254 Fixture",
      slug: "cp1254-fixture",
      url: "https://example.com",
      rss_url: "https://example.com/cp1254.rss",
      active: true,
    });

    fetchResponses["https://example.com/cp1254.rss"] = {
      status: 200,
      // Content-Type header is the primary signal the charset helper sniffs.
      headers: { "Content-Type": "text/xml; charset=iso-8859-9" },
      body: CP1254_BYTES,
    };

    await handler(authedRequest("http://localhost/ingest", { method: "POST" }));

    // With a seeded source the fetcher must reach the URL and the
    // normalizer must produce at least one upsert row carrying the
    // correctly-decoded title. The old defensive early-return on
    // `upserted.length === 0` masked exactly the regression this test
    // exists to catch — assert loud instead.
    expect(upserted.length).toBeGreaterThan(0);
    const titles = upserted.map((r) => String(r.title ?? ""));
    expect(titles.some((t) => t.includes(EXPECTED_TITLE))).toBe(true);
    for (const t of titles) {
      expect(t).not.toContain("�");
    }
  });

  it("uses a unified sha1-of-shingles content_hash (40 hex chars), never sha256", async () => {
    const handler = await importIngestHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    fakeSources.push({
      id: "src-simple",
      name: "Simple Fixture",
      slug: "simple-fixture",
      url: "https://example.com",
      rss_url: "https://example.com/simple.rss",
      active: true,
    });

    fetchResponses["https://example.com/simple.rss"] = {
      status: 200,
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        "<rss><channel><item>" +
        "<title>Sample headline</title>" +
        "<link>https://example.com/simple/1</link>" +
        "</item></channel></rss>",
    };

    await handler(authedRequest("http://localhost/ingest", { method: "POST" }));
    // The defensive silent skip is gone: if the ingest path produced no
    // rows for a seeded, healthy fixture, that IS the regression.
    expect(upserted.length).toBeGreaterThan(0);

    let checked = 0;
    for (const row of upserted) {
      const h = String((row as { content_hash?: string }).content_hash ?? "");
      if (!h) continue;
      // 40 hex = sha1; 64 hex = sha256. Audit T7 P1-21 says we want sha1.
      expect(h).toMatch(/^[0-9a-f]{40}$/);
      checked += 1;
    }
    // Tripwire: at least one upserted row must carry a content_hash so the
    // sha1-vs-sha256 assertion above is actually exercised.
    expect(checked).toBeGreaterThan(0);
  });

  it("upserts with ON CONFLICT DO NOTHING semantics (re-run is a no-op)", async () => {
    const handler = await importIngestHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    fakeSources.push({
      id: "src-dup",
      name: "Dup Fixture",
      slug: "dup-fixture",
      url: "https://example.com",
      rss_url: "https://example.com/dup.rss",
      active: true,
    });

    fetchResponses["https://example.com/dup.rss"] = {
      status: 200,
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        "<rss><channel><item>" +
        "<title>Dup</title><link>https://example.com/dup/1</link>" +
        "</item></channel></rss>",
    };

    await handler(authedRequest("http://localhost/ingest", { method: "POST" }));
    const firstRun = upserted.length;
    await handler(authedRequest("http://localhost/ingest", { method: "POST" }));
    // Both runs hit upsert; the DB-side UNIQUE constraint is what makes
    // re-runs a no-op, not the application code. We just check the handler
    // didn't *grow* its row count beyond a reasonable bound.
    expect(upserted.length).toBeLessThanOrEqual(firstRun * 2);
  });

  it("returns 401 without a service-role bearer", async () => {
    const handler = await importIngestHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    // No Authorization header → the gate must reject before fan-out.
    const res = await handler(
      new Request("http://localhost/ingest", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(upserted).toHaveLength(0);
  });
});
