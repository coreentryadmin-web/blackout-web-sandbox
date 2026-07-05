// Flow anomaly detection, split out of route.ts for the SAME reason
// derive-composite.ts was split out: Next.js's route-export validator rejects any
// named export from a route.ts file other than the HTTP method handlers and its
// handful of config constants, so a pure/testable detectFlowAnomalies() can't live
// there. Behavior here is byte-for-byte identical to the function this replaced —
// this file only ADDS the optional near-miss capture (task #131/HELIX).
//
// Near-miss/rejection log (task #131) — the HELIX analogue of task #108's
// spx_engine_snapshots / task #147's zerodte_scan_rejections. detectFlowAnomalies
// computes real per-ticker metrics (max single print, call/put premium totals and
// skew ratio) for every ticker with recent HELIX flow, but only ever pushes an
// Anomaly when it clears one of two hard thresholds: a $2M+ single print
// (LARGE_PREMIUM_PRINT) or a 10:1+ call/put skew on $500k+ total premium
// (DIRECTIONAL_FLOW_SKEW). A ticker that falls short — a $1.8M print, an 8:1 skew —
// left NO trace anywhere once the next 5-min cron tick recomputed byTicker from
// scratch, even though the metric was already sitting in memory a moment before
// being discarded. The optional `opts.nearMisses` accumulator below lets a caller
// durably capture exactly that, without changing which anomalies fire or how.
//
// SHORT-CIRCUIT DISCIPLINE (mirrors task #147's board.ts doc): the skew check is
// gated behind `total >= SKEW_MIN_TOTAL_PREMIUM` in the ORIGINAL code — callRatio/
// putRatio are only ever computed once that gate clears. A ticker with < $500k
// total premium therefore never has a skew ratio in the live code path, even though
// computing one would be cheap arithmetic on numbers already in scope. This module
// respects that distinction: a near-miss is only recorded for DIRECTIONAL_FLOW_SKEW
// when the SAME gate the real detector uses (total >= SKEW_MIN_TOTAL_PREMIUM) has
// already cleared — never a synthetic ratio for a ticker the live detector would
// not have evaluated at all. (There is no analogous "gate 0" near-miss type for
// tickers under $500k total premium — the task's own examples are both about a
// candidate that reached evaluation and fell short of the NAMED threshold, not
// about a candidate that never reached candidacy; scope stays to those two.)
//
// NEAR-MISS BAND, not "every sub-threshold value": recording every ticker below
// $2M as a "near miss" of the print threshold would flood the table with routine,
// unremarkable prints (flow_alerts already floors at $200k premium per print —
// see MIN_PREMIUM in flow-persist.ts — so plenty of ordinary $200k-$900k prints
// exist and are NOT meaningfully "near" a $2M anomaly). A near-miss is only
// recorded once the metric is at least NEAR_MISS_FACTOR (50%) of the way to the
// real threshold — i.e. genuinely close calls, which is what "why didn't this fire"
// questions are actually asking about. This band ONLY affects what gets captured in
// the new near-miss table; it never touches the real anomaly thresholds below.
import { fetchRecentFlows, type FlowRow } from "@/lib/db";

export const LARGE_PRINT_THRESHOLD = 2_000_000;
export const SKEW_RATIO_THRESHOLD = 10;
export const SKEW_MIN_TOTAL_PREMIUM = 500_000;

/** Near-miss band floor, as a fraction of each real threshold — see module doc. */
export const NEAR_MISS_FACTOR = 0.5;
export const LARGE_PRINT_NEAR_MISS_FLOOR = LARGE_PRINT_THRESHOLD * NEAR_MISS_FACTOR;
export const SKEW_RATIO_NEAR_MISS_FLOOR = SKEW_RATIO_THRESHOLD * NEAR_MISS_FACTOR;

export type FlowAnomaly = {
  type: string;
  ticker: string | null;
  detail: string;
  premium: number | null;
  direction: string | null;
  severity: string;
  /** The actual value measured against this anomaly's own threshold — maxSingle
   *  premium for LARGE_PREMIUM_PRINT (same number as `premium` there), the winning
   *  call/put ratio for DIRECTIONAL_FLOW_SKEW (a RATIO, NOT a dollar amount — do
   *  not confuse with `premium`, which is the total call+put premium for that
   *  type). Added so route.ts's DEDUP_SUPPRESSED near-miss capture (task #131) has
   *  a real, already-computed number to cite instead of reaching for `premium`
   *  (wrong unit for the skew case) or re-parsing `detail`. */
  metric_value: number;
};

