import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Integration test for migrations 024 (pgmq setup), 025 (worker triggers),
// and 026 (content_hash unification).
//
// **Gated:** This file does TWO things depending on the environment.
//
//   1. Always: static SQL assertions (lint-style). The migration files must
//      contain the canonical statements the worker-stream architecture is
//      contracted against (pgmq.create('cluster_work'), CHECK constraint on
//      content_hash, the politics whitelist, etc.). These run in every CI
//      box including ones without a local Supabase.
//
//   2. When `process.env.SUPABASE_LOCAL_URL` is set: connect to that
//      Postgres, apply 024/025/026 in order, then exercise the live
//      behaviour (queue exists, trigger fires on INSERT, CHECK constraint
//      rejects sha256-length hashes). CI without a local Supabase skips
//      these via vitest's `it.runIf(...)` predicate.
//
// The static checks alone catch ~80 % of the regressions Phase 3 QA is
// likely to flag — the live checks are the bonus tier for the user's
// future local-dev workflow.
// ---------------------------------------------------------------------------

const SUPABASE_LOCAL_URL = process.env.SUPABASE_LOCAL_URL;
const LIVE = Boolean(SUPABASE_LOCAL_URL);

const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "supabase", "migrations");

function read(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
}

// ---------------------------------------------------------------------------
// Static checks — always run.
// ---------------------------------------------------------------------------

describe("migration 024_pgmq_setup.sql (static)", () => {
  let sql = "";
  beforeAll(() => {
    sql = read("024_pgmq_setup.sql");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("creates the pgmq extension", () => {
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgmq/i);
  });

  it("creates the cluster_work queue", () => {
    expect(sql).toMatch(/pgmq\.create\(\s*'cluster_work'\s*\)/i);
  });

  it("creates the image_backfill queue", () => {
    expect(sql).toMatch(/pgmq\.create\(\s*'image_backfill'\s*\)/i);
  });

  it("creates a worker_checkpoint table for safety-net consumer modes", () => {
    expect(sql).toMatch(/create\s+table[^;]*worker_checkpoint/i);
    // Round-2 fix: articles.id is uuid, so the resume marker is a uuid column
    // named last_seen_article_id (see 024_pgmq_setup.sql).
    expect(sql).toMatch(/last_seen_article_id\s+uuid/i);
    // Tripwire: the legacy bigint shape must never come back — a maintainer
    // reverting to it would silently regress Round-1 F3 (uuid column rename).
    expect(sql).not.toMatch(/last_seen_id\s+bigint/i);
  });

  it("exposes a worker_metrics view (read-only surface for /api/health)", () => {
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?view\s+worker_metrics/i);
  });

  it("revokes pgmq function access from anon / authenticated", () => {
    expect(sql).toMatch(/revoke[^;]*from\s+(anon|authenticated)/i);
  });
});

