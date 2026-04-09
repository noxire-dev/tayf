-- 021: Newsletter subscriber table for the signup-form MVP.
-- The form lives in src/components/newsletter/signup-form.tsx and posts to
-- /api/newsletter; that route inserts into this table. `confirmed` is reserved
-- for a future double-opt-in flow (email confirm link) — for the MVP rows
-- start out unconfirmed and we just dedupe on the unique email index.

create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now(),
  confirmed boolean not null default false
);

-- Quick lookup for the (eventual) "send to all confirmed subscribers" job.
create index if not exists idx_newsletter_subscribers_confirmed
  on newsletter_subscribers (confirmed)
  where confirmed = true;
