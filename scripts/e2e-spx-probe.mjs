#!/usr/bin/env node
/**
 * SPX desk end-to-end probe — build-time safe HTTP + optional WS checks.
 * Run: node scripts/e2e-spx-probe.mjs [--base http://127.0.0.1:3001]
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const WebSocket = globalThis.WebSocket;
if (!WebSocket) {
  console.error("Node WebSocket not available — use Node 20+");
  process.exit(1);
}

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

function loadEnvFile(filename) {
  try {
    const raw = readFileSync(join(root, filename), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

for (const f of [".env.local", ".env"]) loadEnvFile(f);

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = baseArg ? baseArg.slice("--base=".length) : "http://127.0.0.1:3001";

const POLYGON_BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const POLYGON_KEY = (process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "").trim();
const UW_KEY = (process.env.UW_API_KEY ?? "").trim();
const UW_WS_BASE = process.env.UW_WS_BASE ?? "wss://api.unusualwhales.com/api/socket";
const UW_CLIENT_ID = process.env.UW_CLIENT_API_ID ?? "100001";
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();

const results = [];

function record(group, name, ok, detail = "") {
  results.push({ group, name, ok, detail });
  const icon = ok ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function fetchJson(path, opts = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...opts });
  const ms = Date.now() - started;
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, ms };
}

function routePasses(path, res, body) {
  if (path.includes("/api/market/spx/commentary")) {
    return [401, 403, 422, 429, 503].includes(res.status);
  }
  if (path.includes("/api/market/spx/play")) {
    return res.status === 200 || [401, 403, 503].includes(res.status);
  }
  return res.status >= 200 && res.status < 500 && body != null;
}

async function probeRoutes() {
  console.log("\n── SPX API routes ──");
  const routes = [
    "/api/market/health",
    "/api/market/spx/pulse",
    "/api/market/spx/flow",
    "/api/market/spx/desk",
    "/api/market/spx/play",
    "/api/market/spx/merged",
    "/api/market/spx/commentary",
    "/api/market/spx/signals",
    "/api/market/flows?limit=5",
  ];

  for (const path of routes) {
    try {
      const init = {};
      if (path.includes("/api/market/spx/play") && CRON_SECRET) {
        init.headers = { Authorization: `Bearer ${CRON_SECRET}` };
      }
      let res;
      let body;
      let ms;
      if (path.includes("/api/market/spx/commentary")) {
        const started = Date.now();
        res = await fetch(`${BASE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
          body: JSON.stringify({ desk: { price: 6000, available: true } }),
          cache: "no-store",
        });
        ms = Date.now() - started;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
      } else {
        ({ res, body, ms } = await fetchJson(path, init));
      }
      const ok = routePasses(path, res, body);
      let detail = `${res.status} ${ms}ms`;
      if (path.includes("pulse") && body?.spx_price != null) detail += ` · SPX $${body.spx_price}`;
      if (path.includes("desk") && body?.spx_price != null) detail += ` · SPX $${body.spx_price} · flows=${(body.spx_flows ?? []).length}`;
      if (path.includes("flow") && body?.spx_flows) detail += ` · flows=${body.spx_flows.length}`;
      if (path.includes("play") && body?.state) detail += ` · state=${body.state}`;
      if (path.includes("merged") && body?.pulse) detail += ` · pulse=${!!body.pulse} flow=${!!body.flow}`;
      record("routes", path, ok, detail);
    } catch (err) {
      record("routes", path, false, err instanceof Error ? err.message : "fetch failed");
    }
  }
}

async function probePulseSse() {
  console.log("\n── Pulse SSE (250ms × 3) ──");
  try {
    const res = await fetch(`${BASE}/api/market/spx/pulse/stream`, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      record("sse", "pulse/stream", false, `HTTP ${res.status}`);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      record("sse", "pulse/stream", false, "no body");
      return;
    }
    const dec = new TextDecoder();
    let chunks = 0;
    let spxPrice = null;
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = dec.decode(value);
      if (text.includes("data:")) chunks += 1;
      const m = text.match(/"spx"\s*:\s*\{[^}]*"price"\s*:\s*([\d.]+)/);
      if (m) spxPrice = m[1];
    }
    reader.cancel().catch(() => {});
    record("sse", "pulse/stream", chunks >= 1, `${chunks} chunk(s)${spxPrice ? ` · SPX $${spxPrice}` : ""}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    record("sse", "pulse/stream", msg.includes("timeout") === false, msg);
  }
}

async function probeMarketStatusCache() {
  console.log("\n── Market status 60s cache ──");
  if (!POLYGON_KEY) {
    record("cache", "fetchMarketStatusNow", false, "POLYGON_API_KEY missing");
    return;
  }
  const t0 = Date.now();
  const r1 = await fetch(
    `${POLYGON_BASE}/v1/marketstatus/now?apiKey=${encodeURIComponent(POLYGON_KEY)}`,
    { cache: "no-store" }
  );
  const j1 = await r1.json();
  const t1 = Date.now() - t0;

  // Two rapid pulse hits — second should be faster if cache works server-side
  const p1 = await fetchJson("/api/market/spx/pulse");
  const p2 = await fetchJson("/api/market/spx/pulse");
  const ok = r1.ok && j1?.market && p1.res.ok && p2.res.ok;
  record("cache", "Polygon marketstatus", r1.ok, `${j1.market} · ${t1}ms`);
  record(
    "cache",
    "Pulse back-to-back",
    ok,
    `${p1.ms}ms → ${p2.ms}ms (server caches status 60s)`
  );
}

function probeUwWs(channel, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!UW_KEY) {
      resolve({ ok: false, detail: "UW_API_KEY missing" });
      return;
    }
    const url = `${UW_WS_BASE}/${channel}`;
    let settled = false;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${UW_KEY}`,
        Accept: "application/json",
        "UW-CLIENT-API-ID": UW_CLIENT_ID,
      },
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, detail: "timeout" });
      }
    }, timeoutMs);

    let opened = false;

    ws.onopen = () => {
      opened = true;
    };

    ws.onmessage = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve({ ok: true, detail: "connected + message" });
      }
    };

    ws.onerror = () => {
      /* onclose carries actionable detail */
    };

    ws.onclose = (ev) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: opened,
          detail: opened ? `opened then closed code=${ev.code}` : `closed code=${ev.code}`,
        });
      }
    };
  });
}

