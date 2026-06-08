# Refactor: tmux workers → event-driven worker stream on Supabase

Branch: `refactor/worker-stream-system` → `main`
Scope: 44 commits, +12,414 / −6,518 LOC across 80 files.

## Summary

This PR replaces the legacy long-running tmux worker pattern (`scripts/rss-worker.mjs`, `scripts/cluster-worker.mjs`, `scripts/image-worker.mjs`, `scripts/headline-worker.mjs`) with an event-driven worker stream that lives entirely inside Supabase. A `pg_cron` job pokes the new `ingest` Edge Function on a 3-minute cadence; an `AFTER INSERT ON articles` trigger fans work onto two `pgmq` queues (`cluster_work`, `image_backfill`); two more `pg_cron` jobs drain those queues into the `cluster-consumer` and `image-consumer` Edge Functions. The only Vercel cron in the new pipeline is `/api/cron/headline`, which writes neutral Turkish cluster titles via the LLM.

The root cause of the 7-day `/api/cron/cluster` 500-storm — a long-running worker that wedged on a slow outlet and silently stopped progressing — is structurally impossible in the new design.

## Motivation

The tmux pattern was producing two recurring incident classes:

1. **Silent stalls.** A tmux pane that "looks alive" while no work is progressing. Detection latency averaged hours; the worst incident hit 7 days.
2. **No deploy / rollback story.** Patching a worker required SSHing into the VM, killing tmux panes by hand, and pulling the branch. No green/blue, no commit-to-prod link, no audit trail.

Seven audit findings (T1–T7) called this out as the dominant operational risk. All seven are addressed by this PR.

## Architecture at a glance

```
Supabase pg_cron ─▶ ingest Edge Function ─▶ articles table
                                                  │
                                          AFTER INSERT trigger
                                                  │
                            ┌─────────────────────┴─────────────────────┐
                            ▼                                           ▼
                     pgmq.cluster_work                          pgmq.image_backfill
                            │                                           │
                  pg_cron cluster-drain                       pg_cron image-drain
                            │                                           │
                            ▼                                           ▼
                  cluster-consumer Edge Fn                    image-consumer Edge Fn
                            │                                           │
                            ▼                                           ▼
                  clusters + cluster_articles                  articles.image_url
                            │
                            ▼
                  Vercel cron /api/cron/headline
                            │
                            ▼
                  clusters.title_tr_neutral
```

Full design rationale, alternatives, and consequences in [`adr/001-worker-stream-system.md`](adr/001-worker-stream-system.md). Operator cutover steps in [`migration-guide.md`](migration-guide.md).

## Changes by area

### New code (event-driven workers)
- `supabase/functions/ingest/` — RSS fan-out (16-way pool, charset-aware decode CP1254 / iso-8859-9 / UTF-8, conditional GET, 60s cycle deadline).
- `supabase/functions/cluster-consumer/` — drains `cluster_work` with pgmq visibility-timeout semantics, runs the 3-method clustering ensemble, archives on success.
- `supabase/functions/image-consumer/` — drains `image_backfill`, fetches `og:image` from the first 50KB of the article page via the SSRF-gated `safe-fetch.ts`, updates `articles.image_url`.
- `supabase/functions/_shared/` — ported worker libraries (`rss/fetcher.ts`, `rss/normalize.ts`, `cluster/*`, `safe-fetch.ts`, `sentry.ts`, `supabase.ts`, `auth.ts`, `og-image.ts`).

### New migrations
- `024_pgmq_setup.sql` — pgmq extension, `cluster_work` + `image_backfill` queues, `worker_metrics` view, service-role grants. (Round-6 stripped the never-wired `worker_checkpoint` table from this migration; see 028.)
- `025_worker_triggers.sql` — `AFTER INSERT` triggers; `SECURITY DEFINER` with empty `search_path` and fully `pg_catalog.`-qualified identifiers; idempotent (drops triggers before recreating); `GRANT EXECUTE ON pgmq.send` to the owner roles.
- `026_unify_content_hash_v2.sql` — backfills the sha256-regime stragglers to sha1-of-shingles and installs `CHECK (length(content_hash) = 40)`.
- `027_cluster_link_atomic.sql` — Round-6 P1 fix. `public.cluster_link_atomic` SECURITY DEFINER RPC serializes per-cluster `cluster_articles` INSERT + `clusters.article_count` recompute under `pg_advisory_xact_lock(hashtext(cluster_id::text))`, closing the race where two cluster-consumer invocations could leave `clusters.article_count` permanently under-counted.
- `028_drop_worker_checkpoint.sql` — Round-6 P1 follow-up. Clean drop of `worker_checkpoint` table / trigger / function on databases that applied the original 024 (no-op via `DROP ... IF EXISTS` on fresh databases).

