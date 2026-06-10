/**
 * Edge-runtime Sentry wrapper (B8).
 *
 * Used by middleware and any Route Handler that opts into
 * `export const runtime = "edge"`. The Edge bundle of `@sentry/nextjs` is
 * smaller than the Node bundle (no auto-instrumentations, no Node built-ins)
 * but exposes the same `captureException` / `addBreadcrumb` shape.
 *
 * This file deliberately mirrors the API of `src/lib/sentry/server.ts` so a
 * route migrating between runtimes doesn't need to update its call sites —
 * only the import path changes.
 */
import * as Sentry from "@sentry/nextjs";

/** See `src/lib/sentry/server.ts#captureServerException`. */
export function captureEdgeException(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (context) {
    Sentry.captureException(err, { extra: context });
    return;
  }
  Sentry.captureException(err);
}

/** See `src/lib/sentry/server.ts#addServerBreadcrumb`. */
export function addEdgeBreadcrumb(
  message: string,
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({
    category: "edge",
    message,
    level: "info",
    data,
  });
}

export { Sentry };
