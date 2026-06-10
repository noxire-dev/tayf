import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { apiError, apiUnauthorized } from "@/lib/api/errors";

/**
 * Shared bearer auth for the CRON_SECRET-gated operational routes
 * (`/api/cron/headline`, `/api/metrics`, and the detailed `/api/health`
 * envelope). Each of those routes used to carry its own copy of the
 * constant-time comparison and the copies drifted — case-sensitive scheme
 * matching in some, divergent missing-secret handling in others. This
 * module is the single source of truth; do NOT re-inline a per-route check.
 *
 * POLICY: FAIL-CLOSED on a missing or empty `CRON_SECRET`. If the secret is
 * not configured there is no way to authenticate anyone, so
 * `requireCronBearer` refuses the request with the canonical 503 envelope
 * rather than waving callers through or silently downgrading them. This is
 * the one documented behaviour for every bearer-gated surface; the legacy
 * `/api/health` posture (treat everyone as anonymous when the secret is
 * unset) is intentionally gone. Audit T3 P0-9.
 */

// `Authorization` header shape. The scheme is matched case-insensitively
// (`Bearer` / `bearer` / `BEARER`) — RFC 9110 §11.1 makes auth schemes
// case-insensitive and some HTTP clients lowercase them. The token is
// everything after the whitespace and is compared byte-for-byte below.
const BEARER_HEADER = /^Bearer\s+(\S+)$/i;

/**
 * Constant-time bearer-token check.
 *
 * Returns true iff `header` carries the bearer scheme and its token matches
 * `secret` byte-for-byte. `timingSafeEqual` requires equal-length buffers,
 * so we short-circuit on length mismatch BEFORE the call to avoid the
 * throw — but only on length, never on content, so an attacker cannot
 * distinguish "wrong length" from "wrong bytes" via response time within
 * the same length class.
 */
export function checkBearer(header: string | null, secret: string): boolean {
  if (!header) return false;
  const provided = BEARER_HEADER.exec(header)?.[1];
  if (provided === undefined) return false;

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(secret, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Gate a request behind `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Reads `CRON_SECRET` exactly once per call. Returns a tagged union so
 * routes can early-return the canonical envelope without re-deriving
 * status codes:
 *
 *   - `{ ok: false, response }` 503 — `CRON_SECRET` unset/empty (FAIL-CLOSED)
 *   - `{ ok: false, response }` 401 — header missing or token mismatch
 *   - `{ ok: true }`                — caller authenticated
 */
export function requireCronBearer(
  request: Request
): { ok: true } | { ok: false; response: Response } {
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    return {
      ok: false,
      response: apiError(503, "CRON_SECRET is not configured"),
    };
  }
  if (!checkBearer(request.headers.get("authorization"), secret)) {
    return { ok: false, response: apiUnauthorized() };
  }
  return { ok: true };
}
