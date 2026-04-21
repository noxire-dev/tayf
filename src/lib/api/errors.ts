import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";

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
 * 500 — unexpected server error. Logs to stderr with an `[api]` prefix so
 * these stand out in Vercel / tmux logs, and returns the message back to the
 * caller. Swap the logger here if we ever wire up a real observability stack.
 */
export const apiServerError = (err: unknown, code?: string) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api]", message, err);
  return apiError(500, message, code ? { code } : undefined);
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
 * fall through to `apiServerError`.
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
      return apiServerError(err);
    }
  }) as T;
}
