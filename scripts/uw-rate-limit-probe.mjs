#!/usr/bin/env node
/**
 * Live probe of Unusual Whales REST rate limits — reads x-uw-* headers and finds 429 threshold.
 * Usage: node scripts/uw-rate-limit-probe.mjs [--burst=N] [--rps=N] [--duration-sec=N]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://api.unusualwhales.com";
const PATH = "/api/market/market-tide";
const OUT = "/opt/cursor/artifacts/uw-rate-limit-probe";
mkdirSync(OUT, { recursive: true });

const KEY = process.env.UW_API_KEY?.trim();
const CLIENT_ID = process.env.UW_CLIENT_API_ID?.trim() || "100001";

if (!KEY) {
  console.error("UW_API_KEY not set");
  process.exit(1);
}

const args = process.argv.slice(2);
const burstN = Number(args.find((a) => a.startsWith("--burst="))?.slice(8) ?? 0);
const rps = Number(args.find((a) => a.startsWith("--rps="))?.slice(6) ?? 0);
const durationSec = Number(args.find((a) => a.startsWith("--duration-sec="))?.slice(15) ?? 0);

function uwHeaders(res) {
  const pick = (name) => res.headers.get(name);
  return {
    "x-uw-daily-req-count": pick("x-uw-daily-req-count"),
    "x-uw-token-req-limit": pick("x-uw-token-req-limit"),
    "x-uw-minute-req-counter": pick("x-uw-minute-req-counter"),
    "x-uw-req-per-minute-remaining": pick("x-uw-req-per-minute-remaining"),
    "x-uw-req-per-minute-reset": pick("x-uw-req-per-minute-reset"),
    "retry-after": pick("retry-after"),
  };
}

async function uwGet(label) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${PATH}?interval_5m=false`, {
    headers: {
      Authorization: `Bearer ${KEY}`,
      "UW-CLIENT-API-ID": CLIENT_ID,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const ms = Math.round(performance.now() - t0);
  let bodySnippet = "";
  try {
    const text = await res.text();
    bodySnippet = text.slice(0, 120);
  } catch {
    bodySnippet = "";
  }
  return {
    label,
    status: res.status,
    ms,
    headers: uwHeaders(res),
    bodySnippet,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runBurst(n) {
  console.log(`\n--- burst: ${n} parallel requests ---`);
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => uwGet(`burst-${i + 1}`))
  );
  for (const r of results) {
    console.log(
      `  ${r.label} HTTP ${r.status} ${r.ms}ms remaining=${r.headers["x-uw-req-per-minute-remaining"]} counter=${r.headers["x-uw-minute-req-counter"]}`
    );
  }
  return results;
}

async function runPaced(targetRps, seconds) {
  console.log(`\n--- paced: ${targetRps} rps for ${seconds}s ---`);
  const intervalMs = Math.max(1, Math.round(1000 / targetRps));
  const results = [];
  const end = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < end) {
    const r = await uwGet(`paced-${targetRps}rps-${++i}`);
    results.push(r);
    if (r.status === 429) {
      console.log(`  429 at request #${i} after ${results.length} in window`);
      break;
    }
    if (i % 10 === 0 || i <= 3) {
      console.log(
        `  #${i} HTTP ${r.status} ${r.ms}ms remaining=${r.headers["x-uw-req-per-minute-remaining"]} daily=${r.headers["x-uw-daily-req-count"]}/${r.headers["x-uw-token-req-limit"]}`
      );
    }
    await sleep(intervalMs);
  }
  return results;
}

async function main() {
  console.log("=== UW REST rate limit probe ===");
  console.log(`Endpoint: ${PATH}`);
  console.log(`Time (UTC): ${new Date().toISOString()}\n`);

  const baseline = await uwGet("baseline");
  console.log("--- baseline (single request) ---");
  console.log(JSON.stringify(baseline, null, 2));

  const all = { ts: new Date().toISOString(), baseline, phases: [] };

  if (burstN > 0) {
    all.phases.push({ type: "burst", n: burstN, results: await runBurst(burstN) });
    await sleep(2000);
  } else {
    all.phases.push({ type: "burst", n: 25, results: await runBurst(25) });
    await sleep(3000);
  }

  if (rps > 0 && durationSec > 0) {
    all.phases.push({
      type: "paced",
      rps,
      seconds: durationSec,
      results: await runPaced(rps, durationSec),
    });
  } else {
    all.phases.push({ type: "paced", rps: 2, seconds: 35, results: await runPaced(2, 35) });
    await sleep(5000);
    all.phases.push({ type: "paced", rps: 5, seconds: 30, results: await runPaced(5, 30) });
  }

  const stamp = Date.now();
  const outPath = join(OUT, `probe-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(all, null, 2));

  const allResults = all.phases.flatMap((p) => p.results);
  const counts = allResults.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const first429 = allResults.find((r) => r.status === 429);

  console.log("\n--- summary ---");
  console.log("Status counts:", counts);
  if (first429) {
    console.log("First 429:", first429.label, first429.headers);
  } else {
    console.log("No 429 observed in this probe window");
  }
  console.log(`Artifact: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
