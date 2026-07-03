import { sanitizeTelemetrySnippet } from "@/lib/api-telemetry-sanitize";

// NOTE: @/lib/db (which pulls node-only `pg`) is imported LAZILY inside the
// functions below — never at module top. instrumentation.ts dynamically imports
// this module, and instrumentation is bundled for BOTH the node and edge runtimes;
// a static `pg` import here would drag `fs`/`path` into the edge graph and fail the
// build. The lazy import keeps this module edge-safe while staying inert (no DB work)
// unless DATABASE_URL is set. api-telemetry-sanitize is pure, so it is safe at top.

/**
 * P1 (audit: "No external error tracking / durable error sink").
 *
 * A single, INERT-BY-DEFAULT error sink. captureError() does three independent,
 * best-effort things, each isolated so a failure in one (or in the sink itself)
 * can NEVER throw into a request hot path or into the process crash handler:
 *
 *   1. Durable DB row in error_events  (only when DATABASE_URL is set)
 *   2. Forward to Sentry               (only when SENTRY_DSN is set AND
 *                                        @sentry/nextjs is actually installed)
 *   3. console.error                   (always — preserves prior behavior)
 *
 * When neither a database nor SENTRY_DSN is configured this is effectively a
 * no-op beyond the console.error the callers already did. No static dependency
 * on @sentry/nextjs is added: the package is loaded via a guarded dynamic import
 * and silently skipped if absent, so the build never requires it.
 */

export type ErrorSource =
  | "admin_route"
  | "unhandled_rejection"
  | "uncaught_exception"
  | "request_error"
  | "manual"
  | "frontend"
  | "db_query";

export type ErrorContext = {
  source: ErrorSource;
  /** Route key, job key, or other locator. */
  scope?: string;
  /** Small, NON-SECRET structured context. Values are redacted before storage. */
  meta?: Record<string, unknown>;
};

/** Keep the durable table bounded; prune opportunistically to newest N rows. */
export const ERROR_EVENTS_KEEP = 2000;
let pruneCounter = 0;

function toErr(reason: unknown): { message: string; stack: string | null; name: string } {
  if (reason instanceof Error) {
    return { message: reason.message, stack: reason.stack ?? null, name: reason.name };
  }
  if (typeof reason === "string") return { message: reason, stack: null, name: "Error" };
  try {
    return { message: JSON.stringify(reason), stack: null, name: "Error" };
  } catch {
    return { message: String(reason), stack: null, name: "Error" };
  }
}

// ---------------------------------------------------------------------------
// Sentry (optional, dormant unless SENTRY_DSN set AND @sentry/nextjs installed)
// ---------------------------------------------------------------------------

type MinimalSentry = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (e: unknown, hint?: Record<string, unknown>) => void;
};

let sentryPromise: Promise<MinimalSentry | null> | null = null;

async function getSentry(): Promise<MinimalSentry | null> {
  if (!process.env.SENTRY_DSN?.trim()) return null;
  if (sentryPromise) return sentryPromise;
  sentryPromise = (async () => {
    try {
      // Guarded dynamic import: if @sentry/nextjs is not installed this throws
      // and we fall back to DB-only. Variable specifier keeps bundlers from
      // hard-requiring the module at build time.
      const spec = "@sentry/nextjs";
      const imported = (await import(/* webpackIgnore: true */ spec)) as
        Partial<MinimalSentry> & { default?: Partial<MinimalSentry> };
      // A native runtime import (webpackIgnore) can expose the SDK API either as
      // named exports (ESM/bundled) OR only under `.default` (CJS interop) — and
      // @sentry/nextjs's `captureException` lands on `.default` in the latter shape.
      // Normalize so capture is reliably callable either way (otherwise errors would
      // silently persist to DB only and never reach Sentry).
      const mod: Partial<MinimalSentry> =
        typeof imported?.captureException === "function"
          ? imported
          : (imported?.default ?? {});
      if (typeof mod.init === "function" && typeof mod.captureException === "function") {
        mod.init({
          dsn: process.env.SENTRY_DSN,
          tracesSampleRate: 0,
          environment: process.env.NODE_ENV,
        });
        return mod as MinimalSentry;
      }
      return null;
    } catch {
      return null; // package absent — DB sink still works
    }
  })();
  return sentryPromise;
}

// ---------------------------------------------------------------------------
// Durable DB sink
// ---------------------------------------------------------------------------

