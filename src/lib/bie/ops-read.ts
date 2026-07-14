import "server-only";

// composeOpsRead — the server orchestrator for BIE's governed OPS READ tools (task #58). Gathers
// each ops signal READ-ONLY and fail-open (any reader failing leaves its field null/unavailable,
// never throws), then hands plain data to the pure core (ops-read-core.ts) to decide + render.
//
// Governance guarantees:
//  - READ ONLY. No mutations anywhere — reuses existing read helpers (admin-cron-health snapshot,
//    a lightweight provider reachability GET, shared-cache reads). No schema, no writes.
//  - HONEST. Real statuses/timestamps/ages or an explicit "unavailable" — never a fabricated verdict.
//  - CLEAN. Member-facing strings carry no secret / internal hostname / raw upstream error. The raw
//    diagnostic is logged server-side only (same "log raw, return clean" pattern as /api/ready, #66).
//  - GATED. Detail is rendered only for the admin audience; a member gets a clean health badge. Today
//    all of Largo is admin-launch-gated (matches how #56 self-diagnosis is gated), so the default
//    audience is admin; pass isAdmin=false to force the member badge once Largo de-gates.

import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { isEtCashRth } from "@/lib/et-market-hours";
import { sharedCacheGetWithTtl } from "@/lib/shared-cache";
import { BIE_FULL_STATE_CACHE_KEY } from "@/lib/bie/full-platform-cache";
import type { BieComposed } from "@/lib/bie/composers-shared";
import {
  parseOpsReadKind,
  evaluateCronRuns,
  evaluateProviderHealth,
  evaluateCacheProbe,
  combineOpsHealth,
  renderCronRuns,
  renderProviderHealth,
  renderCacheProbe,
  renderOpsOverview,
  type OpsAudience,
  type CronRunsGathered,
  type ProviderProbeInput,
  type CacheProbeInput,
  type CronRunsResult,
  type ProviderHealthResult,
  type CacheProbeResult,
  type OpsOverviewResult,
} from "@/lib/bie/ops-read-core";

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

/** Short reachability timeout — a health probe, not a data fetch. */
const PROBE_TIMEOUT_MS = 3_500;

// ---------------------------------------------------------------------------
// Signal gathering (fail-open, read-only)
// ---------------------------------------------------------------------------

async function gatherCronRuns(): Promise<CronRunsGathered> {
  const snapshot = await safe(() => buildCronHealthSnapshot(), null);
  if (!snapshot) {
    return { jobs: [], db_configured: false, logged_runs_total: 0, diagnostics_note: null, snapshot_available: false };
  }
  return {
    snapshot_available: true,
    db_configured: snapshot.db_configured,
    logged_runs_total: snapshot.logged_runs_total,
    diagnostics_note: snapshot.diagnostics_note,
    jobs: snapshot.jobs.map((j) => ({
      key: j.key,
      name: j.name,
      schedule_label: j.schedule_label,
      status: j.status,
      last_run_at: j.last_run_at,
      last_status: j.last_status,
      age_min: j.age_min,
      stale_after_min: j.stale_after_min,
      market_hours_stale: j.market_hours_stale,
      last_message: j.last_message,
    })),
  };
}

/**
 * Lightweight reachability probe. A single cheap GET behind a short timeout — deliberately NOT the
 * tracked/rate-limited data path (a health check must not consume the budget or trip the breaker).
 * "responded" = an HTTP response was received (DNS+TCP+TLS+HTTP completed); the raw error on failure
 * is logged server-side and never surfaced. Key/hostname stay out of the returned struct.
 */
async function probeProvider(
  provider: "polygon" | "uw",
  label: string,
  configured: boolean,
  url: string | null,
  headers: Record<string, string>
): Promise<ProviderProbeInput> {
  if (!configured || !url) {
    return { provider, label, configured, responded: false, httpStatus: null, latencyMs: null };
  }
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    // Drain/allow GC — we only care about the status line for reachability.
    void res.body?.cancel?.().catch?.(() => undefined);
    return { provider, label, configured, responded: true, httpStatus: res.status, latencyMs };
  } catch (err) {
    // Log raw server-side ONLY — may embed the URL/host. Never returned to the caller.
    console.warn(`[ops-read] ${provider} reachability probe failed:`, err instanceof Error ? err.message : err);
    return { provider, label, configured, responded: false, httpStatus: null, latencyMs: null };
  }
}

