#!/usr/bin/env node
/**
 * Largo response-time compare — staging vs production (Clerk premium session).
 * Usage: node scripts/largo-latency-compare.mjs [--rounds=3]
 */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { mintClerkPremiumSession } from "./audit/lib/prod-clerk-session.mjs";

const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 3);
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const ENVS = [
  { label: "staging", base: "https://staging.blackouttrades.com", secretSource: "staging" },
  { label: "prod", base: "https://blackouttrades.com", secretSource: "prod" },
];

const SESSION_ID = "latency-audit";
const SIMPLE_Q = "What is SPX spot right now?";
const TOOL_Q = "Summarize SPX gamma flip and key GEX levels in one short paragraph with dollar amounts.";

function loadStagingSecret() {
  const raw = execSync(
    'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text',
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

function loadProdWebSecret() {
  const res = spawnSync(
    "railway",
    [
      "variables",
      "--service",
      "blackout-web",
      "--environment",
      "production",
      "--project",
      process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a",
      "--json",
    ],
    { encoding: "utf8", env: process.env }
  );
  if (res.status !== 0) throw new Error(res.stderr || "railway variables failed");
  return JSON.parse(res.stdout);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(samples) {
  const ok = samples.filter((s) => s.ok);
  const ms = ok.map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: samples.length,
    ok: ok.length,
    fail: samples.length - ok.length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    min: ms[0] ?? null,
    max: ms[ms.length - 1] ?? null,
  };
}

async function largoSession(base, cookieHeader) {
  const t0 = performance.now();
  const res = await fetchRetry(
    `${base}/api/market/largo/session?session_id=${SESSION_ID}`,
    { headers: { Cookie: cookieHeader, Accept: "application/json" } },
    { retries: 2, timeoutMs: 60_000 }
  );
  await res.text();
  return { status: res.status, ms: Math.round(performance.now() - t0), ok: res.status === 200 };
}

async function largoQueryJson(base, cookieHeader, question) {
  const t0 = performance.now();
  const res = await fetchRetry(
    `${base}/api/market/largo/query`,
    {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ question, session_id: SESSION_ID }),
    },
    { retries: 1, timeoutMs: 180_000 }
  );
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const ms = Math.round(performance.now() - t0);
  const answered = Boolean(body.answer || body.text || body.message);
  return { status: res.status, ms, ok: res.status === 200 && answered, tools: body.tools_used?.length ?? 0, preview: String(body.answer || body.text || "").slice(0, 80) };
}

async function largoQueryStream(base, cookieHeader, question) {
  const t0 = performance.now();
  let firstTokenMs = null;
  let doneMs = null;
  let answer = "";
  let tools = [];
  let status = 0;
  try {
    const res = await fetch(`${base}/api/market/largo/query?stream=1`, {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ question, session_id: SESSION_ID }),
      signal: AbortSignal.timeout(180_000),
    });
    status = res.status;
    const raw = await res.text();
    doneMs = Math.round(performance.now() - t0);
    if (status === 200) {
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "token" && ev.text) {
            if (firstTokenMs == null) firstTokenMs = Math.round(performance.now() - t0);
            answer += ev.text;
          }
          if (ev.type === "done") {
            answer = ev.answer || answer;
            tools = ev.tools_used || tools;
          }
        } catch {
          /* skip */
        }
      }
    }
  } catch (e) {
    doneMs = Math.round(performance.now() - t0);
    return { status: 0, ms: doneMs, firstTokenMs, ok: false, err: e.message, tools: 0, preview: "" };
  }
  return {
    status,
    ms: doneMs,
    firstTokenMs,
    ok: status === 200 && answer.length > 20,
    tools: tools.length,
    preview: answer.slice(0, 80),
  };
}

async function runEnv(env, secret) {
  process.env.CLERK_SECRET_KEY = secret.CLERK_SECRET_KEY;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = secret.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const auth = await mintClerkPremiumSession({ appUrl: env.base });
  if (auth.skip) throw new Error(`${env.label} Clerk auth skipped: ${auth.reason}`);

  try {
    const sessionSamples = [];
    const simpleSamples = [];
    const toolSamples = [];
    const streamSamples = [];

    console.log(`\n=== ${env.label} (${env.base}) ===\n`);

    for (let i = 0; i < ROUNDS; i++) {
      const s = await largoSession(env.base, auth.cookieHeader);
      sessionSamples.push(s);
      console.log(`  [session r${i + 1}] HTTP ${s.status} ${s.ms}ms`);
    }

    for (let i = 0; i < ROUNDS; i++) {
      const q = await largoQueryJson(env.base, auth.cookieHeader, SIMPLE_Q);
      simpleSamples.push(q);
      console.log(`  [simple-query r${i + 1}] HTTP ${q.status} ${q.ms}ms tools=${q.tools}`);
    }

    // One heavier JSON query (tool-using)
    const tq = await largoQueryJson(env.base, auth.cookieHeader, TOOL_Q);
    toolSamples.push(tq);
    console.log(`  [tool-query] HTTP ${tq.status} ${tq.ms}ms tools=${tq.tools} preview="${tq.preview}"`);

    // One SSE stream (terminal path)
    const st = await largoQueryStream(env.base, auth.cookieHeader, TOOL_Q);
    streamSamples.push(st);
    console.log(
      `  [stream-query] HTTP ${st.status} total=${st.ms}ms firstToken=${st.firstTokenMs ?? "n/a"}ms tools=${st.tools}`
    );

    return {
      label: env.label,
      base: env.base,
      session: stats(sessionSamples),
      simpleQuery: stats(simpleSamples),
      toolQuery: stats(toolSamples),
      streamQuery: stats(streamSamples),
      streamFirstToken: st.firstTokenMs,
      samples: { sessionSamples, simpleSamples, toolSamples, streamSamples },
    };
  } finally {
    await auth.cleanup();
  }
}

async function main() {
  console.log(`\n=== Largo latency compare (${ROUNDS} rounds) ===\n`);
  const stagingSecret = loadStagingSecret();
  const prodSecret = loadProdWebSecret();
  const results = [];

  for (const env of ENVS) {
    const secret = env.secretSource === "staging" ? stagingSecret : prodSecret;
    try {
      results.push(await runEnv(env, secret));
    } catch (e) {
      console.error(`  ✗ ${env.label}: ${e.message}`);
      results.push({ label: env.label, error: e.message });
    }
  }

  console.log("\n=== Summary (ms) ===\n");
  console.log("| Endpoint | Staging p50 | Prod p50 | Staging p95 | Prod p95 |");
  console.log("|----------|-------------|----------|-------------|----------|");

  const staging = results.find((r) => r.label === "staging");
  const prod = results.find((r) => r.label === "prod");

  for (const key of ["session", "simpleQuery", "toolQuery", "streamQuery"]) {
    const s = staging?.[key];
    const p = prod?.[key];
    if (!s && !p) continue;
    console.log(
      `| ${key} | ${s?.p50 ?? "—"} | ${p?.p50 ?? "—"} | ${s?.p95 ?? "—"} | ${p?.p95 ?? "—"} |`
    );
  }

  if (staging?.streamFirstToken != null || prod?.streamFirstToken != null) {
    console.log(`| stream first token | ${staging?.streamFirstToken ?? "—"} | ${prod?.streamFirstToken ?? "—"} | — | — |`);
  }

  const path = join(OUT, `largo-latency-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ ts: new Date().toISOString(), rounds: ROUNDS, results }, null, 2));
  console.log(`\nReport: ${path}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
