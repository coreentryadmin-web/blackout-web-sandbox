#!/usr/bin/env node
/**
 * Profile SPX bootstrap cold path — local builders + optional prod API probe.
 *
 * Usage:
 *   node scripts/spx-bootstrap-cold-profile.mjs
 *   node scripts/spx-bootstrap-cold-profile.mjs --remote=https://blackouttrades.com
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const OUT = "/opt/cursor/artifacts/spx-bootstrap-profile";
mkdirSync(OUT, { recursive: true });

const remoteBase = process.argv.find((a) => a.startsWith("--remote="))?.slice(9)?.replace(/\/$/, "");

console.log("\n=== SPX bootstrap cold profile ===\n");

const local = spawnSync("npx", ["tsx", "scripts/spx-bootstrap-cold-profile-runner.ts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: process.env,
  timeout: 300_000,
});

if (local.stdout) process.stdout.write(local.stdout);
if (local.stderr) process.stderr.write(local.stderr);

let remote = null;
if (remoteBase) {
  console.log(`\n--- remote lane probe (${remoteBase}) ---\n`);
  const session = await mintIosPlaywrightSession({ appUrl: remoteBase });
  if (session.skip) {
    console.log(`  SKIP remote: ${session.reason}`);
  } else {
    const cookieHeader = session.cookies
      .filter((c) => c.name === "__session" || c.name === "__client_uat")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const paths = [
      "/api/market/spx/bootstrap",
      "/api/market/spx/desk",
      "/api/market/spx/flow",
      "/api/market/spx/pulse",
      "/api/market/gex-heatmap?ticker=SPX",
    ];

    remote = { base: remoteBase, lanes: [], warm: [] };
    for (const path of paths) {
      const t0 = performance.now();
      const res = await fetch(`${remoteBase}${path}`, {
        headers: { Cookie: cookieHeader, Accept: "application/json" },
      });
      await res.text();
      const ms = Math.round(performance.now() - t0);
      remote.lanes.push({ path, status: res.status, ms, pass: "cold-ish" });
      console.log(`  ${String(ms).padStart(6)}ms  ${path} HTTP ${res.status} (1st pass)`);
    }

    console.log("\n  --- warm pass (same session, caches hot) ---\n");
    for (const path of paths) {
      const t0 = performance.now();
      const res = await fetch(`${remoteBase}${path}`, {
        headers: { Cookie: cookieHeader, Accept: "application/json" },
      });
      await res.text();
      const ms = Math.round(performance.now() - t0);
      remote.warm.push({ path, status: res.status, ms });
      console.log(`  ${String(ms).padStart(6)}ms  ${path} HTTP ${res.status} (2nd pass)`);
    }
    await session.cleanup?.();
  }
}

const stamp = Date.now();
const combined = {
  ts: new Date().toISOString(),
  localExit: local.status,
  localStdout: local.stdout?.trim() ?? "",
  remote,
};
writeFileSync(join(OUT, `profile-${stamp}.json`), JSON.stringify(combined, null, 2));
console.log(`\nArtifact: ${OUT}/profile-${stamp}.json\n`);
process.exit(local.status ?? 1);
