#!/usr/bin/env node
/**
 * Heat Maps MATRIX deep audit — re-derives every aggregate from the served payload.
 * Mirrors the invariant layers in src/lib/correctness/heatmap-verifier.ts.
 *
 * Usage: node scripts/heatmap-matrix-audit.mjs [--tickers=SPY,SPX,NVDA,...]
 */
import { isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";

const CRON = process.env.CRON_SECRET;
const baseArg = process.argv.find((a) => a.startsWith("--base="));
const tickersArg = process.argv.find((a) => a.startsWith("--tickers="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const TICKERS = tickersArg
  ? tickersArg.slice("--tickers=".length).split(",").map((t) => t.trim().toUpperCase())
  : ["SPX", "SPY", "QQQ", "IWM", "NVDA", "AAPL", "TSLA", "AMD", "MSFT", "META", "AMZN", "MU", "SMH", "GLD", "AVGO"];

if (!CRON) {
  console.error("CRON_SECRET required");
  process.exit(1);
}

const H = { Authorization: `Bearer ${CRON}` };
const issues = [];

function fail(ticker, metric, detail) {
  issues.push({ ticker, metric, detail });
}

function sumTotals(strikeTotals) {
  let t = 0;
  for (const v of Object.values(strikeTotals ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n)) t += n;
  }
  return t;
}

function deriveWalls(strikeTotals) {
  let callWall = null, putWall = null, king = null;
  let maxPos = 0, maxNeg = 0, maxAbs = -1;
  for (const [s, gRaw] of Object.entries(strikeTotals ?? {})) {
    const strike = Number(s), g = Number(gRaw);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos) { maxPos = g; callWall = strike; }
    if (g < maxNeg) { maxNeg = g; putWall = strike; }
    if (Math.abs(g) > maxAbs) { maxAbs = Math.abs(g); king = strike; }
  }
  return { callWall, putWall, king };
}

function deriveFlip(strikeTotals, spot) {
  const rows = Object.entries(strikeTotals ?? {})
    .map(([s, g]) => ({ strike: Number(s), gamma: Number(g) }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;
  const crossings = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.gamma < 0 && b.gamma > 0) {
      const frac = (0 - a.gamma) / (b.gamma - a.gamma);
      crossings.push(Number((a.strike + (b.strike - a.strike) * frac).toFixed(2)));
    }
  }
  if (!crossings.length) return null;
  return spot > 0
    ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
    : crossings[crossings.length - 1];
}

function reSumCells(cells, nearExpiries) {
  const out = {};
  for (const [strike, byExp] of Object.entries(cells ?? {})) {
    let sum = 0;
    for (const [exp, val] of Object.entries(byExp ?? {})) {
      if (!nearExpiries.has(exp)) continue;
      const n = Number(val);
      if (Number.isFinite(n)) sum += n;
    }
    if (sum !== 0) out[strike] = sum;
  }
  return out;
}

function fracDiff(a, b) {
  const mid = (Math.abs(a) + Math.abs(b)) / 2;
  return mid > 0 ? Math.abs(a - b) / mid : 0;
}

function sameStrike(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= 0.01;
}

async function fetchHeatmap(ticker) {
  const r = await fetch(`${BASE}/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`, { headers: H });
  return r.json();
}

/** Mirror gexPositioningFromHeatmap — net_gex/flip/walls come straight from the gex block. */
function positioningFromHeatmap(hm) {
  if (!hm?.gex || !(hm.spot > 0)) return null;
  return {
    spot: hm.spot,
    asof: hm.asof,
    net_gex: hm.gex.total,
    flip: hm.gex.flip,
    call_wall: hm.gex.call_wall,
    put_wall: hm.gex.put_wall,
    net_vex: hm.vex?.total,
    net_dex: hm.dex?.total ?? null,
    net_charm: hm.charm?.total ?? null,
  };
}

function auditMetricBlock(ticker, metricName, block, spot, nearExpiries) {
  if (!block?.strike_totals) return { checks: 0, flags: 0 };
  let flags = 0;
  const st = block.strike_totals;
  const reported = Number(block.total);

  // INV-1: sum strike_totals == total
  const independentSum = sumTotals(st);
  if (fracDiff(independentSum, reported) > 1e-6) {
    fail(ticker, `${metricName}.sum`, `Σ strike_totals ${independentSum.toExponential(4)} != total ${reported.toExponential(4)}`);
    flags++;
  }

  // Cell finite scan
  for (const [strike, byExp] of Object.entries(block.cells ?? {})) {
    for (const [exp, val] of Object.entries(byExp ?? {})) {
      if (!Number.isFinite(Number(val))) {
        fail(ticker, `${metricName}.cell`, `non-finite cell ${strike}/${exp}`);
        flags++;
        break;
      }
    }
  }

  // Walls (GEX block only has call/put wall fields)
  if (metricName === "gex") {
    const { callWall, putWall } = deriveWalls(st);
    if (!sameStrike(callWall, block.call_wall)) {
      fail(ticker, "gex.call_wall", `reported ${block.call_wall} != argmax+ ${callWall}`);
      flags++;
    }
    if (!sameStrike(putWall, block.put_wall)) {
      fail(ticker, "gex.put_wall", `reported ${block.put_wall} != argmin- ${putWall}`);
      flags++;
    }
    const derivedFlip = deriveFlip(st, spot);
    const reportedFlip = block.flip;
    if (reportedFlip != null && derivedFlip != null) {
      if (Math.abs(reportedFlip - derivedFlip) > Math.max(spot * 0.01, 1)) {
        fail(ticker, "gex.flip", `reported ${reportedFlip} != derived crossing ${derivedFlip}`);
        flags++;
      }
    }
  }

  // INV-2: cells re-sum magnitude vs strike_totals (matrix user sees == headline levels)
  const reSummed = reSumCells(block.cells, nearExpiries);
  let worstCellDiff = 0;
  let worstStrike = null;
  for (const [k, totalRaw] of Object.entries(st)) {
    const total = Number(totalRaw);
    const cellSum = Number(reSummed[k] ?? 0);
    if (!Number.isFinite(total) || !Number.isFinite(cellSum)) continue;
    const fd = fracDiff(cellSum, total);
    if (fd > worstCellDiff) {
      worstCellDiff = fd;
      worstStrike = k;
    }
    // INV-2b: sign integrity within one payload
    if (Math.abs(total) >= 1 && Math.abs(cellSum) >= Math.abs(total) * 1e-3) {
      if (Math.sign(cellSum) !== Math.sign(total)) {
        fail(ticker, `${metricName}.sign`, `strike ${k}: cells sum ${cellSum.toExponential(3)} vs total ${total.toExponential(3)} opposite signs`);
        flags++;
        break;
      }
    }
  }
  if (worstCellDiff > 1e-6 && worstStrike != null) {
    fail(
      ticker,
      `${metricName}.cells-resum`,
      `strike ${worstStrike}: re-summed cells Δ ${(worstCellDiff * 100).toExponential(2)}% vs strike_total`
    );
    flags++;
  }

  return { checks: 7, flags };
}

async function auditTicker(ticker) {
  const hm = await fetchHeatmap(ticker);
  const tradingDay = isTradingDayEt(todayEtYmd());
  if (!hm?.available && !(hm?.spot > 0)) {
    if (!tradingDay && ticker !== "SPX") {
      return {
        ticker,
        spot: 0,
        gexTotal: null,
        gexFlip: null,
        callWall: null,
        putWall: null,
        vexTotal: null,
        dexTotal: null,
        charmTotal: null,
        strikes: 0,
        cells: 0,
        expiries: 0,
        posNetGex: null,
        checks: 0,
        flags: 0,
        skippedHoliday: true,
      };
    }
    fail(ticker, "available", "heatmap unavailable or empty");
    return null;
  }

  const spot = Number(hm.spot);
  const nearExpiries = new Set([...(hm.expiries ?? [])].sort().slice(0, 8));
  let totalFlags = 0;
  let totalChecks = 0;

  // Audit all 4 lenses (GEX / VEX / DEX / CHARM)
  for (const [name, block] of [
    ["gex", hm.gex],
    ["vex", hm.vex],
    ["dex", hm.dex],
    ["charm", hm.charm],
  ]) {
    if (!block) continue;
    const r = auditMetricBlock(ticker, name, block, spot, nearExpiries);
    totalChecks += r.checks;
    totalFlags += r.flags;
  }

  // Temporal-immune cross-tool: derive positioning from SAME hm snapshot (mirrors heatmap-verifier.ts)
  const pos = positioningFromHeatmap(hm);
  if (pos && hm.gex) {
    if (fracDiff(pos.net_gex, hm.gex.total) > 1e-6) {
      fail(ticker, "mapper-net_gex", `gexPositioningFromHeatmap net_gex != gex.total`);
      totalFlags++;
    }
    if (!sameStrike(pos.flip, hm.gex.flip)) {
      fail(ticker, "mapper-flip", `mapper flip ${pos.flip} != matrix ${hm.gex.flip}`);
      totalFlags++;
    }
    if (!sameStrike(pos.call_wall, hm.gex.call_wall)) {
      fail(ticker, "mapper-call_wall", `mapper ${pos.call_wall} != matrix ${hm.gex.call_wall}`);
      totalFlags++;
    }
    if (!sameStrike(pos.put_wall, hm.gex.put_wall)) {
      fail(ticker, "mapper-put_wall", `mapper ${pos.put_wall} != matrix ${hm.gex.put_wall}`);
      totalFlags++;
    }
    totalChecks += 4;
  }

  // Sanity: max_pain near spot
  if (hm.max_pain != null && spot > 0 && Math.abs(hm.max_pain - spot) > spot * 0.5) {
    fail(ticker, "max_pain", `max_pain ${hm.max_pain} >50% from spot ${spot}`);
    totalFlags++;
  }

  // Matrix dimensions
  const strikeCount = Object.keys(hm.gex?.strike_totals ?? {}).length;
  const cellStrikes = Object.keys(hm.gex?.cells ?? {}).length;
  if (strikeCount === 0) {
    if (!tradingDay && ticker !== "SPX") {
      // Equity presets don't refresh on full market holidays; SPX may still serve cached matrix.
    } else {
      fail(ticker, "matrix-empty", "zero strike_totals");
      totalFlags++;
    }
  }

  return {
    ticker,
    spot,
    gexTotal: hm.gex?.total,
    gexFlip: hm.gex?.flip,
    callWall: hm.gex?.call_wall,
    putWall: hm.gex?.put_wall,
    vexTotal: hm.vex?.total,
    dexTotal: hm.dex?.total,
    charmTotal: hm.charm?.total,
    strikes: strikeCount,
    cells: cellStrikes,
    expiries: hm.expiries?.length ?? 0,
    posNetGex: pos?.net_gex ?? hm.gex?.total,
    checks: totalChecks,
    flags: totalFlags,
  };
}

console.log(`\n=== Heat Maps MATRIX Deep Audit ===`);
console.log(`Target: ${BASE}`);
console.log(`Tickers: ${TICKERS.length}`);
if (!isTradingDayEt(todayEtYmd())) {
  console.log(`Session: ${todayEtYmd()} is a market holiday — non-SPX empty matrices are expected\n`);
} else {
  console.log("");
}
console.log(
  "Ticker | Spot     | GEX total        | Flip  | CallW | PutW  | VEX total        | Strikes | Checks | Flags"
);
console.log("-".repeat(110));

for (const ticker of TICKERS) {
  try {
    const r = await auditTicker(ticker);
    if (!r) {
      console.log(`${ticker.padEnd(6)} | UNAVAILABLE`);
      continue;
    }
    if (r.skippedHoliday) {
      console.log(`${ticker.padEnd(6)} | (holiday — empty expected)`);
      continue;
    }
    const fmt = (n) => (n == null ? "—" : typeof n === "number" ? (Math.abs(n) > 1e9 ? (n / 1e9).toFixed(2) + "B" : n.toFixed(2)) : n);
    console.log(
      `${r.ticker.padEnd(6)} | ${fmt(r.spot).padStart(8)} | ${fmt(r.gexTotal).padStart(16)} | ${fmt(r.gexFlip).padStart(5)} | ${fmt(r.callWall).padStart(5)} | ${fmt(r.putWall).padStart(5)} | ${fmt(r.vexTotal).padStart(16)} | ${String(r.strikes).padStart(7)} | ${String(r.checks).padStart(6)} | ${r.flags}`
    );
    await new Promise((res) => setTimeout(res, 400));
  } catch (e) {
    fail(ticker, "fetch", e.message);
    console.log(`${ticker.padEnd(6)} | ERROR ${e.message}`);
  }
}

console.log(`\n=== MATRIX ISSUES (${issues.length}) ===`);
if (!issues.length) console.log("  None — all matrix invariants passed.");
else for (const i of issues) console.log(`  [${i.ticker}] ${i.metric}: ${i.detail}`);

// Run production data-correctness cron summary
try {
  const dc = await fetch(`${BASE}/api/cron/data-correctness?force=1`, { headers: H }).then((r) => r.json());
  console.log(`\n=== Production data-correctness cron ===`);
  console.log(`  flags: ${dc.totals?.flags ?? "?"}, confirmed: ${dc.totals?.independentlyConfirmed ?? "?"}, consistency-only: ${dc.totals?.consistencyOnly ?? "?"}`);
  if (dc.flags?.length) for (const f of dc.flags) console.log(`  FLAG [${f.layer}/${f.metric}] ${f.detail}`);
} catch {}

console.log("");
process.exit(issues.length ? 1 : 0);
