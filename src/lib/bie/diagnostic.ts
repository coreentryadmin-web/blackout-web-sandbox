import "server-only";

// composeDiagnostic — the server orchestrator for BIE self-diagnosis (task #56). Gathers each ops
// signal the pure core (diagnostic-core.ts) needs, EACH fail-open (any reader failing leaves its
// field null/safe, never throws), then evaluates + renders. Reuses ONLY existing read helpers
// (db.ts / shared-cache / limiter-stats / cron-health) — no new schema, no raw SQL, no raw Redis,
// no writes. Read-only ops awareness, honest "can't determine" over a guessed cause.

import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { isEtCashRth } from "@/lib/et-market-hours";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { isUwCircuitOpen, uwRateLimiterStats } from "@/lib/providers/uw-rate-limiter";
import { isPolygonCircuitOpen, polygonRateLimiterStats } from "@/lib/providers/polygon-rate-limiter";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { countRecentErrorEvents } from "@/lib/error-sink";
import { listOpenAdminIncidents } from "@/lib/admin-incidents";
import { todayEt } from "@/features/nighthawk/lib/session";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import {
  evaluateDiagnostic,
  renderDiagnosis,
  parseDiagSurface,
  type DiagInputs,
  type DiagSurface,
} from "@/lib/bie/diagnostic-core";

/** Scope error/incident signals to the surfaces this engine explains. */
const SCOPE_RE = /gex|vector|wall|bead|flow|heatmap|options/i;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
function safeSync<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Gather every diagnostic signal, fail-open per reader, then run the pure evaluation. Returns the
 * member-facing markdown + the raw inputs/result as context (for Layer-4 + observability).
 */
export async function composeDiagnostic(
  ticker: string,
  question: string
): Promise<{ answer: string; context: unknown } | null> {
  const T = normalizeVectorTicker(ticker || "SPX");
  const surface: DiagSurface = parseDiagSurface(question);
  const ymd = todayEt();

  const providersConfigured = safeSync(() => polygonConfigured() || uwConfigured(), false);
  const bothProvidersDown = safeSync(() => !polygonConfigured() && !uwConfigured(), false);
  const isRth = safeSync(() => isEtCashRth(), false);
  const inUniverse = safeSync(
    () => vectorUniverseTickers().map((t) => t.toUpperCase()).includes(T.toUpperCase()),
    false
  );

  const [cronHealth, rail, pos, errors, incidents] = await Promise.all([
    safe(() => buildCronHealthSnapshot(), null),
    safe(() => loadSessionWallHistory(ymd, T), null),
    safe(() => getGexPositioning(T), null),
    safe(() => countRecentErrorEvents(15), { total: 0, groups: [] as Array<{ source: string; scope: string | null; count: number }> }),
    safe(() => listOpenAdminIncidents(20), [] as Awaited<ReturnType<typeof listOpenAdminIncidents>>),
  ]);

  const circuitOpen = safeSync(() => isUwCircuitOpen() || isPolygonCircuitOpen(), false);
  const circuitDetail = circuitOpen
    ? safeSync(() => {
        const uw = isUwCircuitOpen() ? "UW" : null;
        const poly = isPolygonCircuitOpen() ? "Polygon" : null;
        void uwRateLimiterStats;
        void polygonRateLimiterStats;
        return [uw, poly].filter(Boolean).join(" + ") + " breaker open";
      }, null)
    : null;

  // Recorder cron row.
  const cronJob = cronHealth?.jobs?.find((j) => j.key === "vector-universe-snapshot") ?? null;
  const cron: DiagInputs["cron"] = cronJob
    ? {
        found: true,
        failed: (cronJob.last_status ?? "").toLowerCase() === "failed" || cronJob.status === "failed",
        marketHoursStale: !!cronJob.market_hours_stale,
        message: cronJob.last_message ?? null,
        rows: numOrNull(cronJob.meta?.rows),
        ageMin: cronJob.age_min ?? null,
      }
    : cronHealth
      ? { found: false, failed: false, marketHoursStale: false, message: null, rows: null, ageMin: null }
      : null;

  // Scoped error count.
  const scopedErrors = errors.groups
    .filter((g) => SCOPE_RE.test(`${g.source} ${g.scope ?? ""}`))
    .reduce((s, g) => s + (g.count ?? 0), 0);

  // Scoped open incidents.
  const scopedIncidents = incidents.filter((i) =>
    SCOPE_RE.test(`${String((i as { title?: string }).title ?? "")} ${String((i as { scope?: string }).scope ?? "")}`)
  ).length;

  // Flow crons down during RTH.
  const missedFlow =
    isRth &&
    !!cronHealth?.jobs?.some((j) => /flow-ingest|gex-alerts/.test(j.key) && j.market_hours_stale);

  const inputs: DiagInputs = {
    providersConfigured,
    bothProvidersDown,
    inUniverse,
    isRth,
    cron,
    railLen: rail ? rail.length : null,
    circuitOpen,
    circuitDetail,
    spot: pos?.spot ?? null,
    // No positioning object → unknown; object present but both walls null → chain too thin.
    wallsEmpty: pos ? pos.call_wall == null && pos.put_wall == null : null,
    errorCount: scopedErrors,
    errorSpike: scopedErrors >= 5,
    incidents: scopedIncidents,
    missedFlow,
  };

  const result = evaluateDiagnostic(T, surface, inputs);
  return { answer: renderDiagnosis(result), context: { diagnostic: result, inputs } };
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
