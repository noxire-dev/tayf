#!/usr/bin/env bash
# Tayf master check — run before any commit or PR.
# Exits non-zero on the first failure.

set -e
set -o pipefail

export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

cd "$(dirname "$0")/.."

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Tayf master check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

ok() { printf "\033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "\033[31m✗\033[0m %s\n" "$1"; exit 1; }

# 1. TypeScript
echo "→ TypeScript compile (tsc --noEmit)"
if npx tsc --noEmit > /tmp/check-tsc.log 2>&1; then
  ok "tsc clean"
else
  cat /tmp/check-tsc.log | head -20
  fail "tsc errors (see /tmp/check-tsc.log)"
fi

# 2. ESLint
echo "→ ESLint (src/)"
if npx eslint src --max-warnings=50 > /tmp/check-eslint.log 2>&1; then
  ok "eslint clean"
else
  cat /tmp/check-eslint.log | head -20
  fail "eslint errors (see /tmp/check-eslint.log)"
fi

# 3. node --check on every worker + lib
echo "→ Worker syntax (node --check)"
for f in scripts/*.mjs scripts/lib/shared/*.mjs scripts/lib/cluster/*.mjs; do
  if [ -f "$f" ]; then
    if ! node --check "$f" > /dev/null 2>&1; then
      fail "syntax error in $f"
    fi
  fi
done
ok "all workers + libs parse"

# 4. Cluster algorithm self-tests (each lib has its own `node`-runnable
#    test block at the bottom; vitest used to wrap them in *.test.mjs but
#    that was duplicate coverage, so the runtime self-tests are the only
#    suite for these now).
echo "→ Cluster lib self-tests"
for f in scripts/lib/cluster/ensemble.mjs scripts/lib/cluster/entities.mjs scripts/lib/cluster/fingerprint.mjs; do
  if ! node "$f" > /tmp/check-cluster-lib.log 2>&1; then
    cat /tmp/check-cluster-lib.log
    fail "self-test failed in $f"
  fi
done
ok "cluster lib self-tests"

# 5. Vitest unit tests (cross-spectrum, admin api integration)
echo "→ Vitest"
if npm test > /tmp/check-vitest.log 2>&1; then
  PASSED=$(grep -oE "Tests [0-9]+ passed" /tmp/check-vitest.log | head -1 || echo "n/a")
  ok "vitest ($PASSED)"
else
  tail -30 /tmp/check-vitest.log
  fail "vitest failures (see /tmp/check-vitest.log)"
fi

# 5. HTTP smoke checks (only if dev server is up)
if curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -q "200"; then
  echo "→ HTTP smoke (dev server on :3000)"
  for route in / /admin /api/admin /blindspots /sources; do
    code=$(curl -sS -o /dev/null -w "%{http_code}" "http://localhost:3000$route" 2>/dev/null || echo "000")
    if [ "$code" != "200" ] && [ "$code" != "404" ]; then
      fail "$route returned $code"
    fi
  done
  ok "all routes 200/404"
else
  echo "→ HTTP smoke SKIPPED (dev server not on :3000)"
fi

# 6. Workers alive check (non-fatal info)
echo "→ Worker liveness"
RSS_PID=$(pgrep -f "rss-worker.mjs" || true)
CLUSTER_PID=$(pgrep -f "cluster-worker.mjs" || true)
IMAGE_PID=$(pgrep -f "image-worker.mjs" || true)
[ -n "$RSS_PID" ] && ok "rss-worker running (pid $RSS_PID)" || echo "  (rss-worker not running — ok if unexpected)"
[ -n "$CLUSTER_PID" ] && ok "cluster-worker running (pid $CLUSTER_PID)" || echo "  (cluster-worker not running)"
[ -n "$IMAGE_PID" ] && ok "image-worker running (pid $IMAGE_PID)" || echo "  (image-worker not running)"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "ALL CHECKS PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