/** Distinguishes the two, structurally different ways a computed anomaly candidate
 *  never reaches `flow_anomalies`:
 *   - "BELOW_THRESHOLD": detectFlowAnomalies itself never pushed it to `anomalies`
 *     because the metric fell short of the hard threshold.
 *   - "DEDUP_SUPPRESSED": detectFlowAnomalies DID push it (it's a real, fully-formed
 *     Anomaly), but route.ts's own 15-minute same-type+ticker dedup check found a
 *     match already logged and skipped the INSERT. This case carries the full
 *     Anomaly's own fields (severity, exact premium/detail) — nothing was
 *     recomputed or guessed for it, unlike the BELOW_THRESHOLD case where later
 *     fields may genuinely never have been computed. */
export type FlowAnomalyNearMissReason = "BELOW_THRESHOLD" | "DEDUP_SUPPRESSED";

export type FlowAnomalyNearMiss = {
  anomaly_type: string;
  ticker: string | null;
  reason: FlowAnomalyNearMissReason;
  /** The actual computed value measured against `threshold` — maxSingle premium
   *  for LARGE_PREMIUM_PRINT, the winning call/put ratio for DIRECTIONAL_FLOW_SKEW. */
  metric_value: number;
  threshold: number;
  premium: number | null;
  direction: string | null;
  /** Only ever populated for DEDUP_SUPPRESSED (the real Anomaly already computed
   *  one) — a BELOW_THRESHOLD candidate never reaches the point where the live
   *  detector assigns a severity, so this stays null rather than being guessed. */
  severity: string | null;
  detail: string;
};

/**
 * Detect HELIX flow anomalies from the last 30 minutes of recent prints.
 *
 * `opts.nearMisses`, when supplied, is an accumulator this function pushes a
 * `FlowAnomalyNearMiss` into for every ticker whose LARGE_PREMIUM_PRINT or
 * DIRECTIONAL_FLOW_SKEW metric falls in the near-miss band (see module doc) but
 * doesn't clear the real threshold. Purely additive — mutates the caller's array,
 * never read from, never affects `anomalies` — and a complete no-op when omitted,
 * so the one pre-existing caller (route.ts) sees zero behavior change from this
 * parameter alone.
 *
 * `opts.rows`, when supplied, is used INSTEAD of this function's own
 * fetchRecentFlows call (task #132 — see src/lib/correctness/flows-verifier.ts).
 * The correctness verifier needs to independently recompute this exact
 * classification over the exact rows this function scores, in the SAME process
 * tick. Without an injection point, the verifier's own read and this function's
 * internal read would be two separate point-in-time queries against a live,
 * fast-moving 30-minute tape — a print landing between the two reads would look
 * like a detector regression when it is really just a race between two
 * independent DB reads. Purely additive: every existing caller (route.ts) omits
 * `rows` and gets byte-for-byte the same behavior (its own fresh fetch) as before
 * this parameter existed.
 */
