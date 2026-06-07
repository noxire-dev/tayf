# Worker-stream migration guide

Transitioning a deployed tayf instance from the legacy tmux long-running worker pattern (`scripts/dev.mjs` + `scripts/{rss,cluster,image,headline}-worker.mjs`) to the new Vercel-cron + Supabase-Edge-Functions + pgmq stream system.

Architectural overview lives in [`tayf-refactor/architecture/ADR-001-worker-stream-system.md`](../tayf-refactor/architecture/ADR-001-worker-stream-system.md). Read it first if you need the *why*. This document is the *how*: an ordered checklist for a one-operator deployment.

> **Scope:** production Supabase project + production Vercel project. Local dev parity instructions are at the end. The user owns the merge of `refactor/worker-stream-system` to `main`; nothing in this guide does that.

---

## 0. Pre-flight

Confirm you have:

- Supabase CLI installed locally: `supabase --version` (≥ 1.150 for `functions deploy`).
- `supabase login` completed against the org that owns the tayf project.
- The Supabase project ref handy. You can read it from the dashboard URL (`https://supabase.com/dashboard/project/<PROJECT_REF>`) or from `supabase/config.toml`.
- The service-role key for that project (Supabase Dashboard → Project Settings → API).
- Vercel CLI installed: `vercel --version`.
- The current main branch is healthy: `npm run build` passes, `npm test` passes.
- The current `vercel.ts` cron schedules are known — you'll be replacing some of them.
- A maintenance window. Article ingestion stops for the few minutes between turning off the legacy worker and the new cron schedule firing. Cluster + image-backfill have visibility-timeout-driven re-delivery so partial-state hand-off is safe, but the gap is real.

Take a database snapshot before starting (Supabase Dashboard → Database → Backups → Create snapshot). The migrations are additive but the rehash step in 026 rewrites `content_hash` for rows already in the sha256 regime — irreversible without a restore.

---

## 1. Apply migrations 024, 025, 026 in order

These migrate the database side of the new system: pgmq install, the article-insert triggers that enqueue work, and the content-hash unification.

```bash
# From the repo root
supabase db push                # applies any pending migrations to the linked project
```

If you prefer to apply one at a time (recommended for the first deployment so you can stop on red):

```bash
supabase db push --include-roles --file supabase/migrations/024_pgmq_setup.sql
supabase db push --include-roles --file supabase/migrations/025_worker_triggers.sql
supabase db push --include-roles --file supabase/migrations/026_unify_content_hash_v2.sql
```

**Verification:**

```sql
-- All three should return rows.
select extname, extversion from pg_extension where extname = 'pgmq';
select queue_name from pgmq.list_queues() order by queue_name;
-- Expect: cluster_work, image_backfill
select tgname from pg_trigger where tgrelid = 'articles'::regclass
  and tgname in ('articles_cluster_enqueue', 'articles_image_enqueue');
-- Expect: both
select conname from pg_constraint where conrelid = 'articles'::regclass
  and conname ilike '%content_hash%';
-- Expect at least one CHECK constraint enforcing length(content_hash) = 40
```

Migration 026 is idempotent (gated on `length(content_hash) = 64`); re-running it is safe and produces zero rows updated on the second pass.

---

## 2. Deploy the Supabase Edge Functions

Three Deno-runtime functions need to ship: `ingest`, `cluster-consumer`, `image-consumer`.

```bash
supabase functions deploy ingest          --no-verify-jwt
supabase functions deploy cluster-consumer --no-verify-jwt
supabase functions deploy image-consumer  --no-verify-jwt
```

`--no-verify-jwt` is required because pg_cron calls these with the service-role bearer (set below), not a user JWT. Verification still happens — the consumers check the `Authorization` header against `SERVICE_ROLE_KEY` manually inside the handler — but Supabase's edge gateway shouldn't reject the request before the handler runs.

**Set the Edge Function environment:**

```bash
supabase secrets set --env-file supabase/functions/.env.production
```

