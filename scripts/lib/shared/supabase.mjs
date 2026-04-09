// scripts/lib/shared/supabase.mjs
//
// Shared Supabase service-role client factory. Both workers need a server-side
// client with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, with session
// persistence and auto-refresh disabled (we're a long-running process).

import { createClient } from "@supabase/supabase-js";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[supabase] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
