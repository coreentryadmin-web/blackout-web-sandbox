#!/usr/bin/env node
/**
 * Vector RTH minute monitor — admin Clerk session, SSE stream + wall cross-checks
 * every 60s from 9:30 AM ET through the cash session.
 *
 * Usage:
 *   npm run validate:vector-rth
 *   node scripts/vector-rth-minute-audit.mjs [--once] [--wait-open] [--base=URL]
 *
 * Requires: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 * Optional: POLYGON_API_KEY (spot oracle via /api/market/indices)
 */
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isTradingDayEt, inRthOpenWindow, etParts, todayEtYmd } from "./gha-et-window.mjs";
import { flipsAgree, spotsAgree } from "./audit/lib/cross-tool-tolerance.mjs";
import { mintVectorAuditSession } from "./audit/lib/vector-audit-auth.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const ONCE = process.argv.includes("--once");
const WAIT_OPEN = process.argv.includes("--wait-open");
const OUT = process.env.VECTOR_RTH_DIR || "/opt/cursor/artifacts/vector-rth";
mkdirSync(OUT, { recursive: true });

const GUIDE_CAP = 6;
const BEAD_CAP = 8;
const WALL_DEPTH_PROBE = 6;

function etClock(now = new Date()) {
  const p = etParts(now);
  const hour = Math.floor(p.mins / 60);
  const minute = p.mins % 60;
  const second = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", second: "numeric" }).format(now)
  );
  return {
    ymd: todayEtYmd(now),
    hour,
    minute,
    second,
    mins: p.mins,
    weekday: p.weekday,
  };
}

