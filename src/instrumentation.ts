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

  // NOTE: the once-per-deploy Cloudflare edge purge is deliberately NOT triggered
  // here. cf-purge-on-deploy imports make-redis (ioredis), and Next statically traces
  // instrumentation.ts for the EDGE runtime — even a dynamic import() of an ioredis
  // dependent pulls node:diagnostics_channel into the edge bundle (webpack
  // UnhandledScheme build failure — verified). The purge is fired from
  // ensureDataSockets() instead (nodejs-only path, never edge-traced), exactly like
  // the data sockets and shutdown wiring described below.

  // NOTE: the shared data sockets (uw/polygon/options) are NOT booted here, and the
  // graceful SIGTERM/SIGINT shutdown is NOT registered here either. Next statically
  // traces instrumentation.ts for the EDGE runtime too, and even a dynamic import()
  // of the socket graph pulls ioredis/node:crypto into the edge bundle
  // (UnhandledSchemeError at build — verified). Both the boot AND the shutdown wiring
  // live in ensureDataSockets() (src/lib/ws/init-data-sockets.ts), which is imported
  // only by nodejs route handlers (src/app/api/market/*) and is never edge-traced.
  // The shutdown signal handler is installed there on first nodejs request — exactly
  // when the sockets first exist, so there is nothing to close before then.

  // Eagerly initialize the error sink's Sentry client at boot (nodejs only) so the
  // first captured error doesn't pay the init cost and Sentry is ready immediately.
  // No-op unless SENTRY_DSN is set AND @sentry/nextjs is installed; lazy import keeps
  // server-only deps out of the edge-traced graph.
  void import("@/lib/error-sink")
    .then(({ initErrorSinkSentry }) => initErrorSinkSentry?.())
    .catch(() => undefined);

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
      void import("@/features/spx/lib/spx-play-notify")
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

      // Durable error sink (no-op unless DATABASE_URL / SENTRY_DSN set). Lazy import
      // keeps server-only deps (pg) out of the edge/client graph; load on first failure.
      void import("@/lib/error-sink")
        .then(({ captureError }) =>
          captureError(err, { source: "unhandled_rejection" })
        )
        .catch((e) => {
          console.error("[instrumentation] failed to persist error:", e);
        });
    } catch (e) {
      console.error("[instrumentation] handler error (swallowed):", e);
    }
  });
}

/**
 * Next.js instrumentation hook: invoked for errors thrown while rendering/handling
 * a request (App Router server components + route handlers), including UNCAUGHT
 * errors that never reach an explicit captureError call site. Routes them through
 * the durable error sink (Postgres + Sentry when configured).
 *
 * Gated to the nodejs runtime: the sink lazily pulls `pg`/@sentry/nextjs, which are
 * server-only; edge errors are skipped rather than dragging node deps onto edge.
 * Must never throw (it runs inside Next's error path).
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context?: { routerKind?: string; routePath?: string; routeType?: string }
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { captureError } = await import("@/lib/error-sink");
    await captureError(error, {
      source: "request_error",
      scope: context?.routePath || request?.path || "unknown",
      meta: {
        method: request?.method,
        route_type: context?.routeType,
        router_kind: context?.routerKind,
      },
    });
  } catch (e) {
    console.error("[instrumentation] onRequestError capture failed (swallowed):", e);
  }
}
