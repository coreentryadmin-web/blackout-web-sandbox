import type { FlowRow } from "@/lib/db";
import {
  LARGE_PRINT_THRESHOLD,
  LARGE_PRINT_NEAR_MISS_FLOOR,
  SKEW_RATIO_THRESHOLD,
  SKEW_RATIO_NEAR_MISS_FLOOR,
  SKEW_MIN_TOTAL_PREMIUM,
} from "@/app/api/cron/market-regime-detector/flow-anomaly-detection";

// ---------------------------------------------------------------------------
// FLOW-ANOMALY DETECTOR shadow-recompute — task #132, the flows-verifier.ts
// sibling for gex-odte-scope.ts's role in heatmap/desk-verifier: a pure,
// side-effect-free re-derivation of a served computation, kept OUT of the
// verifier file so it is independently unit-testable without any DB/mock setup.
//
// flows-verifier.ts already validates HELIX's TAPE aggregates (premium totals,
// call/put%, recency). It had NO coverage of the separate flow-ANOMALY detector
// (src/app/api/cron/market-regime-detector/flow-anomaly-detection.ts) — the
// threshold math (LARGE_PREMIUM_PRINT $2M / DIRECTIONAL_FLOW_SKEW 10:1), the skew
// ratio computation, and the near-miss band (task #131) could silently regress
// (an off-by-one comparison, a dropped near-miss branch, a ratio computed from
// the wrong side) with nothing to catch it — a bug in detectFlowAnomalies would
// only ever surface as "the FlowAnomalyBanner looks quiet/wrong," not a build or
// test failure.
//
// classifyFlowAnomalies() below is a FROM-SCRATCH re-implementation of
// detectFlowAnomalies' classification loop (own grouping, own accumulation, own
// branch order) — it does NOT import or call detectFlowAnomalies, so a bug
// introduced into that loop cannot also be present here by construction. It DOES
// import the four exported THRESHOLD CONSTANTS from flow-anomaly-detection.ts —
// those are policy numbers ($2M, 10:1, $500k, the 50% near-miss factor), not
// logic, and route.ts / flow-anomaly-near-misses.ts already treat that file as
// the single source of truth for them (route.ts imports LARGE_PRINT_THRESHOLD /
// SKEW_RATIO_THRESHOLD directly for its own DEDUP_SUPPRESSED near-miss path).
// Duplicating the numbers instead of importing them would make a DELIBERATE
// threshold change (e.g. $2M -> $2.5M) look like a bug here until this file was
// separately edited — a maintenance hazard, not an independence gain.
// ---------------------------------------------------------------------------

export type FlowAnomalyType = "LARGE_PREMIUM_PRINT" | "DIRECTIONAL_FLOW_SKEW";
export type FlowAnomalyDirection = "bullish" | "bearish";

/** Minimal per-print shape classifyFlowAnomalies needs — a subset of FlowRow. */
export type FlowPrintInput = Pick<FlowRow, "ticker" | "premium" | "option_type">;

