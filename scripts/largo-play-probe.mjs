#!/usr/bin/env node
/**
 * Largo play probe — authenticated HTTP against staging (or STAGING_BASE_URL).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const QUESTIONS = [
  { q: "What's the market doing?", tag: "market" },
  { q: "What's the SPX setup right now?", tag: "spx-desk" },
  { q: "How are today's plays doing?", tag: "plays" },
  { q: "Give me a full platform snapshot — every product", tag: "platform" },
  { q: "What's on the HELIX tape right now?", tag: "helix" },
  { q: "What's the SPX gamma flip and call wall?", tag: "structure" },
  { q: "why is SPX below vwap", tag: "vwap" },
  { q: "any unusual flow right now?", tag: "flow" },
  { q: "compare NVDA vs AMD", tag: "compare" },
  { q: "what would flip the SPX read", tag: "flip-triggers" },
  { q: "Should I buy NVDA calls into earnings?", tag: "verdict" },
  { q: "GEX?", tag: "adversarial-short" },
];

async function askLargo(cookieHeader, question) {
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}/api/market/largo/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ question, session_id: `play-probe-${Date.now()}` }),
    },
    { retries: 2, timeoutMs: 180_000, baseDelayMs: 1500 }
  );
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body, ms: Date.now() - t0 };
}

const results = [];
console.log(`\n=== Largo play probe ===\nTarget: ${BASE}\n`);

const session = await mintAppSession({ appUrl: BASE });
if (session.skip) {
  console.error("Auth failed:", session.reason);
  process.exit(1);
}
console.log(`Auth: ${session.provider ?? "session"} OK\n`);

try {
  for (const { q, tag } of QUESTIONS) {
    process.stdout.write(`\n[${tag}] Q: ${q}\n`);
    const { status, body, ms } = await askLargo(session.cookieHeader, q);
    const answer = body?.answer ?? body?.text ?? "";
    const source = body?.source ?? "?";
    const tools = body?.tools_used ?? [];
    const preview = answer.replace(/\s+/g, " ").slice(0, 600);
    const err = body?.error ?? body?.message;

    if (status === 200 && answer.length > 0) {
      console.log(`→ HTTP ${status} | source=${source} | ${ms}ms | tools=${tools.join(",") || "—"}`);
      console.log(preview + (answer.length > 600 ? "…" : ""));
      results.push({
        tag,
        question: q,
        status,
        ms,
        source,
        tools_used: tools,
        answer_len: answer.length,
        answer_preview: preview,
        verification: body?.verification,
        envelope_kind: body?.envelope?.kind ?? null,
      });
    } else {
      console.log(`→ HTTP ${status} | ${ms}ms | err=${err ?? "empty answer"}`);
      results.push({ tag, question: q, status, ms, error: err ?? "empty", body: body?.raw ?? null });
    }
  }
} finally {
  await session.cleanup?.();
}

const summary = {
  pass: results.filter((r) => r.status === 200 && (r.answer_len ?? 0) > 30).length,
  fail: results.filter((r) => r.status !== 200 || (r.answer_len ?? 0) <= 30).length,
  bie: results.filter((r) => r.source === "blackout-intelligence").length,
  avg_ms: Math.round(results.filter((r) => r.ms).reduce((a, r) => a + r.ms, 0) / results.length),
};

const outPath = join(OUT, "largo-play-probe.json");
writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), base: BASE, summary, results }, null, 2));

console.log(`\n=== Summary ===`);
console.log(`Answered: ${summary.pass}/${results.length} | BIE source: ${summary.bie} | avg ${summary.avg_ms}ms`);
console.log(`Wrote ${outPath}\n`);
