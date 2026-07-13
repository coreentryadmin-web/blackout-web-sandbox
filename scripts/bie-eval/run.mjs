#!/usr/bin/env node
/**
 * BIE EVALUATION HARNESS — committed regression gate for BIE answer quality (BIE-MASTER-SPEC §7).
 *
 * Signs into staging (fresh Cognito temp admin+premium user, always deleted), captures LIVE ground
 * truth from the clean Vector JSON APIs, fires the whole categorized question bank at Largo
 * (POST /api/market/largo/query) over the authenticated cookies, scores each answer HONESTLY
 * (pass / soft / fail — soft = answered & substantive but keyword-missed, NOT a regression), flags the
 * honesty violations that matter (leaked {{grounding}} markers, fabricated numbers, wrong numbers,
 * cross-instrument SPX bleed, routing that didn't come from BIE), and writes a JSON scorecard + prints
 * a per-category + honesty summary.
 *
 * RUN (AWS creds MUST be unset so ~/.aws/credentials is used):
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY npm run eval:bie
 *   # or: env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/bie-eval/run.mjs
 * Env: STAGING_BASE_URL, STAGING_SECRET_NAME, AWS_REGION, OUTDIR (scorecard dir), ONLY=cat1,cat2.
 *
 * Exit code: non-zero when any HARD fail exists (unanswered / leak / fabrication / wrong number /
 * misrouted routing) — so CI can gate on it. Soft misses do NOT fail the run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  STAGING,
  cognitoConfig,
  createTempUser,
  deleteTempUser,
  proxyRoute,
  signIn,
  apiGet,
  askLargo,
  randomPassword,
} from "./lib/staging-auth.mjs";
import { scoreResult, summarize } from "./lib/scoring.mjs";
import { buildBank, GT_KEYS } from "./question-bank.mjs";

const OUTDIR = process.env.OUTDIR || "bie-eval-out";
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
mkdirSync(OUTDIR, { recursive: true });

async function captureGroundTruth(page) {
  const gt = {};
  for (const [t, h] of GT_KEYS) {
    const [walls, mp, em] = await Promise.all([
      apiGet(page, `/api/market/vector/walls?ticker=${t}&dte=${h}`),
      apiGet(page, `/api/market/vector/max-pain?ticker=${t}&dte=${h}`),
      apiGet(page, `/api/market/vector/expected-move?ticker=${t}&dte=${h}`),
    ]);
    gt[`${t}:${h}`] = {
      flip: walls?.flip ?? null,
      callWalls: walls?.walls?.callWalls ?? [],
      putWalls: walls?.walls?.putWalls ?? [],
      maxPain: mp?.maxPain ?? mp?.max_pain ?? mp?.strike ?? null,
      expectedMove: em ?? null,
    };
    console.log(`GT ${t}:${h} flip=${gt[`${t}:${h}`].flip} mp=${gt[`${t}:${h}`].maxPain} cw=${(gt[`${t}:${h}`].callWalls[0] || {}).strike}`);
  }
  return gt;
}

const { poolId, region } = cognitoConfig();
const email = `bieeval-${Date.now()}@blackout-e2e.dev`;
const password = randomPassword("Be");
createTempUser(poolId, region, email, password);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await proxyRoute(ctx);
const page = await ctx.newPage();

const rows = [];
let groundTruth = {};
try {
  await signIn(page, email, password);
  console.log(`signed in as ${email}\n`);

  groundTruth = await captureGroundTruth(page);

  let bank = buildBank(groundTruth);
  if (ONLY.length) bank = bank.filter((it) => ONLY.includes(it.cat));
  console.log(`\nfiring ${bank.length} questions across ${new Set(bank.map((b) => b.cat)).size} categories…\n`);

  let i = 0;
  for (const item of bank) {
    i++;
    const t0 = Date.now();
    let resp = { answer: "", source: "", tools: [] };
    try {
      resp = await askLargo(page, item.q, `bieeval-${Date.now()}-${i}`);
    } catch (e) {
      resp = { answer: `error: ${String(e.message).slice(0, 120)}`, source: "", tools: [] };
    }
    const ms = Date.now() - t0;
    const scored = scoreResult(item, resp);
    rows.push({
      i,
      cat: item.cat,
      id: item.id,
      ticker: item.ticker ?? null,
      horizon: item.horizon ?? null,
      q: item.q,
      ms,
      source: resp.source,
      tools: resp.tools,
      severity: scored.severity,
      pass: scored.pass,
      why: scored.why,
      flags: scored.flags,
      gtValue: item.gtValue ?? null,
      answer: resp.answer,
    });
    const mark = scored.severity === "pass" ? "PASS" : scored.severity === "soft" ? "SOFT" : "FAIL";
    const badges = Object.entries(scored.flags).filter(([k, v]) => v && k !== "bie").map(([k]) => k).join(",");
    console.log(`${mark} [${item.cat}] ${item.q.slice(0, 58)} — src=${resp.source || "?"} ${ms}ms${badges ? " ⚑" + badges : ""}`);
  }
} finally {
  await browser.close();
  deleteTempUser(poolId, region, email);
}

const summary = summarize(rows);
const scorecard = { ranAt: new Date().toISOString(), staging: STAGING, email, groundTruth, summary, results: rows };
const outPath = `${OUTDIR}/bie-eval-scorecard.json`;
writeFileSync(outPath, JSON.stringify(scorecard, null, 2));
// Also write a STABLE path next to the harness so the coordinator can diff before→after a deploy.
const stablePath = new URL("./last-scorecard.json", import.meta.url);
writeFileSync(stablePath, JSON.stringify(scorecard, null, 2));

console.log("\n==================== BIE EVAL SUMMARY ====================");
console.log(`GATE: ${summary.gate}   (total ${summary.total} · PASS ${summary.pass} · SOFT ${summary.soft} · FAIL ${summary.fail} · pass-rate ${summary.pass_rate}%)`);
console.log(`BIE-source ${summary.bie_source_rate}% · {{leaks}} ${summary.leaks} · fabrications ${summary.fabrications} · SPX-bleed ${summary.spx_bleed} · unanswered ${summary.unanswered} · misrouted ${summary.routing_misrouted}`);
console.log("\n  category      pass-rate   pass / soft / fail   (of total)");
console.log("  " + "-".repeat(56));
for (const [cat, c] of Object.entries(summary.by_category)) {
  console.log(`  ${cat.padEnd(12)} ${String(c.pass_rate + "%").padStart(7)}     ${c.pass}✓ / ${c.soft}~ / ${c.fail}✗   (of ${c.total})`);
}
console.log(`\nscorecard → ${outPath}`);
console.log(`stable    → ${stablePath.pathname}`);
console.log("SOFT = answered & substantive but keyword-missed — eyeball, NOT a regression. FAIL = real problem.\n");

// Gate: any HARD fail (unanswered / leak / fabrication / wrong number / misrouted) fails the run.
const hardFails = rows.filter((r) => r.severity === "fail");
if (hardFails.length) {
  console.error(`❌ ${hardFails.length} hard failure(s):`);
  for (const r of hardFails) console.error(`   [${r.cat}] ${r.q.slice(0, 60)} — ${r.why}`);
  process.exit(1);
}
console.log("✅ no hard failures.");
