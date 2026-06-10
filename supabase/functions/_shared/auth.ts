// supabase/functions/_shared/auth.ts
//
// Defence-in-depth bearer auth for Edge Function handlers. Supabase already
// gates these functions behind a service-role JWT (the `--no-verify-jwt` deploy
// flag is intentionally NOT used), but we layer an explicit constant-time
// check here so that:
//
//   1. A misdeploy (someone passes `--no-verify-jwt` by accident) does not
//      silently expose the worker endpoints.
//   2. Tests against a local supabase stack can exercise the auth path with
//      a known-good bearer token without involving JWT signing.
//   3. The handler returns a deterministic JSON-shaped 401 rather than the
//      generic gateway error, so observability dashboards can distinguish
//      "auth failed" from "function crashed".
//
// The expected bearer value is `SUPABASE_SERVICE_ROLE_KEY` from the runtime
// env. Comparison is constant-time via byte-by-byte XOR over the UTF-8
// encoding so a timing oracle cannot leak the key prefix.

const JSON_HEADERS = { "content-type": "application/json" } as const;

function unauthorized(reason: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: "unauthorized", reason }),
    { status: 401, headers: JSON_HEADERS },
  );
}

/**
 * Constant-time equality on two UTF-8 byte strings. Returns false immediately
 * on length mismatch (length itself is not a secret — keys are fixed-width
 * per Supabase project), then XORs every pair of bytes so the loop always
 * runs in O(min(a, b)) regardless of where the first differing byte sits.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i]! ^ bb[i]!;
  }
  return diff === 0;
}

/**
 * Returns a 401 `Response` if the request is missing a valid
 * `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` header, or `null` if
 * the bearer matches. Callers should:
 *
 *     const denied = requireServiceRoleBearer(req);
 *     if (denied) return denied;
 *
 * at the very top of `Deno.serve`, ahead of method checks and body parsing.
 *
 * Misconfiguration (the env var itself being unset) is treated as a hard 401
 * so a stripped deploy cannot accidentally accept the empty string as a
 * valid bearer.
 */
export function requireServiceRoleBearer(req: Request): Response | null {
  // Two accepted bearers, both constant-time compared:
  //   1. SUPABASE_SERVICE_ROLE_KEY — auto-injected by the runtime. On
  //      projects using the new API-key system this is the (reveal-once,
  //      otherwise-unretrievable) `sb_secret_*` key.
  //   2. WORKER_CRON_SECRET — an operator-set secret used by the pg_cron
  //      drains, which cannot read the runtime's injected service key. The
  //      same value lives in Supabase Vault and is sent by the cron's
  //      net.http_post Authorization header. This is the path the
  //      worker-stream pipeline actually uses to invoke the drains.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("WORKER_CRON_SECRET") ?? "";
  if (serviceKey.length === 0 && cronSecret.length === 0) {
    return unauthorized("server-misconfigured");
  }

  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) {
    return unauthorized("missing-authorization");
  }

  // RFC 6750 scheme is case-insensitive. Trim once so multi-space pastes
  // from operator runbooks still validate.
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(header);
  if (!match) {
    return unauthorized("malformed-authorization");
  }
  const presented = match[1] ?? "";

  const okService = serviceKey.length > 0 && constantTimeEqual(presented, serviceKey);
  const okCron = cronSecret.length > 0 && constantTimeEqual(presented, cronSecret);
  if (!okService && !okCron) {
    return unauthorized("bad-bearer");
  }
  return null;
}
