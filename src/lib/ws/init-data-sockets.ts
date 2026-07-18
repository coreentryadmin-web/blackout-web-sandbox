import { initPolygonSocket, shutdownPolygonSocket } from "@/lib/ws/polygon-socket";
import { initUwSocket, shutdownUwSocket } from "@/lib/ws/uw-socket";
import { initOptionsSocket, shutdownOptionsSocket } from "@/lib/ws/options-socket";
import { initStocksSocket, shutdownStocksSocket } from "@/lib/ws/stocks-socket";
import { initFlowEventBridge } from "@/lib/flow-events";

let initialized = false;
let closed = false;
let shutdownHandlersInstalled = false;

/**
 * Register a ONE-TIME SIGTERM/SIGINT handler that closes the data sockets on a
 * graceful process shutdown. Installed here (NOT in instrumentation.ts) on
 * purpose: instrumentation.ts is statically traced for the Next EDGE runtime, and
 * even a dynamic import() of this socket graph from there pulls ioredis/node:crypto
 * into the edge bundle (UnhandledSchemeError at build — verified). This module is
 * only ever imported by nodejs route handlers, so referencing closeAllDataSockets
 * here is edge-safe. The handler runs once (guarded), is best-effort, never throws,
 * and does NOT call process.exit — it lets Next/Node finish their own shutdown.
 */
function installShutdownHandlers() {
  if (shutdownHandlersInstalled) return;
  // Defensive: only the Node.js server has process signals. ensureDataSockets is
  // only called from nodejs handlers, but guard anyway so this can never throw.
  if (typeof process === "undefined" || typeof process.once !== "function") return;
  shutdownHandlersInstalled = true;

  let ran = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (ran) return; // SIGTERM then SIGINT must close only once
    ran = true;
    try {
      console.log(`[init-data-sockets] ${signal} — closing data sockets (best-effort)`);
      closeAllDataSockets();
    } catch (err) {
      console.error("[init-data-sockets] shutdown handler error (swallowed):", err);
    }
  };

  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
}

/** Initialize UW + Polygon + options WebSocket managers once per server process. */
export function ensureDataSockets() {
  if (initialized) return;
  initialized = true;
  // Wire graceful shutdown the first time the sockets are booted, so the old
  // ECS container releases its upstream slots on SIGTERM. Wrapped so a failure
  // installing the handler can never block socket init.
  try {
    installShutdownHandlers();
  } catch (err) {
    console.warn("[init-data-sockets] failed to install shutdown handlers (non-fatal):", err);
  }
  void initFlowEventBridge();
  initUwSocket();
  initPolygonSocket();
  // Once-per-deploy Cloudflare edge purge for the static marketing pages. Fired from
  // HERE (a nodejs-only path that is never edge-traced) rather than instrumentation.ts,
  // because cf-purge-on-deploy pulls in ioredis. No-op unless CF_API_TOKEN + CF_ZONE_ID
  // are set; cross-replica deduped via Redis; fire-and-forget so it can never block boot.
  void import("@/lib/cf-purge-on-deploy")
    .then(({ maybePurgeCloudflareOnDeploy }) => maybePurgeCloudflareOnDeploy())
    .catch((err) => console.warn("[init-data-sockets] cf-purge skipped (non-fatal):", err));
  void import("@/lib/staging-boot-warm")
    .then(({ ensureStagingBootWarm }) => ensureStagingBootWarm())
    .catch((err) => console.warn("[init-data-sockets] staging-boot-warm skipped (non-fatal):", err));
  // Night's Watch live option marks — env-gated + isolated. A strict no-op unless
  // OPTIONS_WS_ENABLED is set, so it can never destabilize the uw/polygon sockets
  // or the REST snapshot fallback. Wrapped so an init throw can't break the others.
  try {
    initOptionsSocket();
  } catch (err) {
    console.warn("[init-data-sockets] options socket init failed (non-fatal):", err);
  }
  try {
    initStocksSocket();
  } catch (err) {
    console.warn("[init-data-sockets] stocks/LULD socket init failed (non-fatal):", err);
  }
  // Backup RTH warmers when ECS scheduled tasks stall (#90 silent-death). Leader-elected;
  // dispatches idempotent cache warmers from in-process when cron_job_runs age exceeds cadence.
  void import("@/lib/rth-warm-leader")
    .then(({ ensureRthWarmLeader }) => ensureRthWarmLeader())
    .catch((err) => console.warn("[init-data-sockets] RTH warm leader init failed (non-fatal):", err));
}

/**
 * Graceful shutdown for all data sockets (UW + Polygon indices + options). Each
 * manager is shut down in its own try/catch so one failure can't block the
 * others. Closing the live sockets with a normal close (1000) makes the old
 * ECS container release its upstream slots immediately on SIGTERM, which
 * avoids the code=1008 indices reconnect collision when the new container's
 * connection lands. Idempotent and never throws.
 */
export function closeAllDataSockets(): void {
  if (closed) return;
  closed = true;
  try {
    shutdownUwSocket();
  } catch (err) {
    console.warn("[init-data-sockets] uw socket shutdown failed (non-fatal):", err);
  }
  try {
    shutdownPolygonSocket();
  } catch (err) {
    console.warn("[init-data-sockets] polygon socket shutdown failed (non-fatal):", err);
  }
  try {
    shutdownOptionsSocket();
  } catch (err) {
    console.warn("[init-data-sockets] options socket shutdown failed (non-fatal):", err);
  }
  try {
    shutdownStocksSocket();
  } catch (err) {
    console.warn("[init-data-sockets] stocks socket shutdown failed (non-fatal):", err);
  }
}
