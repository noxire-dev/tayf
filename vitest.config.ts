import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // `tests/**/*.test.{ts,tsx}` deliberately covers the Edge Function
    // suites under `tests/functions/**` (cluster-consumer, image-consumer,
    // ingest, _shared/*) as well as the route / migration suites under
    // `tests/api/**` and `tests/migrations/**`. Keep this glob broad —
    // narrowing it to e.g. `tests/api/**` will silently drop the function
    // tests and the SSRF / CP1254 / sha1 regressions they cover.
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.{mjs,js,ts}",
      "tests/**/*.test.{ts,tsx}",
    ],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
