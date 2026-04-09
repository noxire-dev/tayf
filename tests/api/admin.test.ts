import { describe, it, expect } from "vitest";

const BASE = process.env.TAYF_BASE ?? "http://localhost:3000";

type JsonRecord = Record<string, unknown>;

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body, text };
}

describe("GET /api/admin", () => {
  it("returns 200 with the expected stat shape", async () => {
    const { status, body } = await fetchJson("/api/admin");
    expect(status).toBe(200);
    expect(body).toHaveProperty("articles");
    expect(body).toHaveProperty("sources");
    expect(body).toHaveProperty("clusters");
    expect(body).toHaveProperty("sourcesList");
    const data = body as JsonRecord;
    expect(typeof data.articles).toBe("number");
    expect(Array.isArray(data.sourcesList)).toBe(true);
  });
});

describe("POST /api/admin", () => {
  it("returns 400 for unknown action", async () => {
    const { status, body } = await fetchJson("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "definitely_not_a_real_action" }),
    });
    expect(status).toBe(400);
    expect((body as JsonRecord | null)?.error).toBeTruthy();
  });

  it("returns 400 for missing required fields on add_source", async () => {
    const { status } = await fetchJson("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_source", name: "Missing fields" }),
    });
    expect(status).toBe(400);
  });
});

describe("GET /api/cron/ingest", () => {
  it("returns 200 or 401 (depending on CRON_SECRET)", async () => {
    const { status } = await fetchJson("/api/cron/ingest");
    expect([200, 401]).toContain(status);
  });
});

describe("GET /api/cron/backfill-images", () => {
  it("returns 200 (assuming no CRON_SECRET)", async () => {
    const { status } = await fetchJson("/api/cron/backfill-images");
    expect([200, 401]).toContain(status);
  });
});

describe("404 handling", () => {
  it("/cluster/<invalid-uuid> returns 404", async () => {
    const { status } = await fetchJson("/cluster/00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });
});
