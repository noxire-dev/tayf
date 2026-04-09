// scripts/lib/shared/circuit-breaker.mjs
//
// Shared dead-key circuit breaker for long-running workers. Tracks
// consecutive failures per key and "trips" the breaker after a threshold,
// causing the key to be skipped for a cooldown window. A successful call
// resets the counter.
//
// Originally extracted from rss-worker.mjs (keyed by source slug) and
// image-worker.mjs (keyed by hostname). Both implementations behaved
// identically modulo the key shape, so this module replaces both inline
// versions with a single API.
//
// Usage:
//   import { createCircuitBreaker } from "./lib/shared/circuit-breaker.mjs";
//
//   const breaker = createCircuitBreaker({
//     failureThreshold: 3,
//     cooldownMs: 30 * 60 * 1000,
//   });
//
//   if (!breaker.allow(key)) return; // skipped: tripped
//   try {
//     await doWork();
//     breaker.recordSuccess(key);
//   } catch (err) {
//     const tripped = breaker.recordFailure(key);
//     if (tripped) log("worker", `[${key}] circuit open`);
//   }

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Create a circuit breaker. Returns an object with `allow`, `recordSuccess`,
 * `recordFailure`, and `getSnapshot` methods. Each breaker keeps its own
 * internal state Map; create one per breaker domain (sources, hosts, etc).
 *
 * @param {{ failureThreshold?: number, cooldownMs?: number }} [opts]
 */
export function createCircuitBreaker(opts = {}) {
  const failureThreshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  /** @type {Map<string, { failures: number, skipUntil: number }>} */
  const state = new Map();

  return {
    /**
     * Returns true if the key is allowed through (breaker not tripped or
     * cooldown expired). Returns false if the breaker is currently open.
     * Empty/null keys are always allowed (caller couldn't classify).
     */
    allow(key) {
      if (!key) return true;
      const entry = state.get(key);
      if (!entry) return true;
      return entry.skipUntil <= Date.now();
    },

    /**
     * Record a successful call for `key`. Resets the failure counter and
     * clears any pending cooldown.
     */
    recordSuccess(key) {
      if (!key) return;
      state.set(key, { failures: 0, skipUntil: 0 });
    },

    /**
     * Record a failed call for `key`. Increments the failure counter; if it
     * reaches `failureThreshold`, the breaker trips and the key will be
     * skipped for `cooldownMs`. Returns an object describing the new state:
     *
     *   { failures, tripped }
     *
     * `tripped` is true ONLY on the cycle that crosses the threshold, so
     * callers can emit a one-shot "circuit open" log line. Subsequent
     * failures while the breaker is already open keep `tripped: false`.
     */
    recordFailure(key) {
      if (!key) return { failures: 0, tripped: false };
      const prev = state.get(key) || { failures: 0, skipUntil: 0 };
      const failures = prev.failures + 1;
      const justTripped = failures === failureThreshold;
      const skipUntil = failures >= failureThreshold
        ? Date.now() + cooldownMs
        : 0;
      state.set(key, { failures, skipUntil });
      return { failures, tripped: justTripped };
    },

    /**
     * Snapshot of breaker state for diagnostics. Returns:
     *
     *   {
     *     tripped: Array<{ key, failures, skipUntil, msUntilRetry }>,
     *     activeCount: number,
     *     nextRetryMs: number  // earliest skipUntil across tripped entries,
     *                          // or Infinity if nothing is tripped
     *   }
     */
    getSnapshot() {
      const now = Date.now();
      const tripped = [];
      let nextRetryMs = Infinity;
      for (const [key, entry] of state.entries()) {
        if (entry.skipUntil > now) {
          tripped.push({
            key,
            failures: entry.failures,
            skipUntil: entry.skipUntil,
            msUntilRetry: entry.skipUntil - now,
          });
          if (entry.skipUntil < nextRetryMs) nextRetryMs = entry.skipUntil;
        }
      }
      return { tripped, activeCount: tripped.length, nextRetryMs };
    },
  };
}
