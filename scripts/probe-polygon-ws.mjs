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

const KEY = (process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "").trim();
const URL = process.env.POLYGON_WS_INDICES ?? "wss://socket.massive.com/indices";

if (!KEY) {
  console.error("POLYGON_API_KEY missing");
  process.exit(1);
}

const ws = new WebSocket(URL);
let settled = false;
const timer = setTimeout(() => {
  if (!settled) {
    settled = true;
    ws.close();
    console.log("RESULT: timeout");
  }
}, 8000);

ws.onopen = () => console.log("open");
ws.onmessage = (ev) => {
  console.log("msg:", String(ev.data).slice(0, 300));
  try {
    const msgs = JSON.parse(String(ev.data));
    for (const msg of msgs) {
      if (msg.ev === "connected" || (msg.ev === "status" && msg.status === "connected")) {
        ws.send(JSON.stringify({ action: "auth", params: KEY }));
      }
      if (msg.ev === "auth_success" || (msg.ev === "status" && msg.status === "auth_success")) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          console.log("RESULT: auth_success");
        }
      }
      if (msg.ev === "auth_failed" || msg.status === "auth_failed") {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          console.log("RESULT: auth_failed");
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
    console.log(`RESULT: closed code=${ev.code} reason=${ev.reason || "(none)"}`);
  }
};
ws.onerror = () => console.log("error event");