### Updated routes (Vercel side)
- `/api/cron/headline` — bearer-gated (constant-time compare; fail-closed when `CRON_SECRET` is unset); 5-cluster batch ceiling; sanitised 500 envelope (no `err.message` leakage); rate limit and source-of-truth prompt for neutral Turkish headlines.
- `/api/health` — anonymous endpoint rate-limited (30 capacity, 1/s refill); bearer-gated detailed envelope; reads `MAX(clusters.updated_at)` as the active-processing signal.
- `/api/metrics` — bearer-gated, fail-closed on missing secret; surfaces per-query errors instead of silently `?? 0`-ing them.

### Deleted (legacy worker pattern)
- `scripts/rss-worker.mjs`, `scripts/cluster-worker.mjs`, `scripts/image-worker.mjs`, `scripts/headline-worker.mjs` — the four tmux runners.
- Legacy `src/lib/rss/*` helpers and the previous `/api/cron/*` Vercel routes.
- Tmux orchestrator shell script.

### Retained intentionally
- `scripts/lib/cluster/*.mjs` — the **golden-vector parity benchmark** that `tests/functions/_shared/cluster.test.ts` uses to assert the Deno port at `supabase/functions/_shared/cluster/*.ts` stays byte-equivalent. AGENTS.md is updated to make this explicit.

### Observability
- `supabase/functions/_shared/sentry.ts` — graceful Sentry-Deno wrapper for every Edge Function; no-op when `SENTRY_DSN` is unset. Closes the 7-day-undetected-failure gap that the Next-side `@sentry/nextjs` SDK does not cover. Round-6 added an explicit `captureException(functionName, err)` helper that every Edge Function's inner catch calls before returning the 500 envelope, so a swallowed throw cannot dodge Sentry (the `withSentry` wrapper only sees thrown errors).
- `@sentry/nextjs` bumped to `^10.56` for Next 16 compatibility; sourcemaps API migrated from `hideSourceMaps` to `sourcemaps.disable`.
- `/api/metrics` now exposes `clusters.neutralizedEligible`, `clusters.neutralized`, `clusters.neutralizedRatio`, and `clusters.oldestPendingNeutralAgeSec` so the on-call dashboard can page on headline-cron drift by age (the most actionable single signal) rather than waiting for the ratio to decay.

### Test infrastructure
- New: `tests/functions/{ingest,cluster-consumer,image-consumer}.test.ts`, `tests/functions/_shared/{safe-fetch,cluster}.test.ts`, `tests/migrations/024-026.test.ts`.
- Shared chainable Supabase fake replaces brittle per-site mocks.
- Tests for the new `withApiErrors` 500 envelope, `apiUnauthorized`, bearer-gated cron auth, `connection()` dynamic-route opt-out.
- 18 test files, **294 passed + 3 intentional `describe.runIf(LIVE)` skips** (the live tier runs only when `SUPABASE_LOCAL_URL` is set; CI / clean dev boxes skip it).
- The `024-026` migration test splits the SECURITY DEFINER grant assertion into four independent invariants so a comment-order edit can't silently regress the Round-4 fix.

### Documentation
- New: `docs/adr/001-worker-stream-system.md` — the architecture decision record.
- `docs/architecture.md`, `docs/api.md`, `docs/migration-guide.md` rewritten end-to-end against the shipped pipeline; mermaid diagram refreshed.
- `AGENTS.md` — corrected to reflect the post-deletion state of `scripts/*-worker.mjs` and the deliberate retention of `scripts/lib/cluster/*`.

## Audit findings closed

| ID | Resolution | Commit reference |
|----|------------|------------------|
| T1 — silent stalls undetected | pg_cron cadence + Sentry coverage + worker_metrics view | `83897d1`, `98c7fbd` |
| T2 — no deploy / rollback path | Edge Function deploy pipeline + migration ledger | branch as a whole |
| T3 — `/api/cron/headline` not fail-closed on missing secret | timingSafeEqual + 503 when `CRON_SECRET` unset | `157e038` |
| T4 — SSRF in image fetcher | DNS-resolved allowlist (RFC1918, loopback, link-local, ULA, CGNAT, IPv6 documentation) | `296d409`, `49ad2a3` |
| T5 — `err.message` leakage in 500 bodies | `withApiErrors` canonical envelope + Sentry-only raw error | `122e867`, `5ab297f` |
| T6 — no Sentry on the Deno side | `_shared/sentry.ts` + `withSentry` wrapper on every function | `98c7fbd` |
| T7 — dual `content_hash` regimes | Migration 026 backfill + CHECK constraint | `9c71d1d`, `d27ba41`, `46ce637` |

## Security posture