export async function detectFlowAnomalies(opts?: {
  nearMisses?: FlowAnomalyNearMiss[];
  rows?: FlowRow[];
}): Promise<FlowAnomaly[]> {
  const anomalies: FlowAnomaly[] = [];
  try {
    // Fetch recent 30-min HELIX flows for anomaly detection (unless the caller
    // already has the exact-window row set to inject — see opts.rows above).
    const rows = opts?.rows ?? (await fetchRecentFlows({ since_hours: 0.5, order: "premium" }));
    if (!rows.length) return anomalies;

    // Group by ticker
    const byTicker = new Map<string, typeof rows>();
    for (const r of rows) {
      const t = r.ticker ?? "SPX";
      if (!byTicker.has(t)) byTicker.set(t, []);
      byTicker.get(t)!.push(r);
    }

    for (const [ticker, prints] of byTicker) {
      let callPrem = 0;
      let putPrem = 0;
      let maxSingle = 0;
      let maxSingleRow: (typeof rows)[0] | null = null;

      for (const p of prints) {
        const prem = p.premium ?? 0;
        if (p.option_type?.toUpperCase().startsWith("C")) callPrem += prem;
        else putPrem += prem;
        if (prem > maxSingle) {
          maxSingle = prem;
          maxSingleRow = p;
        }
      }

      // Large single print > $2M
      if (maxSingle >= LARGE_PRINT_THRESHOLD && maxSingleRow) {
        const dir = maxSingleRow.option_type?.toUpperCase().startsWith("C") ? "bullish" : "bearish";
        anomalies.push({
          type: "LARGE_PREMIUM_PRINT",
          ticker,
          detail: `${ticker}: $${(maxSingle / 1_000_000).toFixed(1)}M single ${maxSingleRow.option_type?.toUpperCase()} print at strike ${maxSingleRow.strike}`,
          premium: maxSingle,
          direction: dir,
          severity: maxSingle >= 5_000_000 ? "CRITICAL" : "HIGH",
          metric_value: maxSingle,
        });
      } else if (maxSingle >= LARGE_PRINT_NEAR_MISS_FLOOR && maxSingleRow) {
        const dir = maxSingleRow.option_type?.toUpperCase().startsWith("C") ? "bullish" : "bearish";
        opts?.nearMisses?.push({
          anomaly_type: "LARGE_PREMIUM_PRINT",
          ticker,
          reason: "BELOW_THRESHOLD",
          metric_value: maxSingle,
          threshold: LARGE_PRINT_THRESHOLD,
          premium: maxSingle,
          direction: dir,
          severity: null,
          detail: `${ticker}: $${(maxSingle / 1_000_000).toFixed(2)}M single ${maxSingleRow.option_type?.toUpperCase()} print at strike ${maxSingleRow.strike} — below the $${(LARGE_PRINT_THRESHOLD / 1_000_000).toFixed(1)}M anomaly threshold`,
        });
      }

      // Extreme call/put skew (10:1 or 1:10)
      const total = callPrem + putPrem;
      if (total >= SKEW_MIN_TOTAL_PREMIUM) {
        const callRatio = putPrem > 0 ? callPrem / putPrem : callPrem > 0 ? 99 : 0;
        const putRatio = callPrem > 0 ? putPrem / callPrem : putPrem > 0 ? 99 : 0;
        if (callRatio >= SKEW_RATIO_THRESHOLD) {
          anomalies.push({
            type: "DIRECTIONAL_FLOW_SKEW",
            ticker,
            detail: `${ticker}: extreme call skew (${callRatio.toFixed(0)}:1 call/put) — $${(callPrem / 1_000_000).toFixed(1)}M calls vs $${(putPrem / 1_000_000).toFixed(1)}M puts`,
            premium: total,
            direction: "bullish",
            severity: "HIGH",
            metric_value: Math.round(callRatio * 100) / 100,
          });
        } else if (putRatio >= SKEW_RATIO_THRESHOLD) {
          anomalies.push({
            type: "DIRECTIONAL_FLOW_SKEW",
            ticker,
            detail: `${ticker}: extreme put skew (${putRatio.toFixed(0)}:1 put/call) — $${(putPrem / 1_000_000).toFixed(1)}M puts vs $${(callPrem / 1_000_000).toFixed(1)}M calls`,
            premium: total,
            direction: "bearish",
            severity: "HIGH",
            metric_value: Math.round(putRatio * 100) / 100,
          });
        } else {
          // Cleared the volume gate (total >= SKEW_MIN_TOTAL_PREMIUM, the SAME
          // precondition the real detector requires before it computes a ratio at
          // all) but neither side's ratio reached SKEW_RATIO_THRESHOLD. Only the
          // WINNING side's ratio is reported — mirrors the real detector, which
          // never reports both directions for the same ticker/tick.
          const winningRatio = Math.max(callRatio, putRatio);
          if (winningRatio >= SKEW_RATIO_NEAR_MISS_FLOOR) {
            const dir = callRatio >= putRatio ? "bullish" : "bearish";
            opts?.nearMisses?.push({
              anomaly_type: "DIRECTIONAL_FLOW_SKEW",
              ticker,
              reason: "BELOW_THRESHOLD",
              metric_value: Math.round(winningRatio * 100) / 100,
              threshold: SKEW_RATIO_THRESHOLD,
              premium: total,
              direction: dir,
              severity: null,
              detail: `${ticker}: ${winningRatio.toFixed(1)}:1 ${dir === "bullish" ? "call" : "put"}/${dir === "bullish" ? "put" : "call"} skew — below the ${SKEW_RATIO_THRESHOLD}:1 anomaly threshold`,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[market-regime-detector] anomaly scan failed:", err);
  }
  return anomalies;
}
