// supabase/functions/_shared/supabase.ts
//
// Service-role Supabase client factory for Edge Functions (Deno 2.x).
//
// Edge Functions get the service-role key from the
// `SUPABASE_SERVICE_ROLE_KEY` env var that the platform injects into every
// invocation; we fall back to `Deno.env.get("SB_URL")` / `SB_SERVICE_ROLE_KEY`
// when running under `supabase functions serve` locally with an .env file
// that mirrors `.env.local`.
//
// We use `npm:@supabase/supabase-js@2` — Deno 2.x natively resolves the
// `npm:` specifier, so the same package the Node workers used is reused
// here without a separate bundle step.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

function readEnv(name: string): string | undefined {
  // Deno.env.get can throw under restricted permissions; guard for safety.
  try {
    return Deno.env.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

export function createServiceClient(): SupabaseClient {
  const url = readEnv("SUPABASE_URL")
    ?? readEnv("SB_URL")
    ?? readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY")
    ?? readEnv("SB_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "[supabase] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { "x-tayf-runtime": "edge" },
    },
  });
}

export type { SupabaseClient };
