/**
 * In-memory token-bucket rate limiter.
 *
 * Each named limiter owns a slice of the shared `buckets` map keyed by
 * `${name}:${clientKey}`. Tokens refill linearly between calls based on the
 * elapsed wall-clock time, and idle buckets are evicted by a periodic sweep
 * so a long-running process doesn't accumulate stale entries.
 *
 * NOTE: This implementation is intentionally process-local. It is fine for
 * single-instance dev / a single Node container, but a production deployment
 * with multiple instances (e.g. Vercel serverless, horizontal autoscaling)
 * would need a shared store such as Redis (`@upstash/ratelimit`) so the
 * buckets stay consistent across replicas. Swap `buckets` for a Redis-backed
 * implementation when that day comes — the `check` return shape can stay the
 * same.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimiterOptions {
  capacity: number; // max tokens per bucket
  refillPerSecond: number; // tokens added per second
  ttlMs?: number; // how long to keep an idle bucket
}

const buckets = new Map<string, Bucket>();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createRateLimiter(name: string, opts: RateLimiterOptions) {
  const { capacity, refillPerSecond } = opts;

  return function check(key: string): { allowed: boolean; retryAfterMs: number } {
    const bucketKey = `${name}:${key}`;
    const now = Date.now();
    let bucket = buckets.get(bucketKey);

    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      buckets.set(bucketKey, bucket);
    } else {
      // Refill based on elapsed time
      const elapsedSec = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + elapsedSec * refillPerSecond
      );
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }

    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil((tokensNeeded / refillPerSecond) * 1000);
    return { allowed: false, retryAfterMs };
  };
}

// Periodic cleanup of idle buckets. `unref()` keeps the timer from holding
// the Node process alive on its own (important during test runs).
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > DEFAULT_TTL_MS) {
      buckets.delete(key);
    }
  }
}, 60 * 1000);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

/** Extract a client identifier from a Request. Falls back to "anon". */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "anon";
}
