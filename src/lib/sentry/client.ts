/**
 * Browser-side Sentry wrapper (B8).
 *
 * Re-exports a narrow surface from `@sentry/nextjs` for use inside Client
 * Components (`"use client"`). The SDK is already initialised by
 * `sentry.client.config.ts`; this module is just the public API the rest of
 * the codebase uses so we can no-op it under test or swap the underlying SDK.
 *
 * Server-side code must import `src/lib/sentry/server.ts` instead — the
 * server entry of `@sentry/nextjs` references Node-only built-ins and breaks
 * if it leaks into a client bundle.
 */
"use client";

import * as Sentry from "@sentry/nextjs";

/**
 * Capture an exception from a Client Component error boundary or event
 * handler. Safe to call even when Sentry was never initialised (e.g. local
 * dev without a DSN).
 */
export function captureClientException(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (context) {
    Sentry.captureException(err, { extra: context });
    return;
  }
  Sentry.captureException(err);
}

export { Sentry };