async function persistErrorEvent(
  e: { message: string; stack: string | null; name: string },
  ctx: ErrorContext
): Promise<void> {
  // Lazy import keeps node-only `pg` out of this module's static (edge-traced) graph.
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return;
  try {
    const safeMessage = (sanitizeTelemetrySnippet(e.message) ?? "").slice(0, 2000);
    const safeStack = sanitizeTelemetrySnippet(e.stack)?.slice(0, 8000) ?? null;
    let metaJson: string | null = null;
    try {
      metaJson = ctx.meta ? sanitizeTelemetrySnippet(JSON.stringify(ctx.meta)) : null;
    } catch {
      metaJson = null;
    }
    await dbQuery(
      `INSERT INTO error_events (source, scope, name, message, stack, meta_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [ctx.source, ctx.scope ?? null, e.name, safeMessage, safeStack, metaJson]
    );
    // Opportunistic prune (every ~50 inserts) keeps the table bounded.
    if (++pruneCounter % 50 === 0) {
      await dbQuery(
        `DELETE FROM error_events
         WHERE id < (
           SELECT COALESCE(MIN(id), 0) FROM (
             SELECT id FROM error_events ORDER BY id DESC LIMIT $1
           ) keep
         )`,
        [ERROR_EVENTS_KEEP]
      );
    }
  } catch (err) {
    console.warn("[error-sink] persist failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record an error to all configured durable sinks. Never throws. Returns a
 * promise that resolves once best-effort delivery completes; callers in hot
 * paths should NOT await it (use `void captureError(...)`).
 */
/**
 * Eagerly initialize the optional Sentry client (no-op unless SENTRY_DSN is set
 * AND @sentry/nextjs is installed). Safe to call repeatedly — getSentry() memoizes.
 * Called once at server boot from instrumentation.register() so the first captured
 * error doesn't pay the init latency.
 */
export async function initErrorSinkSentry(): Promise<void> {
  try {
    await getSentry();
  } catch {
    /* never throw from boot path */
  }
}

export async function captureError(reason: unknown, ctx: ErrorContext): Promise<void> {
  const e = toErr(reason);
  try {
    await Promise.allSettled([
      persistErrorEvent(e, ctx),
      (async () => {
        const sentry = await getSentry();
        if (sentry) {
          sentry.captureException(reason, {
            tags: { source: ctx.source, scope: ctx.scope ?? "" },
          });
        }
      })(),
    ]);
  } catch (err) {
    // Absolute backstop — the sink must never propagate.
    console.warn("[error-sink] captureError failed:", err);
  }
}

export type ErrorEventRow = {
  id: number;
  source: string;
  scope: string | null;
  name: string;
  message: string;
  stack: string | null;
  meta_json: unknown;
  created_at: string;
};

/**
 * Pure severity classifier for a recent error count (exported for tests).
 * none < warn ≤ warning < crit ≤ critical.
 */
export function classifyErrorSpike(
  total: number,
  warnThreshold: number,
  critThreshold: number
): "none" | "warning" | "critical" {
  if (total >= critThreshold) return "critical";
  if (total >= warnThreshold) return "warning";
  return "none";
}

/**
 * Count error_events in the last `sinceMinutes`, with a small top-groups breakdown for alerts.
 * Cache-reader-safe: a single bounded aggregate read, never a row dump. Returns zeros on any miss.
 */
export async function countRecentErrorEvents(
  sinceMinutes = 15
): Promise<{ total: number; groups: Array<{ source: string; scope: string | null; count: number }> }> {
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return { total: 0, groups: [] };
  const mins = Math.min(Math.max(1, Math.round(sinceMinutes)), 1440);
  try {
    const { rows } = await dbQuery<{ source: string; scope: string | null; count: string }>(
      `SELECT source, scope, COUNT(*)::text AS count
         FROM error_events
        WHERE created_at > NOW() - ($1 || ' minutes')::interval
        GROUP BY source, scope
        ORDER BY COUNT(*) DESC
        LIMIT 8`,
      [String(mins)]
    );
    const groups = rows.map((r) => ({ source: r.source, scope: r.scope, count: Number(r.count) }));
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    return { total, groups };
  } catch {
    return { total: 0, groups: [] };
  }
}

export async function fetchRecentErrorEvents(limit = 100): Promise<ErrorEventRow[]> {
  // Lazy import keeps node-only `pg` out of this module's static (edge-traced) graph.
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return [];
  try {
    const { rows } = await dbQuery<{
      id: string;
      source: string;
      scope: string | null;
      name: string;
      message: string;
      stack: string | null;
      meta_json: unknown;
      created_at: Date;
    }>(
      `SELECT id, source, scope, name, message, stack, meta_json, created_at
       FROM error_events
       ORDER BY id DESC
       LIMIT $1`,
      [Math.min(Math.max(1, limit), 500)]
    );
    return rows.map((r) => ({
      id: Number(r.id),
      source: r.source,
      scope: r.scope,
      name: r.name,
      message: r.message,
      stack: r.stack,
      meta_json: r.meta_json,
      created_at: new Date(r.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}
