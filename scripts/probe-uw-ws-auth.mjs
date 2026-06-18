#!/usr/bin/env node
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, f), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* optional */
  }
}

const KEY = (process.env.UW_API_KEY ?? "").trim();
const BASE = process.env.UW_WS_BASE ?? "wss://api.unusualwhales.com/api/socket";

async function testRest() {
  const r = await fetch("https://api.unusualwhales.com/api/market/market-tide", {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const text = await r.text();
  console.log(`REST market-tide: ${r.status} ${text.slice(0, 120)}`);
}

function testWs(channel, opts, label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/${channel}`, opts ?? undefined);
    let gotMessage = false;
    let opened = false;
    const timer = setTimeout(() => {
      ws.close();
      resolve({ label, detail: gotMessage ? "message received" : opened ? "open/no message" : "timeout/no open", ok: gotMessage || opened });
    }, 6000);

    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = (ev) => {
      gotMessage = true;
      clearTimeout(timer);
      ws.close();
      resolve({ label, detail: String(ev.data).slice(0, 100), ok: true });
    };
    ws.onclose = (ev) => {
      if (!gotMessage) {
        clearTimeout(timer);
        resolve({ label, detail: opened ? `opened then closed code=${ev.code}` : `closed code=${ev.code}`, ok: opened });
      }
    };
    ws.onerror = () => {
      /* wait for close */
    };
  });
}

async function main() {
  if (!KEY) {
    console.error("UW_API_KEY missing");
    process.exit(1);
  }
  await testRest();
  const bearerOpts = {
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: "application/json",
      "UW-CLIENT-API-ID": process.env.UW_CLIENT_API_ID ?? "100001",
    },
  };
  for (const [label, opts] of [
    ["no auth (expect 401)", null],
    ["Bearer header (UW docs)", bearerOpts],
  ]) {
    const r = await testWs("flow_alerts", opts, label);
    console.log(`WS flow_alerts ${label} → ${r.ok ? "OK" : "FAIL"}: ${r.detail}`);
  }
}

main();
