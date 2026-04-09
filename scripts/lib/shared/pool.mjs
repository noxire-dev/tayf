// scripts/lib/shared/pool.mjs
//
// Bounded-concurrency promise pool. Replaces the inline sliding-window
// implementations in rss-worker.mjs and image-worker.mjs, both of which
// used the same shared-cursor + N-workers pattern. Behaves like
// Promise.allSettled() but caps in-flight work at `concurrency`.
//
// The worker callback receives (item, index) and may return any value or
// throw — results are returned in the SAME ORDER as `items` so callers can
// pair results back to inputs without bookkeeping. Throws are converted to
// `{ status: "rejected", reason }` shapes; clean returns become
// `{ status: "fulfilled", value }`.
//
// An optional `shouldStop` predicate is checked before dispatching each
// item, so callers wired to a shutdown signal (installShutdownHandler)
// can interrupt the pool cleanly. When shouldStop returns true the pool
// stops issuing new work and resolves with whatever has completed so far;
// remaining slots are filled with `{ status: "rejected", reason: "shutdown" }`.
//
// Usage:
//   import { runPool } from "./lib/shared/pool.mjs";
//
//   const results = await runPool(items, {
//     concurrency: 8,
//     worker: async (item, i) => doWork(item),
//     shouldStop: () => shutdown.isShuttingDown(),
//   });
//
//   for (let i = 0; i < results.length; i++) {
//     if (results[i].status === "fulfilled") use(results[i].value);
//     else logError(results[i].reason);
//   }

const DEFAULT_CONCURRENCY = 8;

/**
 * Run `worker(item, index)` over each item with bounded concurrency.
 * Returns an array of result records in the same order as `items`.
 *
 * Result shape:
 *   { status: "fulfilled", value }  // worker resolved
 *   { status: "rejected", reason }  // worker threw or pool was halted
 *
 * @template T, R
 * @param {T[]} items
 * @param {{
 *   concurrency?: number,
 *   worker: (item: T, index: number) => Promise<R> | R,
 *   shouldStop?: () => boolean,
 * }} opts
 * @returns {Promise<Array<{ status: "fulfilled", value: R } | { status: "rejected", reason: unknown }>>}
 */
export async function runPool(items, opts) {
  if (!opts || typeof opts.worker !== "function") {
    throw new TypeError("runPool: opts.worker is required");
  }
  const worker = opts.worker;
  const shouldStop = typeof opts.shouldStop === "function" ? opts.shouldStop : null;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  const n = items.length;
  if (n === 0) return [];

  const results = new Array(n);
  let cursor = 0;
  let halted = false;

  async function runOne() {
    while (true) {
      if (shouldStop && shouldStop()) {
        halted = true;
        return;
      }
      const i = cursor++;
      if (i >= n) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(concurrency, n);
  const workers = [];
  for (let w = 0; w < workerCount; w++) workers.push(runOne());
  await Promise.all(workers);

  // Fill any unfilled slots (only happens if shouldStop tripped mid-run).
  if (halted) {
    for (let i = 0; i < n; i++) {
      if (!results[i]) {
        results[i] = { status: "rejected", reason: new Error("shutdown") };
      }
    }
  }

  return results;
}