Where `supabase/functions/.env.production` contains (DO NOT commit this file — `.gitignore` already excludes it):

```dotenv
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<anon-key>
# Optional: bias the consumer toward a particular Sentry DSN if Sentry is in scope.
SENTRY_DSN=https://...@sentry.io/...
```

**Verification:**

```bash
# Each command should print 200 (assuming no work in the queue → empty batch).
curl -sS -X POST -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  "https://<PROJECT_REF>.functions.supabase.co/cluster-consumer"

curl -sS -X POST -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  "https://<PROJECT_REF>.functions.supabase.co/image-consumer"

curl -sS -X POST -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  "https://<PROJECT_REF>.functions.supabase.co/ingest"
```

---

## 3. Schedule pg_cron drains for the consumers

pg_cron + pg_net live in Supabase but are NOT installed by the portable migrations (they're project-scoped extensions whose grants differ between Supabase Free and Pro). Schedule them once via the Supabase Dashboard → SQL Editor:

```sql
-- Run in Supabase Dashboard → SQL Editor.
-- Both extensions are pre-installed on Supabase Pro; on Free, enable
-- them under Database → Extensions first.

-- Stash the service-role key in a database-level setting so the cron
-- payload can reference it without baking the literal into pg_cron's
-- jobname (which is logged in cron.job_run_details, world-readable to
-- any DB role with usage on cron). The setting itself lives in
-- pg_db_role_setting, readable only by superuser / the bootstrap role.
alter database postgres set app.service_role_key = '<SERVICE_ROLE_KEY>';

-- Drain cluster_work every minute.
SELECT cron.schedule(
  'cluster-drain',
  '* * * * *',
  $$ SELECT net.http_post(
       url := 'https://<PROJECT_REF>.functions.supabase.co/cluster-consumer',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
     ) $$
);

-- Drain image_backfill every five minutes (lower priority, larger pages).
SELECT cron.schedule(
  'image-drain',
  '*/5 * * * *',
  $$ SELECT net.http_post(
       url := 'https://<PROJECT_REF>.functions.supabase.co/image-consumer',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
     ) $$
);
```

**Verification:**

```sql
-- Both rows should appear; `active = true`.
select jobname, schedule, active from cron.job
  where jobname in ('cluster-drain', 'image-drain');

-- After ~2 minutes, this should show recent runs with `status = 'succeeded'`.
select jobname, status, return_message, start_time
  from cron.job_run_details
  where jobname in ('cluster-drain', 'image-drain')
  order by start_time desc limit 10;
```

If you ever need to remove a schedule (for example to re-create it with a different URL):

```sql
SELECT cron.unschedule('cluster-drain');
SELECT cron.unschedule('image-drain');
```

---

## 4. Configure Vercel: env vars + redeploy

Set the secrets and redeploy. The new cron route is `/api/cron/headline`; the new Vercel cron schedule is added by B6 in `vercel.ts`.

```bash
# Required — without this the /api/cron/* routes return 503 (FAIL-CLOSED).
vercel env add CRON_SECRET production
# Paste a freshly-generated 32+ char random string when prompted.

# Required — the headline route uses these to call the LLM.
vercel env add OPENAI_API_KEY production    # or GOOGLE_API_KEY depending on the SDK in use
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production

# Optional — Sentry DSN (B8 wires this up).
vercel env add SENTRY_DSN production
```

Trigger a deploy:

```bash
vercel --prod
```

Vercel reads `vercel.ts` on each deploy and reconciles the cron schedule. After the deploy lands, the cron page in the Vercel Dashboard shows `/api/cron/ingest` (legacy, still firing — gets retired in step 6) and `/api/cron/headline` (new, every 5 minutes).

**Verification:**

```bash
# Should return 401 because no auth header is sent.
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://<your-tayf-domain>/api/cron/headline"
# Expect: 401

# Should return 200.
curl -sS -H "Authorization: Bearer <CRON_SECRET>" \
  "https://<your-tayf-domain>/api/cron/headline"
# Expect: 200 with a small JSON status payload.

# Should NEVER return 200 with CRON_SECRET intentionally unset on the server.
# (You can test this in a preview deployment without CRON_SECRET configured.)
```

Within ~15 minutes of the deploy, `/api/health` should report `clustering.lag_minutes < 15`. If it doesn't, see "Troubleshooting" below.

---

## 5. Drain the legacy tmux worker

Once the new stream has been live for at least one full cycle (≥ 15 minutes — enough for cluster-drain and headline cron to each tick three times) and `/api/health` is green, kill the legacy worker:

```bash
# On whichever host runs the long-running worker.
tmux kill-session -t tayf-app

# If tmux isn't running, but the worker is loose as a bare `node`:
pkill -f 'scripts/.*-worker.mjs'
```

Verify no `node scripts/*-worker.mjs` processes remain:

```bash
pgrep -af 'scripts/.*-worker.mjs' || echo "all clean"
```

The new system now owns ingestion. The legacy worker can stay un-run forever; the source files themselves are deleted in a follow-up commit on `main` after Phase 3 QA signs off.

---

## 6. Retire the legacy Vercel cron entries

B6 added `/api/cron/headline` to `vercel.ts` but intentionally left the older entries (e.g. `/api/cron/ingest`, `/api/cron/cluster`, `/api/cron/backfill-images`) in place to avoid a sharp cut-over while the Edge Functions burn in.

After the new system has been steady for 24 hours, remove the obsolete entries from `vercel.ts` and redeploy. The exact set to remove depends on what's currently scheduled — check the array in `vercel.ts` and drop any path whose handler is now superseded by an Edge Function:

| Legacy cron path | Replaced by | Action |
|---|---|---|
| `/api/cron/ingest` | `ingest` Edge Function via Vercel cron pulling it | KEEP (the cron pokes the edge function via Vercel still, OR retire if the orchestrator is now pg_cron) |
| `/api/cron/cluster` | `cluster-consumer` Edge Function via pg_cron | REMOVE |
| `/api/cron/backfill-images` | `image-consumer` Edge Function via pg_cron | REMOVE |
| `/api/cron/headline` | itself (still Vercel) | KEEP |

Coordinate the actual edit with the B7 deletion sweep — both touch adjacent files; the orchestrator merges the conflict.

After the edit:

```bash
vercel --prod
# Confirm in Vercel Dashboard → Cron Jobs that only the intended paths remain.
```

---

## 7. Smoke-test the end-to-end stream

Trigger a manual ingest and watch the work flow through:

```bash
# 1. Manually invoke ingest (or wait for the next /api/cron/ingest tick).
curl -sS -X POST -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  "https://<PROJECT_REF>.functions.supabase.co/ingest"

# 2. Watch cluster_work depth shrink as pg_cron drains it.
psql "$DATABASE_URL" -c \
  "select queue_name, queue_length from pgmq.metrics_all() where queue_name in ('cluster_work', 'image_backfill');"

# 3. Confirm fresh clusters land.
psql "$DATABASE_URL" -c \
  "select count(*) from clusters where created_at > now() - interval '15 minutes';"
```

If any step lags, jump to the next section.

---

## Troubleshooting

### `/api/health` reports `clustering` stale

1. Is the pg_cron job running?

   ```sql
   select status, return_message, start_time
     from cron.job_run_details where jobname = 'cluster-drain'
     order by start_time desc limit 5;
   ```

   If `status = 'failed'`, the `return_message` shows the HTTP status from the Edge Function — usually a 401 (missing `app.service_role_key`) or a 500 (bug in the consumer). Check Edge Function logs in the Supabase Dashboard.

2. Is `cluster_work` accumulating without being drained?

   ```sql
   select queue_length, oldest_msg_age_sec from pgmq.metrics('cluster_work');
   ```

   If `queue_length` is growing but `cluster-drain` is `succeeded`, the consumer is processing too slowly — bump the cron frequency to every 30 seconds (`*/30 * * * * *` requires pg_cron 1.6+; on older versions, schedule two jobs offset by 30 s).

### `image_backfill` queue is stuck

The most common cause is SSRF blocks consuming the visibility timeout without making progress. Check:

```sql
select * from pgmq.read('image_backfill', 60, 5);
-- Inspect the messages' read_ct. Anything with read_ct > 3 is poison
-- and the consumer should be deleting it — if it's not, that's a B5 bug.
```

### Edge Function cold-start spikes

The first invocation after a long idle (Supabase scales these to zero after ~15 minutes) adds 200–500 ms latency. The `* * * * *` schedule on cluster-drain keeps the function warm; if you raise the schedule interval, expect more cold starts.

### Migration 026 failed mid-rehash

The migration uses a single transaction. If it ran out of memory or hit a lock timeout, simply re-run it — the `WHERE length(content_hash) = 64` filter makes it pick up where it left off. If a row's `content_hash` somehow drifted to a length other than 40 or 64, the CHECK constraint at the bottom of the migration will fail; in that case, manually inspect and patch the offending rows before re-running.

---

## Local-dev parity (optional)

For developers running tayf against a local Supabase via `supabase start`:

```bash
supabase start
supabase db reset                         # applies all migrations
supabase functions serve                  # runs all Edge Functions locally on :54321

# In another terminal, drain manually instead of pg_cron:
watch -n 60 'curl -sS -X POST -H "Authorization: Bearer $LOCAL_SR_KEY" http://127.0.0.1:54321/functions/v1/cluster-consumer'
watch -n 300 'curl -sS -X POST -H "Authorization: Bearer $LOCAL_SR_KEY" http://127.0.0.1:54321/functions/v1/image-consumer'
```

Set `SUPABASE_LOCAL_URL=postgres://...` in your shell to enable the live tier of `tests/migrations/024-026.test.ts`:

```bash
SUPABASE_LOCAL_URL="$(supabase status -o json | jq -r .DB_URL)" npm test
```

---

## Roll-back

If the new system misbehaves and you need to revert to tmux:

1. Pause the pg_cron jobs (don't delete them — pausing is reversible):

   ```sql
   update cron.job set active = false where jobname in ('cluster-drain', 'image-drain');
   ```

2. Re-enable the legacy Vercel cron entries in `vercel.ts` (revert the B6 change) and redeploy.

3. Restart the tmux worker (`scripts/dev.mjs` is still in the tree until the post-QA deletion commit).

4. Migration 026's CHECK constraint stays in place (it's forward-compatible — the legacy worker also writes 40-char sha1 hashes). Migrations 024 and 025 also stay; the new triggers do no harm with the queues unused.

A full rollback (drop the queues + remove the triggers) requires writing migration 027 to undo 024/025. That migration is not pre-prepared because the user's instruction was *forward-only*: every recovery from a bad worker-stream deployment should resolve forward, not backward.

---

## Owner sign-off checklist

Before declaring the migration complete:

- [ ] `supabase functions deploy cluster-consumer` / `ingest` / `image-consumer` all returned success
- [ ] Migrations 024, 025, 026 applied; verification SQL above returned the expected rows
- [ ] `cron.job` shows `cluster-drain` and `image-drain` with `active = true`
- [ ] `cron.job_run_details` shows recent runs with `status = 'succeeded'`
- [ ] `CRON_SECRET` env var is set on Vercel production
- [ ] `vercel --prod` deploy landed with the new `/api/cron/headline` schedule
- [ ] `/api/health` reports `clustering.lag_minutes < 15`
- [ ] No `node scripts/*-worker.mjs` processes running anywhere
- [ ] At least one cluster created in the last 15 minutes (`select count(*) from clusters where created_at > now() - interval '15 minutes'`)
- [ ] At least one image backfilled in the last 15 minutes (`select count(*) from articles where image_url is not null and updated_at > now() - interval '15 minutes'`)
