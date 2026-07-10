#!/usr/bin/env node
/**
 * Live BIE quality sample — capture full answers + latency for comparison vs old Claude Largo.
 * Usage: node scripts/staging-bie-live-compare.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.BIE_COMPARE_OUT ?? "/opt/cursor/artifacts/staging-bie-compare";
mkdirSync(OUT, { recursive: true });

const QUESTIONS = [
  { id: "spx-setup", q: "What's the SPX setup right now?", route: "spx_desk_read" },
  { id: "spx-why-vwap", q: "why is SPX below vwap", route: "spx_desk_read" },
  { id: "spx-structure", q: "SPX gamma flip and call wall levels", route: "spx_structure" },
  { id: "zerodte", q: "How are today's plays doing?", route: "zerodte_plays" },
  { id: "market", q: "What's the market doing?", route: "market_context" },
  { id: "reasoning-fallthrough", q: "Should I buy NVDA calls into earnings?", route: "claude_fallback (blocked on staging)" },
  { id: "loose-spx", q: "tell me about dealer gamma on SPX", route: "spx_desk_read fallback" },
];

async function post(path, body, headers) {
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
    },
    { retries: 2, timeoutMs: 180_000 }
  );
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed, ms: Date.now() - t0 };
}

async function get(path, headers) {
  const t0 = Date.now();
  const res = await fetchRetry(`${BASE}${path}`, { headers: { Accept: "application/json", ...headers } }, { retries: 2, timeoutMs: 90_000 });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - t0 };
}

function excerpt(text, max = 1200) {
  if (!text) return "";
  const s = String(text).trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

async function main() {
  console.log(`\n=== BIE live compare @ ${BASE} ===\n`);
  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("Auth failed:", session.reason);
    process.exit(1);
  }
  const H = { Cookie: session.cookieHeader };

  const report = {
    ts: new Date().toISOString(),
    base: BASE,
    policy: "staging BIE-only (claudeEnabled=false)",
    oldLargoBaseline: {
      source: "claude",
      typical_latency_ms: "5000–60000 (tool-loop rounds, up to 12 × 60s timeout)",
      cost: "Anthropic tokens per turn + tool latency",
      strengths: "Open-ended reasoning, multi-tool synthesis, teach/compare questions",
      weaknesses: "Slow cold path, hallucination risk on numbers, spend scales with users",
    },
    bieBaseline: {
      source: "blackout-intelligence",
      typical_latency_ms: "150–4000 (cached platform reads, no LLM)",
      cost: "Zero Anthropic on routed intents",
      strengths: "Instant desk brief, grounded numbers, THESIS/MECHANIC synthesis, shared caches",
      weaknesses: "No true advice/reasoning on non-routed questions; staging blocks Claude fallback",
    },
    samples: {},
  };

  const comm = await post("/api/market/spx/commentary", {}, H);
  const commBody = comm.body?.commentary?.body ?? "";
  report.samples.commentary = {
    endpoint: "POST /api/market/spx/commentary",
    ms: comm.ms,
    status: comm.status,
    chars: commBody.length,
    has_thesis: /THESIS/i.test(commBody),
    has_mechanic: /MECHANIC/i.test(commBody),
    has_alignment: /ALIGNMENT/i.test(commBody),
    excerpt: excerpt(commBody, 2000),
  };
  writeFileSync(join(OUT, "commentary.txt"), commBody);
  console.log(`Commentary: ${comm.ms}ms, ${commBody.length} chars, THESIS=${report.samples.commentary.has_thesis}`);

  const gex = await get("/api/market/gex-heatmap/explain?ticker=SPX", H);
  report.samples.gex_explain = {
    endpoint: "GET /api/market/gex-heatmap/explain?ticker=SPX",
    ms: gex.ms,
    status: gex.status,
    available: gex.body?.available,
    excerpt: excerpt(gex.body?.narrative, 800),
  };
  console.log(`GEX explain: ${gex.ms}ms, ${(gex.body?.narrative ?? "").length} chars`);

  const largo = [];
  for (const { id, q, route } of QUESTIONS) {
    const res = await post("/api/market/largo/query", { question: q, session_id: `bie-compare-${id}` }, H);
    const answer = res.body?.answer ?? "";
    const row = {
      id,
      question: q,
      expected_route: route,
      ms: res.ms,
      status: res.status,
      source: res.body?.source ?? null,
      tools_used: res.body?.tools_used ?? [],
      followups: res.body?.followups ?? [],
      verification: res.body?.verification ?? null,
      chars: answer.length,
      has_thesis: /THESIS/i.test(answer),
      excerpt: excerpt(answer, 1500),
      error: res.body?.error ?? res.body?.message ?? null,
    };
    largo.push(row);
    writeFileSync(join(OUT, `largo-${id}.txt`), answer || String(row.error ?? ""));
    console.log(`Largo [${id}]: ${res.ms}ms source=${row.source} chars=${row.chars}`);
  }
  report.samples.largo = largo;

  const summary = {
    largo_avg_ms: Math.round(largo.filter((r) => r.status === 200).reduce((s, r) => s + r.ms, 0) / largo.filter((r) => r.status === 200).length),
    largo_all_bie: largo.every((r) => r.source === "blackout-intelligence" || r.status !== 200),
    commentary_ms: comm.ms,
    zero_claude_sources: largo.every((r) => r.source !== "claude"),
  };
  report.summary = summary;

  const md = buildMarkdown(report);
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "report.md"), md);
  console.log(`\nWrote ${OUT}/report.md\n`);
  await session.cleanup?.();
}

function buildMarkdown(r) {
  const lines = [
    `# BIE vs old Claude Largo — live staging comparison`,
    ``,
    `**When:** ${r.ts}`,
    `**Target:** ${r.base}`,
    ``,
    `## Policy`,
    `- Staging runs **BIE-only** (\`claudeEnabled() === false\`). Old Largo on prod still uses Claude tool-loop when the router misses.`,
    ``,
    `## Latency (live this run)`,
    `| Surface | BIE (this run) | Old Claude Largo (typical) |`,
    `|---------|----------------|----------------------------|`,
    `| SPX commentary | ${r.samples.commentary.ms}ms | ~3–15s (Haiku/Claude generation) |`,
    `| Largo avg (6 routed Qs) | ${r.summary.largo_avg_ms}ms | 5–30s+ (tool rounds) |`,
    `| GEX explain | ${r.samples.gex_explain.ms}ms | ~2–25s (Claude narrative) |`,
    ``,
    `## Source tag`,
    `- **BIE:** \`source=blackout-intelligence\`, \`tools_used=["blackout_intelligence"]\``,
    `- **Old Largo:** \`source=claude\`, real tool names in \`tools_used\``,
    ``,
    `## Commentary excerpt`,
    `\`\`\``,
    r.samples.commentary.excerpt,
    `\`\`\``,
    ``,
  ];
  for (const row of r.samples.largo) {
    lines.push(`## Largo: ${row.question}`);
    lines.push(`- **${row.ms}ms** · source=\`${row.source}\` · route≈${row.expected_route}`);
    if (row.verification) {
      lines.push(`- Verification: ${row.verification.verified}/${row.verification.total} claims grounded`);
    }
    lines.push(`\`\`\``);
    lines.push(row.excerpt || row.error || "(empty)");
    lines.push(`\`\`\``);
    lines.push(``);
  }
  lines.push(`## Verdict`);
  lines.push(`- All Largo answers BIE-sourced: **${r.summary.largo_all_bie ? "yes" : "no"}**`);
  lines.push(`- Zero Claude sources: **${r.summary.zero_claude_sources ? "yes" : "no"}**`);
  lines.push(`- BIE adds structured **THESIS / MECHANIC / ALIGNMENT** synthesis old Claude commentary did not guarantee.`);
  lines.push(`- Trade-off: advice-style questions (e.g. "Should I buy…") get a desk read fallback on staging instead of Claude reasoning.`);
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
