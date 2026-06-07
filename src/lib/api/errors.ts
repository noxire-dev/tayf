import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { captureServerException } from "@/lib/sentry/server";

/**
 * Canonical error response shape for every JSON route under `src/app/api/`.
 *
 * Keeping this in one place means clients can rely on `error` always being a
 * human-readable string, with optional `code` / `details` for programmatic
 * handling. Do NOT inline new shapes in individual routes — extend this type
 * instead so the contract stays consistent.
 */
export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/** Build a consistent error response. */
export function apiError(
  status: number,
  message: string,
  opts: Omit<ApiError, "error"> = {}
) {
  return NextResponse.json<ApiError>(
    { error: message, ...opts },
    { status }
  );
}

/** 401 — missing or invalid credentials. */
export const apiUnauthorized = (reason = "Unauthorized") =>
  apiError(401, reason);

/** 400 — the request itself is malformed or fails validation. */
export const apiBadRequest = (
  reason: string,
  details?: Record<string, unknown>
) => apiError(400, reason, details ? { details } : undefined);

/** 404 — resource not found. */
export const apiNotFound = (what = "Not found") => apiError(404, what);

/**
 * 500 — unexpected server error. Logs the raw error (with stack) to stderr
 * under an `[api]` prefix tagged with a per-invocation `request_id`, and
 * returns ONLY a generic message plus that `request_id` to the caller. The
 * raw `err.message` is NEVER serialised into the response body — Supabase /
 * upstream error strings frequently embed table names, constraint names,
 * and other internal schema detail we don't want to hand to an attacker.
 * Operators correlate a user-visible `request_id` to the matching stderr
 * line for triage. Swap the logger here if we ever wire up a real
 * observability stack.
 */
export const apiServerError = (err: unknown, code?: string) => {
  const requestId = crypto.randomUUID();
  console.error("[api]", requestId, err);
  return apiError(
    500,
    "Internal server error",
    code ? { code, details: { request_id: requestId } } : { details: { request_id: requestId } },
  );
};

/**
 * Wrap a route handler to catch thrown errors uniformly.
 *
 * Next.js route handlers have varied signatures (`()`, `(req)`, `(req, ctx)`),
 * so the generic is intentionally permissive. Any handler that returns a
 * `Promise<Response>` is accepted; thrown errors become a 500 via
 * `apiServerError` instead of Next's default HTML error page.
 *
 * `unstable_rethrow` is called before treating an error as a 500 because
 * Next.js uses thrown errors as control-flow signals — `redirect()`,
 * `notFound()`, `NEXT_PRERENDER_INTERRUPTED` (bail out of prerender when
 * a route touches request.headers / cookies / dynamic APIs), etc. Those
 * errors MUST propagate up to Next's internals or the framework gets
 * confused and logs spurious 500s during build/prerender. Real errors
 * are reported to Sentry (B8 observability) and then fall through to
 * `apiServerError`. Sentry capture runs AFTER `unstable_rethrow` so we
 * don't pollute Sentry with framework control-flow signals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withApiErrors<T extends (...args: any[]) => Promise<Response>>(
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (err) {
      unstable_rethrow(err);
      captureServerException(err);
      return apiServerError(err);
    }
  }) as T;
}
