// HELIX flow-anomaly near-miss / rejection log (task #131) — the THIRD instance of
// the spx_engine_snapshots (task #108) / zerodte_scan_rejections (task #147)
// pattern: a scanning/detection loop computes real per-candidate metrics but only
// durably records the candidates that actually clear a hard threshold, silently
// discarding everything else. See src/app/api/cron/market-regime-detector/
// flow-anomaly-detection.ts's module doc for what gets captured and why (two
// DIFFERENT discard reasons: BELOW_THRESHOLD vs DEDUP_SUPPRESSED).
//
// THROTTLING: cadence here is every 5 min during RTH (railway.market-regime-
// detector.toml's cronSchedule, ~half of zerodte's 2-min grid-warm cadence, but
// still frequent enough that an idle-but-still-near-missing ticker would generate
// a near-duplicate row every tick without a throttle) — see this PR's
// docs/audit/FINDINGS.md entry for the full cadence/volume reasoning. Multiple
// simultaneous candidate tickers per tick (same as 0DTE Command, unlike SPX
// Slayer's single instrument), and — new wrinkle here — a SINGLE ticker can be a
// near-miss for TWO independent anomaly types at once (LARGE_PREMIUM_PRINT and
// DIRECTIONAL_FLOW_SKEW both fire off the same byTicker aggregate), so the cursor
// map below is keyed by `${ticker}|${anomaly_type}`, not ticker alone — reusing
// zerodte's per-ticker-only key would let one type's state transition silently
// clobber the other's throttle state for the same ticker.
//
// State-transition key deliberately excludes metric_value/premium (jitter tick-to-
// tick on an otherwise-unchanged near-miss) — includes reason + direction only,
// same philosophy engineSnapshotStateKey()/rejectionStateKey() already use. A
// reason flip (BELOW_THRESHOLD -> DEDUP_SUPPRESSED, e.g. the metric crossed the
// real threshold this tick, fired, then got dedup-suppressed the NEXT tick) is a
// real state transition and must log again — the map only ever holds one entry per
// (ticker, anomaly_type), overwritten on every transition.
//
// Kept OUTSIDE flow-anomaly-detection.ts and route.ts on purpose, mirroring
// rejections.ts's placement outside scan.ts: this module only needs @/lib/db + the
// shared ET-date helper, so a test of the throttle logic never needs to mock
// detectFlowAnomalies' own fetchRecentFlows dependency.
import {
  dbConfigured,
  getMeta,
  setMeta,
  insertFlowAnomalyNearMiss,
  fetchFlowAnomalyNearMisses,
} from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { FlowAnomalyNearMiss } from "@/app/api/cron/market-regime-detector/flow-anomaly-detection";

const FLOW_ANOMALY_NEAR_MISS_CURSOR_KEY = "flow_anomaly_near_miss_cursor";

type CursorEntry = { date: string; key: string };

function cursorMapKey(m: Pick<FlowAnomalyNearMiss, "ticker" | "anomaly_type">): string {
  return `${m.ticker ?? ""}|${m.anomaly_type}`;
}

/** State-transition key for the throttle — reason + direction only (see module doc
 *  above for why the jittery numeric fields are excluded). */
function nearMissStateKey(m: Pick<FlowAnomalyNearMiss, "reason" | "direction">): string {
  return JSON.stringify({ reason: m.reason, direction: m.direction });
}

async function loadNearMissCursor(today: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const raw = await getMeta(FLOW_ANOMALY_NEAR_MISS_CURSOR_KEY);
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, CursorEntry>;
    for (const [key, entry] of Object.entries(parsed)) {
      // Drop anything not from today — a new session's first near-miss for a
      // ticker/type pair that also near-missed yesterday must always log, never be
      // silently suppressed by a stale cursor entry from a prior day.
      if (entry && entry.date === today && typeof entry.key === "string") {
        map.set(key, entry.key);
      }
    }
  } catch {
    // Corrupt/legacy value — treat as empty; the next save overwrites it cleanly.
  }
  return map;
}

async function saveNearMissCursor(today: string, map: Map<string, string>): Promise<void> {
  const obj: Record<string, CursorEntry> = {};
  for (const [key, value] of map.entries()) obj[key] = { date: today, key: value };
  await setMeta(FLOW_ANOMALY_NEAR_MISS_CURSOR_KEY, JSON.stringify(obj));
}