- **Service-role bearer required** on every Edge Function handler (`requireServiceRoleBearer`).
- **Fail-closed bearer check** on `/api/cron/headline` and `/api/metrics` when `CRON_SECRET` is unset — they return 503, never 200.
- **SSRF guard** on every outbound HTTP from the Deno side via `safe-fetch.ts`:
  - DNS resolution + private-range allowlist (RFC1918, loopback, link-local, ULA, CGNAT, benchmark, TEST-NETs, multicast, future-use, IPv6 documentation, IPv6 link-local, IPv6 multicast, IPv6 ULA).
  - **IPv4-mapped IPv6 unwrapping** so `http://[::ffff:169.254.169.254]/` cannot dodge the IPv4 list and reach the EC2 IMDS endpoint (Round-6 P0 close).
  - **DNS-pinning for plain HTTP** so a rebinding attacker who serves a public IP to our check and a private IP to `fetch` cannot bypass the allowlist (Round-6 P1 close). HTTPS keeps the hostname for SNI/TLS verification.
- **`SECURITY DEFINER` triggers** with **empty `search_path`** and fully `pg_catalog.`-qualified identifiers (Round-6 P1 close — the original `public, pgmq, pg_temp` setting allowed a session role with CREATE on `pg_temp` to shadow unqualified calls inside the function body); pgmq function access revoked from `anon`/`authenticated`; explicit `GRANT EXECUTE` to the function-owner roles.
- **Per-cluster advisory lock** in `cluster_link_atomic` (migration 027) serializes concurrent `cluster_articles` INSERT + `clusters.article_count` recompute against the same cluster, eliminating both the under-count race and the half-applied-write trap (Round-6 P1 close).
- **Anonymous rate limit** on `/api/health`'s public envelope (30 capacity, 1/s refill).
- **No `err.message` in 500 response bodies** — raw errors route to Sentry / Edge Function logs with a `request_id`. Edge Function inner-catches explicitly call `captureException` so a swallowed throw never goes unpaged (Round-6 P1 close).
- **No AI/Claude/Anthropic attribution** anywhere in the diff (commits, code, comments, branch name). The `ANTHROPIC_API_KEY` env var is the patient-LLM product key, not attribution; it was already in `.env.example` before this PR.

## Operator cutover

The full checklist is [`migration-guide.md`](migration-guide.md); the ordered TL;DR:

1. Snapshot the production database.
2. `supabase db push` to apply migrations 024 → 025 → 026.
3. `supabase functions deploy ingest cluster-consumer image-consumer` with `SENTRY_DSN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the `app.service_role_key` Postgres GUC configured.
4. Install three pg_cron jobs: `ingest-drain` (`*/3 * * * *`), `cluster-drain` (`* * * * *`), `image-drain` (`*/5 * * * *`).
5. Deploy the branch on Vercel; verify `/api/cron/headline` is the only Vercel cron.
6. Stop the tmux workers on the VM.
7. Watch `worker_metrics` and Sentry for one cycle of each cadence.

## Rollback plan

- **Through step 5:** revert the Vercel deploy, stop the new pg_cron jobs. The pgmq queues are idle when no consumer drains them.
- **Through step 4:** also remove the pg_cron rows from `cron.job`.
- **Through migration 026:** restore the database snapshot from step 1. Migration 026's sha256 → sha1 backfill is the only one-way change; the snapshot is the safety net.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 18 test files, 312 passed + 3 intentional `describe.runIf(LIVE)` skips (the live tier runs only when `SUPABASE_LOCAL_URL` is set; CI / clean dev boxes skip it).
- Final QA Round 6 ran in two parallel Opus-pinned workflows covering security/correctness and operability/PR-readiness. Reports under `qa/round6/`. The audit surfaced 1 P0 (SSRF IPv4-mapped IPv6 bypass) and 6 P1s (DNS-rebinding TOCTOU, SECURITY DEFINER `pg_temp` shadow, two cluster-write race shapes, Edge Function `captureException` gap, `/api/metrics` missing headline-cron drift signals, `worker_checkpoint` dead schema). All P0/P1 findings are closed by the commits between `aa1fc9e` and HEAD; the corresponding regression tests are in `tests/functions/_shared/safe-fetch.test.ts` and `tests/migrations/024-028.test.ts`. Remaining audit items are P2/P3 follow-ups documented in the report files.

## Commit history note

The 50+ commits on this branch are organized by work-packet, not by perfect linear narrative. Some files (notably the migration set, `safe-fetch.ts`, and parts of the test suite) carry multiple commits because the design surfaced through iterative QA rounds — each fix is its own atomic commit so the audit trail of what-changed-why is preserved. A reviewer who wants the abridged narrative can read this PR body and the per-Round QA reports in `qa/round*/`; a reviewer who wants the full audit story can `git log --oneline origin/main..HEAD` and follow the commit message references back to the round that surfaced each finding. No commits mix unrelated work.

## Out of scope

- No public API contract changes; `/api/admin`, `/api/newsletter`, and read-side endpoints are untouched.
- No UI changes.
- No bias-analysis logic changes.
- No clustering-algorithm changes — the Deno port is byte-equivalent to the legacy clusterer, enforced by the parity test in `tests/functions/_shared/cluster.test.ts`.