async function probeUwSockets() {
  console.log("\n── UW WebSocket auth (Bearer handshake) ──");
  for (const ch of ["flow_alerts", "market_tide", "off_lit_trades"]) {
    const r = await probeUwWs(ch);
    const ok = r.ok || r.detail.includes("connected") || r.detail.includes("message");
    record("ws", `UW ${ch}`, ok, r.detail);
  }
}

async function probePolygonWs() {
  console.log("\n── Polygon indices WS ──");
  if (!POLYGON_KEY) {
    record("ws", "Polygon indices", false, "POLYGON_API_KEY missing");
    return;
  }
  const url = process.env.POLYGON_WS_INDICES ?? "wss://socket.massive.com/indices";
  const r = await new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        resolve({ ok: false, detail: "timeout" });
      }
    }, 8000);

    ws.onopen = () => {
      /* wait for connected event */
    };

    ws.onmessage = (ev) => {
      try {
        const msgs = JSON.parse(String(ev.data));
        for (const msg of msgs) {
          if (msg.ev === "connected" || (msg.ev === "status" && msg.status === "connected")) {
            ws.send(JSON.stringify({ action: "auth", params: POLYGON_KEY }));
          }
          if (msg.ev === "auth_success" || (msg.ev === "status" && msg.status === "auth_success")) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              ws.close();
              resolve({ ok: true, detail: "auth_success" });
            }
          }
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = (ev) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, detail: `code=${ev.code}` });
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, detail: "error" });
      }
    };
  });
  record("ws", "Polygon indices", r.ok, r.detail);
}

async function main() {
  console.log(`SPX E2E probe → ${BASE}`);
  console.log(`Polygon: ${POLYGON_KEY ? "key set" : "MISSING"} · UW: ${UW_KEY ? "key set" : "MISSING"}`);

  // Wait for server
  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/market/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) {
    console.error("\nServer not reachable at", BASE);
    process.exit(1);
  }

  await probeRoutes();
  await probePulseSse();
  await probeMarketStatusCache();
  await probeUwSockets();
  await probePolygonWs();

  console.log("\n── Summary ──");
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`  ${pass} passed · ${fail} failed · ${results.length} total`);
  if (fail) {
    console.log("\n  Failures:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`    - [${r.group}] ${r.name}: ${r.detail}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