/**
 * Persist this detector tick's near-misses — throttled to one row per
 * (ticker, anomaly_type) pair per DISTINCT (reason, direction) state, not one row
 * per cron tick. Called from market-regime-detector's route.ts on its own 5-min
 * RTH cron cadence — never from a member-facing route, since this cron IS the only
 * writer of flow_anomalies/market_regime already. Best-effort: never throws into
 * the caller (mirrors persistZeroDteRejections' own `.catch(() => 0)` contract at
 * its one call site).
 */
export async function persistFlowAnomalyNearMisses(nearMisses: FlowAnomalyNearMiss[]): Promise<number> {
  if (!dbConfigured() || nearMisses.length === 0) return 0;
  const today = todayEtYmd();
  const cursor = await loadNearMissCursor(today);

  const toWrite: FlowAnomalyNearMiss[] = [];
  for (const m of nearMisses) {
    const mapKey = cursorMapKey(m);
    const stateKey = nearMissStateKey(m);
    if (cursor.get(mapKey) === stateKey) continue;
    cursor.set(mapKey, stateKey);
    toWrite.push(m);
  }
  if (toWrite.length === 0) return 0;

  // Sequential, not batched — a detector tick's near-miss count is bounded by the
  // candidate universe (single digits to low tens of tickers, each contributing at
  // most 2 near-misses), so a multi-row round trip isn't worth the dynamic-SQL
  // complexity (mirrors insertZeroDteScanRejection's own one-row-at-a-time idiom).
  for (const m of toWrite) {
    await insertFlowAnomalyNearMiss({
      anomaly_type: m.anomaly_type,
      ticker: m.ticker,
      reason: m.reason,
      metric_value: m.metric_value,
      threshold: m.threshold,
      premium: m.premium,
      direction: m.direction,
      severity: m.severity,
      detail: m.detail,
    });
  }
  await saveNearMissCursor(today, cursor);
  return toWrite.length;
}

export type FlowAnomalyNearMissRow = {
  id: number;
  observed_at: string;
  anomaly_type: string;
  ticker: string | null;
  reason: string;
  metric_value: number;
  threshold: number;
  premium: number | null;
  direction: string | null;
  severity: string | null;
  detail: string;
};

/** Read path shared by the Largo tool below (and any future admin surface):
 *  "why didn't ticker X get flagged by HELIX" / "what has the anomaly detector
 *  been passing over today." Empty array (not a throw) when the DB isn't
 *  configured. */
export async function fetchFlowAnomalyNearMissesFor(opts?: {
  ticker?: string;
  limit?: number;
}): Promise<FlowAnomalyNearMissRow[]> {
  if (!dbConfigured()) return [];
  return fetchFlowAnomalyNearMisses(opts);
}

/** Largo tool payload (get_flow_anomaly_near_misses, run-tool.ts) — same
 *  `available` envelope idiom zeroDteRejectionsForLargo() uses in
 *  src/lib/zerodte/rejections.ts for the analogous 0DTE Command surface. */
export async function flowAnomalyNearMissesForLargo(
  ticker?: string,
  limit = 20
): Promise<Record<string, unknown>> {
  const rows = await fetchFlowAnomalyNearMissesFor({ ticker, limit });
  if (rows.length === 0) {
    return {
      available: false,
      note: ticker
        ? `no flow-anomaly near-miss history found for ${ticker.toUpperCase()} today`
        : "no HELIX flow-anomaly near-misses logged yet this session",
    };
  }
  return {
    available: true,
    source: "HELIX flow-anomaly near-miss log (flow_anomaly_near_misses) — NOT the committed flow_anomalies table",
    ticker: ticker ? ticker.toUpperCase() : null,
    near_misses: rows.map((r) => ({
      ticker: r.ticker,
      observed_at: r.observed_at,
      anomaly_type: r.anomaly_type,
      reason: r.reason,
      metric_value: r.metric_value,
      threshold: r.threshold,
      premium: r.premium,
      direction: r.direction,
      severity: r.severity,
      detail: r.detail,
    })),
  };
}