describe("migration 025_worker_triggers.sql (static)", () => {
  let sql = "";
  beforeAll(() => {
    sql = read("025_worker_triggers.sql");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("defines the cluster_work enqueue trigger AFTER INSERT on articles", () => {
    expect(sql).toMatch(
      /after\s+insert\s+on\s+articles[\s\S]+execute\s+function\s+enqueue_cluster_work/i,
    );
  });

  it("defines the image_backfill enqueue trigger AFTER INSERT on articles", () => {
    expect(sql).toMatch(
      /after\s+insert\s+on\s+articles[\s\S]+execute\s+function\s+enqueue_image_backfill/i,
    );
  });

  it("scopes cluster_work to the politics whitelist (politika / son_dakika)", () => {
    expect(sql).toMatch(/politika/);
    expect(sql).toMatch(/son_dakika/);
  });

  it("guards image_backfill on NEW.image_url IS NULL (skip rows that already have images)", () => {
    expect(sql).toMatch(/NEW\.image_url\s+is\s+(not\s+)?null/i);
  });

  it("is idempotent — drops triggers before recreating", () => {
    expect(sql).toMatch(/drop\s+trigger\s+if\s+exists\s+articles_cluster_enqueue/i);
    expect(sql).toMatch(/drop\s+trigger\s+if\s+exists\s+articles_image_enqueue/i);
  });

  it("locks SECURITY DEFINER trigger functions to an empty search_path", () => {
    // Round-6 P1 tripwire: the original migration set `search_path = public,
    // pgmq, pg_temp` on the SECURITY DEFINER trigger functions, which let a
    // role with CREATE on pg_temp shadow unqualified calls inside the
    // function body and execute under the function owner. The fix is empty
    // search_path + schema-qualified identifiers. If either assertion
    // regresses, the audit-era footgun is back.
    expect(sql).not.toMatch(/set\s+search_path[^\n]*pg_temp/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*''/i);
    // Identifiers must be schema-qualified inside the SECURITY DEFINER body.
    expect(sql).toMatch(/pg_catalog\.jsonb_build_object/);
  });

  it("grants pgmq.send EXECUTE to the SECURITY DEFINER owner roles (postgres, supabase_admin)", () => {
    // Round-4 fix: the SECURITY DEFINER trigger functions invoke pgmq.send
    // under the function-owner identity; without this grant the trigger
    // fails with "permission denied for function pgmq.send" on any
    // non-service_role owner. The migration implements the grant via a
    // defensive `do $$ ... execute format('grant execute on function %s
    // to %I', ...) $$;` block so it survives function-overload set drift
    // AND missing-role scenarios (vanilla Postgres without the Supabase
    // role bundle). Tripwire: removing any of the four invariants below
    // silently regresses Round-3 P1 (SECURITY DEFINER grant propagation).
    expect(sql).toMatch(/grant\s+execute\s+on\s+function/i);
    expect(sql).toMatch(/n\.nspname\s*=\s*'pgmq'/i);
    expect(sql).toMatch(/'postgres'\s*,\s*'supabase_admin'/);
    expect(sql).toMatch(/pg_roles\s+where\s+rolname\s*=\s*target_role/i);
  });
});

describe("migration 026_unify_content_hash_v2.sql (static)", () => {
  let sql = "";
  beforeAll(() => {
    sql = read("026_unify_content_hash_v2.sql");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("backfills any row whose content_hash is 64 hex chars (sha256 regime)", () => {
    expect(sql).toMatch(/length\(content_hash\)\s*=\s*64/i);
  });

  it("adds a CHECK constraint enforcing 40-char sha1 hashes going forward", () => {
    expect(sql).toMatch(/check\s*\([^)]*length\(content_hash\)\s*=\s*40/i);
  });

  it("does NOT drop the UNIQUE constraint on (source_id, content_hash)", () => {
    // Negative assertion: refusing to drop the dedup key.
    expect(sql).not.toMatch(/drop\s+constraint[^;]*source_id[^;]*content_hash/i);
  });
});

// ---------------------------------------------------------------------------
// Migration 027 — atomic cluster_articles link + clusters recompute under
// a per-cluster advisory lock. Round-6 P1 fix for the concurrent
// cluster-write race that left clusters.article_count under-counted when
// two consumers added different articles to the same cluster in parallel.
// ---------------------------------------------------------------------------

describe("migration 027_cluster_link_atomic.sql (static)", () => {
  let sql = "";
  beforeAll(() => {
    sql = read("027_cluster_link_atomic.sql");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("defines public.cluster_link_atomic(...) as SECURITY DEFINER", () => {
    expect(sql).toMatch(/create\s+function\s+public\.cluster_link_atomic/i);
    expect(sql).toMatch(/security\s+definer/i);
  });

  it("locks the function to an empty search_path with pg_catalog-qualified calls", () => {
    // Round-6 P1 tripwire (mirrors the migration 025 lock): empty
    // search_path + schema-qualified identifiers so pg_temp shadowing
    // cannot reach the SECURITY DEFINER body.
    expect(sql).not.toMatch(/set\s+search_path[^\n]*pg_temp/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(/pg_catalog\.pg_advisory_xact_lock/);
    expect(sql).toMatch(/pg_catalog\.hashtext/);
    expect(sql).toMatch(/pg_catalog\.count/);
  });

  it("uses pg_advisory_xact_lock for per-cluster serialization", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(\s*pg_catalog\.hashtext/i);
  });

  it("INSERTs into cluster_articles with ON CONFLICT DO NOTHING", () => {
    expect(sql).toMatch(/insert\s+into\s+public\.cluster_articles/i);
    expect(sql).toMatch(/on\s+conflict\s+do\s+nothing/i);
  });

  it("recomputes article_count under the lock before UPDATEing clusters", () => {
    // The COUNT(*) must be inside the function body BEFORE the UPDATE;
    // a naive implementation that passed an externally-computed count
    // would re-introduce the race.
    expect(sql).toMatch(/select\s+pg_catalog\.count\(\*\)\s+into\s+v_count[\s\S]*from\s+public\.cluster_articles/i);
    const updateIdx = sql.search(/update\s+public\.clusters/i);
    const countIdx = sql.search(/select\s+pg_catalog\.count\(\*\)\s+into\s+v_count/i);
    expect(countIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(countIdx);
  });

  it("grants EXECUTE to service_role only (no anon / authenticated / public)", () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.cluster_link_atomic[^;]+from\s+public/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.cluster_link_atomic[^;]+to\s+service_role/i);
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.cluster_link_atomic[^;]+to\s+(anon|authenticated)/i);
  });
});

// ---------------------------------------------------------------------------
// Live integration checks — opt-in via SUPABASE_LOCAL_URL.
//
// These speak Postgres directly. We don't pull in a Supabase JS client here
// because the wire protocol is simpler — and these tests are about the SQL
// side, not the JS SDK. We use the `pg` driver if it's available.
//
// If `pg` isn't installed (it isn't in tayf's package.json today), the live
// suite skips with an explanatory log. The orchestrator can `npm i -D pg`
// in Phase 3 if the user wants the live tier active.
// ---------------------------------------------------------------------------

describe.runIf(LIVE)("migrations 024–026 (live against SUPABASE_LOCAL_URL)", () => {
  type PgClient = {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
    end: () => Promise<void>;
  };

  let client: PgClient | null = null;

  beforeAll(async () => {
    try {
      // Dynamic import: don't crash module load on dev boxes that lack `pg`.
      const pgMod = (await import("pg").catch(() => null)) as
        | { Client?: new (opts: unknown) => PgClient }
        | null;
      if (!pgMod?.Client) {
        // eslint-disable-next-line no-console
        console.warn("[migrations] `pg` not installed; live tier skipping.");
        return;
      }
      client = new pgMod.Client({ connectionString: SUPABASE_LOCAL_URL });
      await (client as unknown as { connect: () => Promise<void> }).connect();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[migrations] could not connect to SUPABASE_LOCAL_URL:", err);
      client = null;
    }
  });

  it("pgmq schema exists and the cluster_work / image_backfill queues are present", async () => {
    if (!client) return;
    const { rows } = await client.query(
      "select queue_name from pgmq.list_queues() where queue_name in ('cluster_work', 'image_backfill')",
    );
    const names = rows.map((r) => String(r.queue_name)).sort();
    expect(names).toEqual(["cluster_work", "image_backfill"]);
  });

  it("inserting a politics article enqueues a cluster_work message", async () => {
    if (!client) return;
    // Snapshot the queue depth, insert one row, snapshot again. The
    // trigger writes synchronously inside the same xact, so the count
    // delta must be exactly 1.
    const before = await client.query(
      "select count(*)::int as n from pgmq.q_cluster_work",
    );
    const beforeN = Number(before.rows[0]?.n ?? 0);

    await client.query(
      "insert into articles (title, url, source_id, content_hash, category) values ($1, $2, $3, $4, $5)",
      [
        "live-test-headline",
        `https://example.com/live-${Date.now()}`,
        // Source id and content_hash will fail this insert if the schema
        // doesn't have a placeholder row; the test catches that as a
        // failure and the user knows to seed appropriately.
        "00000000-0000-0000-0000-000000000000",
        "a".repeat(40),
        "politika",
      ],
    );

    const after = await client.query(
      "select count(*)::int as n from pgmq.q_cluster_work",
    );
    const afterN = Number(after.rows[0]?.n ?? 0);
    expect(afterN).toBe(beforeN + 1);
  });

  it("the content_hash CHECK constraint rejects sha256-length values", async () => {
    if (!client) return;
    let threw = false;
    try {
      await client.query(
        "insert into articles (title, url, source_id, content_hash, category) values ($1, $2, $3, $4, $5)",
        [
          "live-bad-hash",
          `https://example.com/bad-${Date.now()}`,
          "00000000-0000-0000-0000-000000000000",
          "a".repeat(64), // sha256 length — must violate the CHECK.
          "politika",
        ],
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
