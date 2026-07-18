#!/usr/bin/env node
/**
 * Market-data worker supervisor for ECS Fargate.
 *
 * Starts the Next standalone server and eagerly boots upstream WebSockets via
 * /api/worker/boot once HTTP is up. Keeps the child server as the main process
 * tree root so SIGTERM from ECS propagates normally.
 */
import { spawn } from "node:child_process";

const port = Number(process.env.PORT || 3000);
const host = process.env.WORKER_BOOT_HOST || "127.0.0.1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPath(path, attempts = 45) {
  const url = `http://${host}:${port}${path}`;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* server still booting */
    }
    await sleep(2_000);
  }
  return false;
}

const childEnv = {
  ...process.env,
  PROCESS_ROLE: process.env.PROCESS_ROLE || "ingest",
  EAGER_DATA_SOCKETS: "1",
  REPLICA_COUNT: process.env.REPLICA_COUNT || "1",
};

const child = spawn("node", ["server.js"], {
  stdio: "inherit",
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[market-worker] server exited on signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));

(async () => {
  const healthy = await waitForPath("/api/worker/health");
  if (!healthy) {
    console.error("[market-worker] server did not pass /api/worker/health");
    child.kill("SIGTERM");
    return;
  }

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://${host}:${port}/api/worker/boot`);
      if (res.ok) {
        console.log("[market-worker] data sockets boot requested");
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(2_000);
  }

  console.error("[market-worker] /api/worker/boot never succeeded");
  child.kill("SIGTERM");
})();