/** One classified item (anomaly OR near-miss) — the common shape diffClassifiedLists compares. */
export type ClassifiedFlowItem = {
  anomaly_type: FlowAnomalyType;
  ticker: string;
  direction: FlowAnomalyDirection;
  metric_value: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Independently recompute the LARGE_PREMIUM_PRINT / DIRECTIONAL_FLOW_SKEW
 * classification (both the real anomalies AND the near-miss band) from raw
 * per-ticker prints. Mirrors detectFlowAnomalies' OWN semantics exactly
 * (including its quirks — e.g. any non-"C..." option_type is treated as a put,
 * there is no third "unknown" bucket here the way flows-verifier's tape
 * aggregate() has one) because the goal is to catch a REGRESSION in that exact
 * behavior, not to define a "better" classification that would just create a
 * second, unrelated disagreement.
 */
export function classifyFlowAnomalies(rows: FlowPrintInput[]): {
  anomalies: ClassifiedFlowItem[];
  nearMisses: ClassifiedFlowItem[];
} {
  const anomalies: ClassifiedFlowItem[] = [];
  const nearMisses: ClassifiedFlowItem[] = [];

  const byTicker = new Map<string, FlowPrintInput[]>();
  for (const r of rows) {
    const t = r.ticker ?? "SPX";
    if (!byTicker.has(t)) byTicker.set(t, []);
    byTicker.get(t)!.push(r);
  }

  for (const [ticker, prints] of byTicker) {
    let callPrem = 0;
    let putPrem = 0;
    let maxSingle = 0;
    let maxSingleIsCall = true;

    for (const p of prints) {
      const prem = p.premium ?? 0;
      const isCall = (p.option_type ?? "").toUpperCase().startsWith("C");
      if (isCall) callPrem += prem;
      else putPrem += prem;
      if (prem > maxSingle) {
        maxSingle = prem;
        maxSingleIsCall = isCall;
      }
    }

    // Large single print > $2M (or the near-miss band below it) — mutually exclusive.
    if (maxSingle >= LARGE_PRINT_THRESHOLD) {
      anomalies.push({
        anomaly_type: "LARGE_PREMIUM_PRINT",
        ticker,
        direction: maxSingleIsCall ? "bullish" : "bearish",
        metric_value: maxSingle,
      });
    } else if (maxSingle >= LARGE_PRINT_NEAR_MISS_FLOOR) {
      nearMisses.push({
        anomaly_type: "LARGE_PREMIUM_PRINT",
        ticker,
        direction: maxSingleIsCall ? "bullish" : "bearish",
        metric_value: maxSingle,
      });
    }

    // Extreme call/put skew (10:1 or 1:10), gated behind the SAME volume floor
    // the real detector requires before it computes a ratio at all.
    const total = callPrem + putPrem;
    if (total >= SKEW_MIN_TOTAL_PREMIUM) {
      const callRatio = putPrem > 0 ? callPrem / putPrem : callPrem > 0 ? 99 : 0;
      const putRatio = callPrem > 0 ? putPrem / callPrem : putPrem > 0 ? 99 : 0;

      if (callRatio >= SKEW_RATIO_THRESHOLD) {
        anomalies.push({ anomaly_type: "DIRECTIONAL_FLOW_SKEW", ticker, direction: "bullish", metric_value: round2(callRatio) });
      } else if (putRatio >= SKEW_RATIO_THRESHOLD) {
        anomalies.push({ anomaly_type: "DIRECTIONAL_FLOW_SKEW", ticker, direction: "bearish", metric_value: round2(putRatio) });
      } else {
        // Only the WINNING side's ratio is a near-miss candidate — mirrors the
        // real detector, which never reports both directions for one ticker/tick.
        const winningRatio = Math.max(callRatio, putRatio);
        if (winningRatio >= SKEW_RATIO_NEAR_MISS_FLOOR) {
          nearMisses.push({
            anomaly_type: "DIRECTIONAL_FLOW_SKEW",
            ticker,
            direction: callRatio >= putRatio ? "bullish" : "bearish",
            metric_value: round2(winningRatio),
          });
        }
      }
    }
  }

  return { anomalies, nearMisses };
}

function keyOf(item: Pick<ClassifiedFlowItem, "anomaly_type" | "ticker" | "direction">): string {
  return `${item.ticker.toUpperCase()}:${item.anomaly_type}:${item.direction}`;
}

/** Diff between an independently-recomputed classification and a served/actual one. */
export type ClassificationDiff = {
  /** The recompute says this should have fired/near-missed, but the actual output has no match. */
  onlyExpected: ClassifiedFlowItem[];
  /** The actual output fired/near-missed something the recompute did not produce. */
  onlyActual: ClassifiedFlowItem[];
  /** Same ticker+type+direction on both sides, but the metric_value disagrees beyond tolerance. */
  valueMismatches: Array<{ key: string; expected: number; actual: number }>;
};

/**
 * Compare an independently-recomputed classification list against the actual
 * detector output for the SAME row set. Keyed by ticker+anomaly_type+direction
 * (not insertion order — Map iteration order is an implementation detail on
 * both sides, not a correctness property). `valueTolerance` covers pure fp
 * noise only; a real classification bug is orders of magnitude larger.
 */
export function diffClassifiedLists(
  expected: ClassifiedFlowItem[],
  actual: ClassifiedFlowItem[],
  valueTolerance = 0.01
): ClassificationDiff {
  const expByKey = new Map(expected.map((e) => [keyOf(e), e]));
  const actByKey = new Map(actual.map((a) => [keyOf(a), a]));

  const onlyExpected: ClassifiedFlowItem[] = [];
  const onlyActual: ClassifiedFlowItem[] = [];
  const valueMismatches: Array<{ key: string; expected: number; actual: number }> = [];

  for (const [key, exp] of expByKey) {
    const act = actByKey.get(key);
    if (!act) {
      onlyExpected.push(exp);
      continue;
    }
    if (Math.abs(exp.metric_value - act.metric_value) > valueTolerance) {
      valueMismatches.push({ key, expected: exp.metric_value, actual: act.metric_value });
    }
  }
  for (const [key, act] of actByKey) {
    if (!expByKey.has(key)) onlyActual.push(act);
  }

  return { onlyExpected, onlyActual, valueMismatches };
}

/** True when a ClassificationDiff carries no disagreement at all. */
export function classificationDiffIsClean(diff: ClassificationDiff): boolean {
  return diff.onlyExpected.length === 0 && diff.onlyActual.length === 0 && diff.valueMismatches.length === 0;
}

/** Render a ClassificationDiff to a one-line human summary for a CheckResult's detail. */
export function describeClassificationDiff(diff: ClassificationDiff): string {
  const parts: string[] = [];
  if (diff.onlyExpected.length) {
    parts.push(
      `${diff.onlyExpected.length} expected but MISSING from the actual output: ${diff.onlyExpected
        .map((e) => `${e.ticker}/${e.anomaly_type}/${e.direction}=${e.metric_value}`)
        .join(", ")}`
    );
  }
  if (diff.onlyActual.length) {
    parts.push(
      `${diff.onlyActual.length} UNEXPECTED in the actual output: ${diff.onlyActual
        .map((a) => `${a.ticker}/${a.anomaly_type}/${a.direction}=${a.metric_value}`)
        .join(", ")}`
    );
  }
  if (diff.valueMismatches.length) {
    parts.push(
      `${diff.valueMismatches.length} value mismatch(es): ${diff.valueMismatches
        .map((m) => `${m.key} expected=${m.expected} actual=${m.actual}`)
        .join(", ")}`
    );
  }
  return parts.join("; ");
}