async function gatherProviderHealth(): Promise<ProviderProbeInput[]> {
  const polyBase = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
  const polyKey = process.env.POLYGON_API_KEY?.trim() ?? "";
  const uwBase = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
  const uwKey = process.env.UW_API_KEY?.trim() ?? "";

  const polygonConf = safeSync(() => polygonConfigured(), false);
  const uwConf = safeSync(() => uwConfigured(), false);

  // Cheap known endpoints already used elsewhere: Polygon marketstatus, UW market-tide.
  const polyUrl = polygonConf ? `${polyBase}/v1/marketstatus/now?apiKey=${encodeURIComponent(polyKey)}` : null;
  const uwUrl = uwConf ? `${uwBase}/api/market/market-tide` : null;

  return Promise.all([
    probeProvider("polygon", "Polygon", polygonConf, polyUrl, {}),
    probeProvider("uw", "Unusual Whales", uwConf, uwUrl, uwKey ? { Authorization: `Bearer ${uwKey}` } : {}),
  ]);
}

/** Read one shared-cache key, deriving age from the payload's own timestamp when present. */
async function probeCache(
  label: string,
  key: string,
  ttlSec: number,
  staleAfterSec: number,
  timestampFields: Array<"asOf" | "updatedAt">,
  marketHoursOnly: boolean
): Promise<CacheProbeInput> {
  const hit = await safe(() => sharedCacheGetWithTtl<Record<string, unknown>>(key), null);
  if (!hit) {
    return { label, key, present: false, ageSec: null, remainingTtlSec: null, ttlSec, staleAfterSec, marketHoursOnly };
  }
  let ageSec: number | null = null;
  const v = hit.value ?? {};
  for (const f of timestampFields) {
    const raw = v[f];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      // Epoch ms (updatedAt is ms since epoch).
      ageSec = Math.max(0, Math.round((Date.now() - raw) / 1000));
      break;
    }
    if (typeof raw === "string") {
      const t = Date.parse(raw);
      if (Number.isFinite(t)) {
        ageSec = Math.max(0, Math.round((Date.now() - t) / 1000));
        break;
      }
    }
  }
  return { label, key, present: true, ageSec, remainingTtlSec: hit.remainingTtlSec, ttlSec, staleAfterSec, marketHoursOnly };
}

async function gatherCacheProbe(): Promise<CacheProbeInput[]> {
  const FIVE_MIN_STALE = 12 * 60; // ~2.4× the 5-min RTH cron cadence
  return Promise.all([
    probeCache("24/7 platform snapshot", BIE_FULL_STATE_CACHE_KEY, 15 * 60, FIVE_MIN_STALE, ["asOf"], true),
    probeCache("Vector universe scanner", "vector:universe:snapshot", 48 * 60 * 60, FIVE_MIN_STALE, ["updatedAt"], true),
    probeCache("Vector full-state (SPX)", "vector:full-state:SPX:all", 15 * 60, FIVE_MIN_STALE, ["asOf"], true),
  ]);
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export type ComposeOpsOpts = { isAdmin?: boolean };

/**
 * Compose the governed ops read for a question. `isAdmin === false` forces the clean member badge;
 * otherwise (admin, or unspecified — the admin-gated Largo default) the full breakdown is rendered.
 */
export async function composeOpsRead(question: string, opts?: ComposeOpsOpts): Promise<BieComposed | null> {
  const kind = parseOpsReadKind(question || "");
  const audience: OpsAudience = opts?.isAdmin === false ? "member" : "admin";
  const isRth = safeSync(() => isEtCashRth(), false);

  if (kind === "crons") {
    const res: CronRunsResult = evaluateCronRuns(await gatherCronRuns());
    return { answer: renderCronRuns(res, audience), context: { ops: "crons", result: res } };
  }
  if (kind === "providers") {
    const res: ProviderHealthResult = evaluateProviderHealth(await gatherProviderHealth());
    return { answer: renderProviderHealth(res, audience), context: { ops: "providers", result: res } };
  }
  if (kind === "caches") {
    const res: CacheProbeResult = evaluateCacheProbe(await gatherCacheProbe(), isRth);
    return { answer: renderCacheProbe(res, audience), context: { ops: "caches", result: res } };
  }

  // Overview — gather all three in parallel, fail-open per read.
  const [cronG, provP, cacheP] = await Promise.all([
    gatherCronRuns(),
    gatherProviderHealth(),
    gatherCacheProbe(),
  ]);
  const crons = evaluateCronRuns(cronG);
  const providers = evaluateProviderHealth(provP);
  const caches = evaluateCacheProbe(cacheP, isRth);
  const overview: OpsOverviewResult = {
    overall: combineOpsHealth([crons.overall, providers.overall, caches.overall]),
    crons,
    providers,
    caches,
  };
  return { answer: renderOpsOverview(overview, audience), context: { ops: "overview", result: overview } };
}
