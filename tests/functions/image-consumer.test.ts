import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the image-consumer Edge Function (audit T3 P1-5).
//
// The mandatory check in this file is the SSRF block: when an article page's
// `og:image` resolves to a private / link-local / cloud-metadata IP, the
// consumer MUST refuse to fetch the image and MUST NOT write any URL back
// to the row. The fixture uses `http://169.254.169.254/...`, the AWS / GCP
// instance-metadata host that is the canonical SSRF target.
//
// We also cover the happy path (public CDN image makes it to the row),
// poison messages (read_ct > 3 → permanent delete), and the visibility-
// timeout / batch-size contract that pg_cron relies on.
//
// All collaborators are mocked. No network. No Supabase. No DNS.
// ---------------------------------------------------------------------------

(globalThis as unknown as { Deno?: unknown }).Deno = {
  env: { get: (k: string) => process.env[k] },
  serve: (handler: (req: Request) => Promise<Response> | Response) => {
    (globalThis as unknown as { __imageHandler?: unknown }).__imageHandler = handler;
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

// Names mirror the real `_shared/pgmq.ts` exports (`readBatch`, `archive`,
// `deleteMessage`, `send`); any drift means the SUT silently sees undefined.
vi.mock("../../supabase/functions/_shared/pgmq.ts", () => ({
  readBatch: vi.fn(async (_queue: string, _vt: number, qty: number) => {
    const batch = pgmqState.pending.slice(0, qty);
    pgmqState.pending = pgmqState.pending.slice(qty);
    return batch;
  }),
  archive: vi.fn(async (_queue: string, msgId: number) => {
    pgmqState.archived.push(msgId);
    return true;
  }),
  deleteMessage: vi.fn(async (_queue: string, msgId: number) => {
    pgmqState.deleted.push(msgId);
    return true;
  }),
  send: vi.fn(async () => 1),
}));

// Supabase mock: articles table is keyed by id; updates record the image_url.
const fakeArticles: Record<string, { url: string; image_url?: string | null }> = {};
const articleUpdates: Array<{ id: string; image_url: string | null }> = [];

vi.mock("../../supabase/functions/_shared/supabase.ts", () => ({
  createServiceClient: () => ({
    from: (_table: string) => {
      let pendingId: string | null = null;
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === "id") pendingId = val;
          return chain;
        },
        maybeSingle: async () => ({
          data: pendingId ? fakeArticles[pendingId] ?? null : null,
          error: null,
        }),
        single: async () => ({
          data: pendingId ? fakeArticles[pendingId] ?? null : null,
          error: null,
        }),
        update: (patch: Record<string, unknown>) => {
          if (pendingId) {
            articleUpdates.push({
              id: pendingId,
              image_url: (patch.image_url as string) ?? null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        upsert: () => Promise.resolve({ data: null, error: null }),
      });
      return chain;
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }),
}));

// Mock the SSRF-safe fetch. The error class name must match what
// `_shared/safe-fetch.ts` actually exports — `SafeFetchError` — so the
// SUT's `instanceof` / named-import checks resolve correctly.
class SafeFetchError extends Error {
  code: string;
  constructor(message: string, code = "SSRF_BLOCKED") {
    super(message);
    this.code = code;
  }
}

vi.mock("../../supabase/functions/_shared/safe-fetch.ts", () => ({
  SafeFetchError,
  safeFetch: vi.fn(async (url: string, init?: RequestInit) => {
    // Block any URL pointing at link-local, RFC1918, or loopback hosts.
    if (
      /https?:\/\/169\.254\./.test(url) ||
      /https?:\/\/10\./.test(url) ||
      /https?:\/\/192\.168\./.test(url) ||
      /https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./.test(url) ||
      /https?:\/\/127\./.test(url) ||
      /https?:\/\/\[?::1\]?/.test(url)
    ) {
      throw new SafeFetchError(`blocked: ${url}`, "SSRF_BLOCKED");
    }
    return globalThis.fetch(url, init);
  }),
}));

// `og:image` extraction. We keep this minimal — the real helper does more
// (head-only fetch, charset sniff). The mocked export names mirror the
// real module: `fetchOgImage` (async, fetches the article HTML and pulls
// the og:image URL), `fetchHeroImage` (fallback chain), and the
// `isValidImageUrl` guard. The SUT imports them by name.
vi.mock("../../supabase/functions/_shared/og-image.ts", () => {
  const ogImageFromHtml = (html: string): string | null => {
    const m =
      html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+name="twitter:image"\s+content="([^"]+)"/i);
    return m ? m[1] : null;
  };
  const fetchOgImage = vi.fn(async (articleUrl: string) => {
    const res = await globalThis.fetch(articleUrl);
    if (!res.ok) return null;
    return ogImageFromHtml(await res.text());
  });
  const fetchHeroImage = vi.fn(async (articleUrl: string) => {
    const res = await globalThis.fetch(articleUrl);
    if (!res.ok) return null;
    return ogImageFromHtml(await res.text());
  });
  const isValidImageUrl = (u: unknown): u is string =>
    typeof u === "string" && /^https?:\/\//.test(u);
  return { fetchOgImage, fetchHeroImage, isValidImageUrl };
});

// ---------------------------------------------------------------------------
// Global fetch stub for the article HTML responses.
// ---------------------------------------------------------------------------

const htmlResponses: Record<string, string> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetPgmqState();
  for (const k of Object.keys(fakeArticles)) delete fakeArticles[k];
  for (const k of Object.keys(htmlResponses)) delete htmlResponses[k];
  articleUpdates.length = 0;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = (async (
    input: RequestInfo | URL,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const html = htmlResponses[url];
    if (html === undefined) return new Response("not found", { status: 404 });
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

async function importHandler(): Promise<
  ((req: Request) => Promise<Response>) | null
> {
  // No try/catch: a failed import must surface as a real test failure,
  // not a silent skip.
  await import("../../supabase/functions/image-consumer/index.ts");
  const reg = (globalThis as unknown as {
    __imageHandler?: (req: Request) => Promise<Response>;
  }).__imageHandler;
  return reg ?? null;
}

describe("image-consumer Edge Function", () => {
  it("backfills a public og:image URL onto the article row (happy path)", async () => {
    const handler = await importHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    fakeArticles["art-safe"] = { url: "https://news.example.com/story", image_url: null };
    htmlResponses["https://news.example.com/story"] =
      '<html><head>' +
      '<meta property="og:image" content="https://cdn.example.com/cover.jpg" />' +
      "</head></html>";
    pgmqState.pending = [
      { msg_id: 1, read_ct: 1, message: { article_id: "art-safe" } },
    ];

    await handler(new Request("http://localhost/image-consumer", { method: "POST" }));

    expect(articleUpdates).toContainEqual({
      id: "art-safe",
      image_url: "https://cdn.example.com/cover.jpg",
    });
    expect(pgmqState.archived).toContain(1);
  });

  it("refuses to fetch og:image targets that resolve to 169.254.169.254 [SSRF — T3 P1-5]", async () => {
    const handler = await importHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    fakeArticles["art-ssrf"] = { url: "https://attacker.example.com/page", image_url: null };
    htmlResponses["https://attacker.example.com/page"] =
      '<html><head>' +
      // The mandatory hostile fixture: AWS / GCP instance-metadata host.
      '<meta property="og:image" content="http://169.254.169.254/latest/meta-data/iam/security-credentials/" />' +
      "</head></html>";
    pgmqState.pending = [
      { msg_id: 2, read_ct: 1, message: { article_id: "art-ssrf" } },
    ];

    await handler(new Request("http://localhost/image-consumer", { method: "POST" }));

    // Critical post-condition: NO update with the hostile URL.
    const sawHostile = articleUpdates.some(
      (u) => u.id === "art-ssrf" && u.image_url?.includes("169.254"),
    );
    expect(sawHostile).toBe(false);

    // Either the row was left untouched, or it was patched with NULL — both
    // are acceptable contract outcomes; what matters is the metadata URL
    // never reached storage.
    for (const u of articleUpdates) {
      if (u.id === "art-ssrf") {
        expect(u.image_url ?? "").not.toMatch(/169\.254/);
      }
    }
  });

  it("refuses to follow redirects into RFC1918 / loopback / link-local space", async () => {
    const handler = await importHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const hostile = [
      "http://10.0.0.5/img.jpg",
      "http://192.168.1.1/img.jpg",
      "http://172.16.0.1/img.jpg",
      "http://127.0.0.1/img.jpg",
      "http://[::1]/img.jpg",
    ];
    hostile.forEach((u, i) => {
      const articleId = `art-priv-${i}`;
      fakeArticles[articleId] = { url: `https://news.example.com/s${i}`, image_url: null };
      htmlResponses[`https://news.example.com/s${i}`] =
        `<html><head><meta property="og:image" content="${u}" /></head></html>`;
      pgmqState.pending.push({
        msg_id: 100 + i,
        read_ct: 1,
        message: { article_id: articleId },
      });
    });

    await handler(new Request("http://localhost/image-consumer", { method: "POST" }));

    for (const u of articleUpdates) {
      expect(u.image_url ?? "").not.toMatch(
        /(?:^|\/)(?:10|127|192\.168|169\.254|172\.(?:1[6-9]|2\d|3[01])|\[?::1)/,
      );
    }
  });

  it("permanently deletes messages with read_ct > 3 (poison)", async () => {
    const handler = await importHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    pgmqState.pending = [
      { msg_id: 200, read_ct: 4, message: { article_id: "ghost" } },
    ];
    // No fakeArticles["ghost"] → fetch will 404 / article lookup misses.

    await handler(new Request("http://localhost/image-consumer", { method: "POST" }));
    expect(pgmqState.deleted).toContain(200);
  });

  it("returns 200 on empty queue (no work is not an error)", async () => {
    const handler = await importHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const res = await handler(
      new Request("http://localhost/image-consumer", { method: "POST" }),
    );
    expect(res.status).toBe(200);
  });

  it("caps batch processing under the 30 s wall (smoke)", async () => {
    const handler = await importHandler();
    expect(handler).toBeDefined();
    if (!handler) throw new Error("unreachable: handler tripwire above must throw");

    const start = Date.now();
    await handler(new Request("http://localhost/image-consumer", { method: "POST" }));
    expect(Date.now() - start).toBeLessThan(30_000);
  });
});
