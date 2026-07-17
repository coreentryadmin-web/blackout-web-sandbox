#!/usr/bin/env node
/**
 * Difficult / adversarial Largo probe — checks answer precision vs platform dump.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

/** Hard, narrow, compound, misleading, and edge-case asks */
const QUESTIONS = [
  { q: "just the SPX put wall", want: /put wall|7,5/i, dump: /HELIX tape.*Night Hawk.*market tide/i },
  { q: "what's charm doing on SPX 0DTE", want: /charm/i, dump: /Night Hawk.*Evening Playbook/i },
  { q: "is 7550 a good strike for calls today", want: /7550|call|strike|wall|pin/i, dump: /^.{0,200}$/ },
  { q: "why did you say bearish and bullish in the same breath", want: /bearish|bullish|thesis|signal|edge/i, dump: null },
  { q: "list only the top 3 HELIX prints by premium", want: /print|premium|\$/i, dump: /Zero Claude cost/i },
  { q: "what's the king node on SPX right now", want: /king|node|strike|7,/i, dump: null },
  { q: "does thermal agree with the desk on SPX", want: /thermal|gex|desk|agree|diverg/i, dump: null },
  { q: "grid scanner rejections last hour", want: /reject|grid|scanner|0DTE/i, dump: null },
  { q: "nighthawk play on NVDA tonight", want: /NVDA|night.?hawk|NH|play/i, dump: /SPX desk summary/i },
  { q: "SPX lotto engine state", want: /lotto|engine|play/i, dump: null },
  { q: "what's VIX doing and does it matter for today's SPX read", want: /VIX|vol/i, dump: null },
  { q: "if I buy 7530 puts here what's the dealer hedge flow", want: /7530|put|dealer|hedge|gamma|gex/i, dump: null },
  { q: "compare SPX matrix GEX vs VEX at 7550", want: /7550|GEX|VEX|vex|matrix/i, dump: null },
  { q: "tell me something you don't know", want: /don't know|unavailable|can't|no data|not available|honest/i, dump: null },
  { q: "asdfghjkl", want: /don't|unclear|rephrase|ask|help|specific/i, dump: null },
  { q: "1", want: /.+/i, dump: null },
  { q: "What's SPX gamma flip and also AMD max pain and also is QQQ bullish and also any whale flow and also nighthawk and also thermal spy", want: /SPX|AMD|QQQ|whale|night|thermal/i, dump: null },
  { q: "only answer in one sentence: SPX direction", want: /SPX|bull|bear|flat|up|down|neutral/i, dump: /MECHANIC.*ALIGNMENT.*FRICTION/s },
  { q: "what changed in the matrix in the last 5 minutes", want: /matrix|change|5 min|shift|delta|strike/i, dump: null },
  { q: "is the play engine long or short right now", want: /engine|long|short|play|flat|none/i, dump: null },
];

async function ask(cookieHeader, question) {
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}/api/market/largo/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ question, session_id: `diff-${Date.now()}` }),
    },
    { retries: 1, timeoutMs: 180_000 }
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - t0 };
}

function score(item, answer) {
  const len = answer.length;
  const hitWant = item.want?.test(answer) ?? true;
  const isDump =
    item.dump?.test(answer) ||
    (/SPX desk summary.*HELIX tape.*Night Hawk.*market tide/s.test(answer) && !/platform snapshot|market doing|everything/i.test(item.q));
  const fullDeskDump = len > 2800 && /SPX Live Desk read.*THESIS/s.test(answer) && !/setup right now|below vwap|why/i.test(item.q);
  const oneSentenceAsk = /one sentence/i.test(item.q) && len > 400;
  const issues = [];
  if (!hitWant) issues.push("missed-topic");
  if (isDump) issues.push("generic-platform-dump");
  if (fullDeskDump) issues.push("full-desk-dump");
  if (oneSentenceAsk) issues.push("ignored-brevity");
  if (len < 20) issues.push("too-short");
  const verdict = issues.length === 0 ? "FOCUSED" : issues.includes("missed-topic") ? "MISS" : "BLOATED";
  return { verdict, issues, len };
}

const session = await mintAppSession({ appUrl: BASE });
if (session.skip) {
  console.error("Auth failed:", session.reason);
  process.exit(1);
}

const rows = [];
try {
  for (const item of QUESTIONS) {
    const { status, body, ms } = await ask(session.cookieHeader, item.q);
    const answer = body?.answer ?? "";
    const s = score(item, answer);
    const preview = answer.replace(/\s+/g, " ").slice(0, 280);
    console.log(`\n[${s.verdict}] (${ms}ms, ${s.len}c) Q: ${item.q}`);
    if (s.issues.length) console.log(`  issues: ${s.issues.join(", ")}`);
    console.log(`  ${preview}${answer.length > 280 ? "…" : ""}`);
    rows.push({
      question: item.q,
      status,
      source: body?.source,
      ms,
      ...s,
      answer_preview: preview,
    });
  }
} finally {
  await session.cleanup?.();
}

const summary = {
  total: rows.length,
  focused: rows.filter((r) => r.verdict === "FOCUSED").length,
  bloated: rows.filter((r) => r.verdict === "BLOATED").length,
  miss: rows.filter((r) => r.verdict === "MISS").length,
};
writeFileSync(join(OUT, "largo-difficult-probe.json"), JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
console.log(`\n=== ${summary.focused} focused / ${summary.bloated} bloated / ${summary.miss} miss / ${summary.total} total ===\n`);
