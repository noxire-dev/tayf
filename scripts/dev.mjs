#!/usr/bin/env node
// scripts/dev.mjs
//
// Single-terminal orchestrator for the Tayf development stack.
// Spawns all three background workers + the Next.js dev server, prefixes
// their output with color-coded labels, and forwards SIGINT/SIGTERM to
// every child so Ctrl-C shuts everything down cleanly.
//
// Usage:
//   node scripts/dev.mjs          # start everything
//   node scripts/dev.mjs --prod   # use `next start` instead of `next dev`
//
// Requires: Node 20+, npm dependencies already installed.

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const isProd = process.argv.includes("--prod");

// ANSI color codes for each worker's label.
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

// Worker definitions. `delay` staggers startup so the dev server binds
// its port before the workers start hitting Supabase (avoids a wall of
// interleaved init logs).
const WORKERS = [
  {
    name: "next",
    color: COLORS.green,
    cmd: process.execPath,
    args: isProd
      ? ["node_modules/next/dist/bin/next", "start"]
      : ["node_modules/next/dist/bin/next", "dev"],
    delay: 0,
    critical: true, // if Next.js dies, shut everything down
  },
  {
    name: "rss",
    color: COLORS.cyan,
    cmd: process.execPath,
    args: ["scripts/rss-worker.mjs"],
    delay: 2000,
    critical: false,
  },
  {
    name: "cluster",
    color: COLORS.yellow,
    cmd: process.execPath,
    args: ["scripts/cluster-worker.mjs"],
    delay: 3000,
    critical: false,
  },
];

const MAX_NAME_LEN = Math.max(...WORKERS.map((w) => w.name.length));
const children = new Map();
let shuttingDown = false;

function prefix(worker) {
  const padded = worker.name.padEnd(MAX_NAME_LEN);
  return `${worker.color}[${padded}]${COLORS.reset}`;
}

function ts() {
  return COLORS.dim + new Date().toLocaleTimeString("tr-TR") + COLORS.reset;
}

function pipeLogs(child, worker) {
  const tag = prefix(worker);
  const pipe = (stream) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        if (line.trim()) console.log(`${ts()} ${tag} ${line}`);
      }
    });
    stream.on("end", () => {
      if (buffer.trim()) console.log(`${ts()} ${tag} ${buffer}`);
    });
  };
  if (child.stdout) pipe(child.stdout);
  if (child.stderr) pipe(child.stderr);
}

function spawnWorker(worker) {
  const child = spawn(worker.cmd, worker.args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  children.set(worker.name, child);
  pipeLogs(child, worker);

  child.on("exit", (code, signal) => {
    children.delete(worker.name);
    if (shuttingDown) return;

    if (worker.critical) {
      console.log(
        `\n${ts()} ${prefix(worker)} ${COLORS.red}critical process exited (code=${code}, signal=${signal}) — shutting down${COLORS.reset}`
      );
      shutdown();
    } else {
      console.log(
        `${ts()} ${prefix(worker)} exited (code=${code}). Restarting in 5s...`
      );
      setTimeout(() => {
        if (!shuttingDown) spawnWorker(worker);
      }, 5000);
    }
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    `\n${ts()} ${COLORS.magenta}[tayf]${COLORS.reset} shutting down all workers...`
  );

  for (const [name, child] of children) {
    try {
      // On Windows, tree-kill the process group. On Unix, send SIGTERM.
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // already dead
    }
  }

  // Force exit after 5s if children hang
  setTimeout(() => process.exit(0), 5000).unref();
}

// Forward Ctrl-C and SIGTERM to children
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Banner
console.log(`
${COLORS.magenta}╔══════════════════════════════════════╗
║          ${COLORS.reset}tayf dev stack${COLORS.magenta}               ║
╚══════════════════════════════════════╝${COLORS.reset}
  ${COLORS.green}next${COLORS.reset}     ${isProd ? "next start (production)" : "next dev (development)"}
  ${COLORS.cyan}rss${COLORS.reset}      rss-worker (60s cycle)
  ${COLORS.yellow}cluster${COLORS.reset}  cluster-worker (30s cycle)

  Press ${COLORS.dim}Ctrl-C${COLORS.reset} to stop all.
`);

// Stagger startup
for (const worker of WORKERS) {
  setTimeout(() => {
    if (!shuttingDown) {
      console.log(
        `${ts()} ${prefix(worker)} starting: ${worker.cmd} ${worker.args.join(" ")}`
      );
      spawnWorker(worker);
    }
  }, worker.delay);
}
