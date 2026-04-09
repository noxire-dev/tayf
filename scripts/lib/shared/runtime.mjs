// scripts/lib/shared/runtime.mjs
//
// Worker runtime helpers — merged from sleep.mjs + signal.mjs + env.mjs +
// log.mjs to keep the shared lib surface small. All four were tiny utility
// modules with no real boundary between them; collapsing them also removes
// the signal → log circular import that existed before.
//
// Exports:
//
//   loadDotEnvLocal()             — read .env.local from repo root
//   ts()                          — HH:MM:SS timestamp
//   log(prefix, msg)              — stdout + team/status.log line
//   logCycle(prefix, summary)     — banner-style cycle summary line
//   installShutdownHandler(name)  — SIGINT/SIGTERM graceful shutdown
//   sleep(ms)                     — awaitable setTimeout
//   adaptiveSleep({...})          — 3-tier idle/small/productive
//   twoTierSleep({...})           — 2-tier work/idle

import { readFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// ---------------------------------------------------------------------------
// .env.local loader (was env.mjs)
// ---------------------------------------------------------------------------

const DEFAULT_ENV_PATH = resolve(REPO_ROOT, ".env.local");

export function loadDotEnvLocal(filePath = DEFAULT_ENV_PATH) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    console.warn(`[env] could not read ${filePath}: ${err.message}`);
    return;
  }
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Logging (was log.mjs)
// ---------------------------------------------------------------------------

const STATUS_LOG_PATH = resolve(REPO_ROOT, "team", "status.log");

export function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function appendStatus(line) {
  try {
    appendFileSync(STATUS_LOG_PATH, line + "\n", "utf8");
  } catch {
    // status log is best-effort — never let a log failure kill the worker.
  }
}

// log("worker", "rss-worker starting") →
//   stdout: "13:42:01 [worker] rss-worker starting"
//   status.log: "13:42:01 WORKER: rss-worker starting"
export function log(prefix, msg) {
  const stamp = ts();
  const p = String(prefix);
  console.log(`${stamp} [${p}] ${msg}`);
  appendStatus(`${stamp} ${p.toUpperCase()}: ${msg}`);
}

// Banner-style cycle summary. Kept separate so banner formatting can evolve
// independently from generic log() calls.
export function logCycle(prefix, summary) {
  const stamp = ts();
  const p = String(prefix);
  console.log(`--- ${stamp} [${p}] ${summary} ---`);
  appendStatus(`${stamp} ${p.toUpperCase()}: ${summary}`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown (was signal.mjs)
// ---------------------------------------------------------------------------

export function installShutdownHandler(name) {
  let shuttingDown = false;

  function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("worker", `${name}: shutting down (${signal})`);
    setTimeout(() => process.exit(0), 250).unref();
  }

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  return {
    isShuttingDown: () => shuttingDown,
  };
}

// ---------------------------------------------------------------------------
// Sleep helpers (was sleep.mjs)
// ---------------------------------------------------------------------------

/**
 * 3-tier sleep: idle (no work) / small (1..10) / productive (>10).
 * Each worker tunes the three durations to its own rhythm.
 */
export function adaptiveSleep({
  productive = 30_000,
  idle = 120_000,
  small = 60_000,
} = {}) {
  return (processedCount) => {
    if (processedCount === 0) return idle;
    if (processedCount > 10) return productive;
    return small;
  };
}

/**
 * 2-tier sleep: work (any) / idle (none). Used by image-worker.
 */
export function twoTierSleep({ work = 30_000, idle = 120_000 } = {}) {
  return (didWork) => (didWork ? work : idle);
}

/** Awaitable setTimeout. */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