function msUntilOpen() {
  const now = new Date();
  const c = etClock(now);
  if (!isTradingDayEt(c.ymd)) return null;
  const openMins = 9 * 60 + 30;
  if (c.mins >= openMins) return 0;
  return (openMins - c.mins) * 60_000 - c.second * 1000 - now.getMilliseconds();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function logLine(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  appendFileSync(join(OUT, "vector-rth.log"), msg + "\n");
}

function topStrikes(walls, side, n = 3) {
  return (walls?.[side] ?? []).slice(0, n).map((w) => Math.round(w.strike));
}

function wallDepthFromTotals(strikeTotals, maxPerSide = WALL_DEPTH_PROBE) {
  if (!strikeTotals) return { call: [], put: [] };
  let totalAbs = 0;
  const rows = [];
  for (const [k, v] of Object.entries(strikeTotals)) {
    const g = Number(v);
    if (!Number.isFinite(g) || g === 0) continue;
    totalAbs += Math.abs(g);
    rows.push({ strike: Number(k), g, abs: Math.abs(g) });
  }
  if (totalAbs <= 0) return { call: [], put: [] };
  const call = rows
    .filter((r) => r.g > 0)
    .map((r) => ({ strike: Math.round(r.strike), pct: (r.abs / totalAbs) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, maxPerSide);
  const put = rows
    .filter((r) => r.g < 0)
    .map((r) => ({ strike: Math.round(r.strike), pct: (r.abs / totalAbs) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, maxPerSide);
  return { call, put };
}

async function probeStream(session, holdMs = 8000) {
  session.refreshToken?.();
  const tok = session.sessionToken();
  if (!tok) throw new Error("no session token");

  const readWithTimeout = (reader, ms = 2500) =>
    Promise.race([
      reader.read(),
      sleep(ms).then(() => ({ done: true, value: undefined, timedOut: true })),
    ]);

  const readStream = async (token) => {
    const ac = new AbortController();
    const hardCapMs = holdMs + 5000;
    const timer = setTimeout(() => ac.abort(), hardCapMs);
    const snaps = [];
    try {
      const res = await fetch(`${BASE}/api/market/vector/stream`, {
        headers: {
          Cookie: `__session=${token}; __client_uat=${session.clientUat}`,
          Accept: "text/event-stream",
        },
        signal: ac.signal,
      });
      if (!res.ok) return { status: res.status, snaps };
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream body");
      const dec = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + holdMs;
      while (Date.now() < deadline) {
        const chunk = await readWithTimeout(reader, Math.min(2500, deadline - Date.now() + 500));
        if (chunk.timedOut) continue;
        const { done, value } = chunk;
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            snaps.push(JSON.parse(line.slice(6)));
          } catch {
            /* skip */
          }
        }
      }
      reader.cancel().catch(() => {});
      return { status: 200, snaps };
    } finally {
      clearTimeout(timer);
    }
  };

  let result = await readStream(tok);
  if (result.status === 401 && session.refreshToken) {
    const fresh = session.refreshToken();
    if (fresh) result = await readStream(fresh);
  }
  if (result.status === 401) throw new Error("stream HTTP 401");
  if (result.status !== 200) throw new Error(`stream HTTP ${result.status}`);
  return result.snaps;
}

async function runTick(session, tickNum) {
  const issues = [];
  const warns = [];
  const et = etClock();
  const stamp = `${et.ymd} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:${String(et.second).padStart(2, "0")} ET`;

  let snaps;
  try {
    snaps = await probeStream(session, 8000);
  } catch (e) {
    issues.push(`stream: ${e.message}`);
    logLine(`TICK ${tickNum} ${stamp} FAIL ${issues.join("; ")}`);
    return { ok: false, issues, warns };
  }

  const last = snaps[snaps.length - 1];
  if (!last) {
    issues.push("stream: no SSE payload");
    logLine(`TICK ${tickNum} ${stamp} FAIL ${issues.join("; ")}`);
    return { ok: false, issues, warns };
  }

  const hm = session.app("/api/market/gex-heatmap?ticker=SPX");
  const pos = session.app("/api/market/gex-positioning?ticker=SPX");
  const indices = session.app("/api/market/indices");

  if (hm.status !== 200) issues.push(`heatmap HTTP ${hm.status}`);
  if (pos.status !== 200) warns.push(`positioning HTTP ${pos.status}`);

  const spotIdx = Number(indices.json?.spx?.price ?? indices.json?.SPX?.price);
  const candle = last.candle;
  const receivedAt = Date.now();
  const candleFreshSec =
    last.t > 0 ? Math.max(0, Math.round((receivedAt - last.t) / 1000)) : null;

  if (!candle?.close) {
    issues.push("candle null");
  } else if (candleFreshSec != null && candleFreshSec > 8) {
    issues.push(`candle stale ${candleFreshSec}s`);
  }

  if (spotIdx > 0 && candle?.close > 0 && !spotsAgree(spotIdx, candle.close, spotIdx)) {
    issues.push(`spot idx ${spotIdx} vs candle ${candle.close}`);
  }

  const gexCall = topStrikes(last.walls, "callWalls", GUIDE_CAP);
  const gexPut = topStrikes(last.walls, "putWalls", GUIDE_CAP);
  const vexCall = topStrikes(last.vexWalls, "callWalls", GUIDE_CAP);
  const vexPut = topStrikes(last.vexWalls, "putWalls", GUIDE_CAP);

  if (!gexCall.length && !gexPut.length) issues.push("GEX walls empty");
  if (!vexCall.length && !vexPut.length) warns.push("VEX walls empty");

  const hmGexDepth = wallDepthFromTotals(hm.json?.gex?.strike_totals, WALL_DEPTH_PROBE);
  const hmVexDepth = wallDepthFromTotals(hm.json?.vex?.strike_totals, WALL_DEPTH_PROBE);

  for (const [label, streamTop, hmDepth, severity] of [
    ["VEX call", vexCall[0], hmVexDepth.call[0]?.strike, "warn"],
    ["VEX put", vexPut[0], hmVexDepth.put[0]?.strike, "warn"],
  ]) {
    if (streamTop != null && hmDepth != null && streamTop !== hmDepth) {
      const msg = `${label} stream ${streamTop} vs heatmap ${hmDepth}`;
      if (severity === "warn") warns.push(msg);
      else issues.push(msg);
    }
  }

  // GEX put/call #1 should match positioning (same derivation as desk), not heatmap alone.
  if (gexCall[0] != null && pos.json?.call_wall != null) {
    if (!flipsAgree(gexCall[0], pos.json.call_wall, hm.json?.spot ?? candle?.close)) {
      warns.push(`GEX call stream ${gexCall[0]} vs positioning ${pos.json.call_wall}`);
    }
  }
  if (gexPut[0] != null && pos.json?.put_wall != null) {
    if (!flipsAgree(gexPut[0], pos.json.put_wall, hm.json?.spot ?? candle?.close)) {
      warns.push(`GEX put stream ${gexPut[0]} vs positioning ${pos.json.put_wall}`);
    }
  }

  if (last.gammaFlip != null && pos.json?.flip != null) {
    if (!flipsAgree(last.gammaFlip, pos.json.flip, hm.json?.spot ?? candle?.close)) {
      issues.push(`gamma flip stream ${last.gammaFlip} vs pos ${pos.json.flip}`);
    }
  }

  if (last.vexFlip != null && hm.json?.vex?.flip != null) {
    if (!flipsAgree(last.vexFlip, hm.json.vex.flip, hm.json?.spot ?? candle?.close)) {
      warns.push(`vex flip stream ${last.vexFlip} vs hm ${hm.json.vex.flip}`);
    }
  }

  const histLen = last.wallHistory?.length ?? 0;
  const histTimes = (last.wallHistory ?? []).map((s) => s.time);
  const histGrowth =
    snaps.length >= 2
      ? (snaps[snaps.length - 1]?.wallHistory?.length ?? 0) -
        (snaps[0]?.wallHistory?.length ?? 0)
      : 0;

  const beyondGuide = {
    gexCall: hmGexDepth.call.filter((w, i) => i >= GUIDE_CAP && w.pct >= 2).length,
    gexPut: hmGexDepth.put.filter((w, i) => i >= GUIDE_CAP && w.pct >= 2).length,
    vexCall: hmVexDepth.call.filter((w, i) => i >= GUIDE_CAP && w.pct >= 2).length,
    vexPut: hmVexDepth.put.filter((w, i) => i >= GUIDE_CAP && w.pct >= 2).length,
  };
  const extraNodes =
    beyondGuide.gexCall + beyondGuide.gexPut + beyondGuide.vexCall + beyondGuide.vexPut;

  const status = issues.length ? "FAIL" : warns.length ? "WARN" : "PASS";
  const detail = [
    `spot=${candle?.close ?? "—"}`,
    `gex=${gexCall.join("/")}|${gexPut.join("/")}`,
    `vex=${vexCall.join("/")}|${vexPut.join("/")}`,
    `flip γ${last.gammaFlip ?? "—"} v${last.vexFlip ?? "—"}`,
    `hist=${histLen}`,
    `snaps=${snaps.length}`,
    `extraNodes≥2%=${extraNodes}`,
  ].join(" · ");

  logLine(`TICK ${tickNum} ${stamp} ${status} ${detail}${issues.length ? " :: " + issues.join("; ") : ""}${warns.length ? " :: warn:" + warns.join("; ") : ""}`);

  const row = {
    tick: tickNum,
    at: new Date().toISOString(),
    et: stamp,
    status,
    candle: candle?.close ?? null,
    candleFreshSec,
    gexCall,
    gexPut,
    vexCall,
    vexPut,
    gammaFlip: last.gammaFlip,
    vexFlip: last.vexFlip,
    histLen,
    histTimesTail: histTimes.slice(-3),
    histGrowth,
    hmGexDepth,
    hmVexDepth,
    beyondGuide,
    extraNodes,
    issues,
    warns,
  };
  appendFileSync(join(OUT, "ticks.jsonl"), JSON.stringify(row) + "\n");
  return { ok: issues.length === 0, issues, warns, row };
}

async function waitForOpen() {
  const ms = msUntilOpen();
  if (ms == null) {
    logLine("Not a trading day — exiting");
    process.exit(0);
  }
  if (ms > 0) {
    logLine(`Waiting ${Math.ceil(ms / 1000)}s until 9:30 AM ET open…`);
    await sleep(ms);
  }
  logLine("=== Vector RTH minute monitor START (9:30 AM ET) ===");
}

async function main() {
  writeFileSync(
    join(OUT, "session.json"),
    JSON.stringify({ base: BASE, started: new Date().toISOString(), pid: process.pid }, null, 2)
  );

  if (WAIT_OPEN || !ONCE) await waitForOpen();

  if (!inRthOpenWindow() && !process.argv.includes("--force")) {
    logLine("Outside RTH — use --force for off-hours tick");
    if (!ONCE) process.exit(0);
  }

  let session;
  try {
    session = await mintVectorAuditSession({ base: BASE, emailPrefix: "vector-rth" });
    logLine(`Admin session minted user=${session.userId}`);

    if (ONCE) {
      const r = await runTick(session, 1);
      process.exit(r.ok ? 0 : 1);
    }

    let tick = 0;
    let lastE2e = 0;
    while (inRthOpenWindow() || process.argv.includes("--force")) {
      tick += 1;
      session.refreshToken?.();
      await runTick(session, tick);

      // Full Playwright E2E every 90 minutes (skip first tick — let ladder warm up)
      if (tick > 5 && Date.now() - lastE2e > 90 * 60_000) {
        lastE2e = Date.now();
        logLine("Running validate:vector-e2e (90m cadence)…");
        try {
          execFileSync("npm", ["run", "validate:vector-e2e"], {
            stdio: "pipe",
            encoding: "utf8",
            env: { ...process.env, AUDIT_EMAIL: `vector-e2e-${Date.now()}@blackouttrades.com` },
          });
          logLine("validate:vector-e2e PASS");
        } catch (e) {
          logLine(`validate:vector-e2e FAIL ${(e.stdout || e.stderr || e.message || "").slice(0, 400)}`);
        }
      }

      const c = etClock();
      if (c.mins > 16 * 60 + 15) break;
      await sleep(60_000);
    }

    logLine("=== Vector RTH minute monitor END (post-close) ===");
  } finally {
    session?.cleanup?.();
  }
}

main().catch((e) => {
  logLine(`FATAL ${e.message}`);
  process.exit(1);
});
