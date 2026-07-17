#!/usr/bin/env node
/**
 * Shape pass for the 17 historically-BAD stress cases — router + applyDynamicFormat with
 * synthetic context (no server-only imports). Validates post-fix answer shapes locally.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scoreAnswer } from "./largo-stress-bank.mjs";
import { classifyBieIntent } from "../src/lib/bie/router.ts";
import { applyDynamicFormat } from "../src/lib/bie/dynamic-format.ts";

const BAD_CASES = [
  { q: "SPX call wall only", intent: "spx_structure", avoidDump: /THESIS|SPX Live Desk read/i, ctx: { narrow: "call_wall", raw: { call_wall: 7600, price: 7530, gamma_flip: 7534 } } },
  { q: "what's the king node on SPX right now", intent: "spx_structure", avoidDump: /SPX Live Desk read/i, ctx: { narrow: "king_node", raw: { gex_king_strike: 7550, price: 7530 } } },
  { q: "only answer in one sentence: SPX direction", intent: "spx_desk_read", avoidDump: /ALIGNMENT.*FRICTION/s, ctx: {}, answer: "SPX is mixed at 7530 with low edge. Dealers are short gamma. Watch the flip." },
  { q: "one line SPX bias", intent: "spx_desk_read", avoidDump: /ALIGNMENT.*FRICTION/s, ctx: {}, answer: "SPX **neutral** at **7530** (-0.5%) — grade **C**, γ-flip **7534**." },
  { q: "what's charm doing on SPX 0DTE", intent: "thermal_read", avoidDump: /SPX Live Desk read/i, ctx: { narrow: "charm", positioning: { net_charm: -1200, charm_regime_read: "decay headwind", spot: 7530, flip: 7534 } } },
  { q: "compare SPX matrix GEX vs VEX at 7550", intent: "thermal_read", avoidDump: /SPX Live Desk read/i, ctx: { positioning: { net_gex: 1e6, net_vex: -2e6, gamma_regime_read: "long γ", vanna_regime_read: "neg vanna" } } },
  { q: "does thermal agree with the desk on SPX", intent: "thermal_read", avoidDump: /SPX Live Desk read/i, ctx: { desk: { gamma_flip: 7534 }, positioning: { flip: 7534 } }, answer: "**Thermal vs SPX desk** — aligned." },
  { q: "what changed in the matrix in the last 5 minutes", intent: "thermal_read", avoidDump: /HELIX tape.*Night Hawk/s, ctx: { matrix: { strike_count: 40, expiry_count: 1, gex_flip: 7534 } }, answer: "**Matrix / regime shifts** — none logged." },
  { q: "list only the top 3 HELIX prints by premium", intent: "helix_read", avoidDump: /SPX desk summary/i, ctx: { top: [{ ticker: "SPX", strike: 7550, premium: 2e6, direction: "bullish", option_type: "call" }] } },
  { q: "grid scanner rejections last hour", intent: "grid_rejections_read", avoidDump: /SPX desk summary/i, ctx: { rejections: [{ ticker: "NVDA", gate_failed: "premium", direction: "bullish", gross_premium: 500000, reason: "below tier" }] } },
  { q: "SPX lotto engine state", intent: "play_engine_read", avoidDump: /SPX Live Desk read/i, ctx: { lotto: { phase: "ARMED", direction: "long", strike: 7550 }, openPlay: null, powerHour: { phase: "NONE" } } },
  { q: "is the play engine long or short right now", intent: "play_engine_read", avoidDump: /SPX desk summary/i, ctx: { openPlay: { status: "open", direction: "long", entry_price: 7530, stop: 7510, target: 7560, grade: "B" }, lotto: { phase: "NONE" }, powerHour: { phase: "NONE" } } },
  { q: "why did you say bearish and bullish in the same breath", intent: "spx_desk_read", avoidDump: /SPX desk summary/i, ctx: {}, answer: "**Why bullish and bearish show up together** — signal stack vs thesis friction." },
  { q: "what's VIX doing and does it matter for today's SPX read", intent: "market_context", avoidDump: /SPX Live Desk read/i, ctx: {}, answer: "**VIX (live)** — 18.2 · SPX read impact: grade **B**." },
  { q: "asdfghjkl", intent: "clarify_read", avoidDump: /SPX desk summary/i, ctx: { kind: "clarify" }, answer: "I didn't map that to a specific live read — rephrase with **what you want**." },
  { q: "1", intent: "clarify_read", avoidDump: /γflip/i, ctx: { kind: "clarify" }, answer: "Rephrase with a ticker, level, or product." },
  { q: "tell me something you don't know", intent: "clarify_read", avoidDump: /SPX desk summary/i, ctx: { kind: "honest_unknown" }, answer: "Honest limits on what I can answer from **live platform data**:" },
];

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const rows = [];
for (const entry of BAD_CASES) {
  const route = classifyBieIntent(entry.q, new Set());
  const baseAnswer = entry.answer ?? "Synthetic composed answer for shape test.";
  const formatted = applyDynamicFormat(route, entry.q, { answer: baseAnswer, context: entry.ctx });
  const answer = formatted.answer;
  const scored = scoreAnswer(entry, route, answer, 200);
  rows.push({ q: entry.q, intent: route?.intent, ...scored, preview: answer.slice(0, 120) });
  const icon = scored.verdict === "OK" ? "✓" : "✗";
  console.log(`${icon} ${entry.q.slice(0, 55)}${scored.issues.length ? " — " + scored.issues.join(", ") : ""}`);
}

const summary = { ok: rows.filter((r) => r.verdict === "OK").length, bad: rows.filter((r) => r.verdict === "BAD").length };
writeFileSync(join(OUT, "largo-stress-shape.json"), JSON.stringify({ summary, rows }, null, 2));
console.log("\n", summary);
process.exit(summary.bad > 0 ? 1 : 0);
