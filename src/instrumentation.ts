// P1 (audit: "No external error tracking") — SAFE HALF of the deferred crash
// handler. Installs a process-level `unhandledRejection` listener ONLY. The
// `uncaughtException` half was deferred for staged rollout because it changes
// process-exit semantics. Intentionally does NOT call process.exit — the goal is
// "keep the server up + alert ops". Note: registering an `unhandledRejection`
// listener suppresses Node's default terminate-on-rejection behavior; that is the
// intended trade-off here.
//
// Next 14.2 instrumentation contract: this file must export `register()`, which
// Next invokes once per server runtime instance at startup (gated by
// experimental.instrumentationHook in next.config.mjs). register() also runs for
// the edge runtime, so we hard-gate on NEXT_RUNTIME === 'nodejs' to make it a
// strict no-op on edge/client.

// Module-scope guard on globalThis so HMR / repeated register() calls in dev never
// stack multiple listeners.
const INSTALLED_FLAG = "__blackoutUnhandledRejectionInstalled" as const;

export async function register(): Promise<void> {
  // Strict no-op on edge runtime and client. NEXT_RUNTIME is 'nodejs' only on the
  // Node.js server; 'edge' on the edge runtime; undefined on the client.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & { [INSTALLED_FLAG]?: boolean };
  if (g[INSTALLED_FLAG]) return; // idempotent: already installed (HMR-safe)
  g[INSTALLED_FLAG] = true;

  process.on("unhandledRejection", (reason: unknown) => {
    // The handler itself must never throw. Everything below is wrapped so a failure
    // in logging/alerting can't crash the process.
    try {
      const err =
        reason instanceof Error
          ? reason
          : new Error(typeof reason === "string" ? reason : JSON.stringify(reason));
      console.error("[instrumentation] unhandledRejection:", err);

      // Lazy dynamic import so the notify module (and its deps) are never pulled into
      // the edge/client graph and only load on first failure.
      void import("@/lib/spx-play-notify")
        .then(({ notifyOpsDiscord }) =>
          notifyOpsDiscord({
            title: "Unhandled promise rejection",
            body: "```\n" + (err.stack || err.message).slice(0, 1500) + "\n```",
            severity: "critical",
          })
        )
        .catch((e) => {
          console.error("[instrumentation] failed to send ops alert:", e);
        });
    } catch (e) {
      console.error("[instrumentation] handler error (swallowed):", e);
    }
  });
}
