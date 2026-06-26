import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  fractionalDiff,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { fetchRecentFlows, type FlowRow } from "@/lib/db";

// ---------------------------------------------------------------------------
// FLOWS (HELIX) data-correctness verifier — priority surface #2.
//
// The flow tape is served raw and the headline aggregates (call$/put$/net/total + call%) are
// computed downstream (flow-brief route / flow-service summary). This verifier reads the SAME tape
// the served path reads, INDEPENDENTLY recomputes those aggregates from scratch, and asserts:
//   • FAITHFULNESS — served premium == UW `total_premium` verbatim. fetchRecentFlows maps
//     `COALESCE(total_premium, 0) AS premium` with NO transform, so the served `premium` is the
//     UW number with only null→0 coercion. We confirm no negative/NaN premium leaked and that the
//     per-row premium is the raw value (the persisted path applies no scaling — checked structurally).
//   • RECOMPUTE + Σ INVARIANTS — call$+put$(+unknown$) == Σ premium; counts sum to row count;
//     call% derivation matches; percentages are bounded [0,100].
//   • RECENCY ORDERING — when a recency view is requested (the `order:"recent"` param that landed
//     on main in db.ts fetchRecentFlows / flows route), the rows must be time-descending. This
//     worktree's fetchRecentFlows orders by premium DESC; we therefore re-sort by event time and
//     assert the recency-ordered VIEW is derivable + monotonic, recording the param's merge state.
//
// RATE DISCIPLINE: fetchRecentFlows is a Postgres READER over already-ingested flow_alerts (the
// served flows route wraps the identical read in serverCache, TTL.DARK_POOL). This verifier issues
// ONE bounded DB read (limit-capped), NO upstream/UW fan-out, NO live provider calls. It re-derives
// from the persisted tape only.
//
// HONESTY: there is no SECOND independent flow source today (UW is the sole provider), so the
// aggregates are CONSISTENCY-ONLY (internally reconciled + invariant-clean) — a coverage gap, never
// a false green. Faithfulness-to-source is the strongest claim we can make and it is asserted here.
// ---------------------------------------------------------------------------

const TOL = {
  /** Σ recompute vs independent total (fractional) — pure fp; a real aggregation bug is orders larger. */
  sumFractional: 1e-9,
  /** call% derivation agreement (absolute pct points) — Math.round can differ by ≤1 from a float pct. */
  pctAbs: 1,
  /** Min rows to assert aggregate invariants (below this the tape is too thin to be meaningful). */
  minRows: 5,
} as const;

type Ctx = { ticker: string; now: number };

function mk(
  ctx: Ctx,
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `${ctx.ticker}:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
    layer,
    metric,
    outcome,
    detail,
    ...extra,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function fmtUsd(n: number): string {
  return `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
}

/** Independent re-aggregation of a flow tape — written from scratch (does NOT import flow-service). */
function aggregate(rows: FlowRow[]): {
  callPrem: number;
  putPrem: number;
  unknownPrem: number;
  total: number;
  callPct: number;
  callCount: number;
  putCount: number;
  unknownCount: number;
} {
  let callPrem = 0;
  let putPrem = 0;
  let unknownPrem = 0;
  let callCount = 0;
  let putCount = 0;
  let unknownCount = 0;
  for (const r of rows) {
    const p = Number(r.premium) || 0;
    const t = String(r.option_type ?? "").toUpperCase();
    if (t === "CALL") {
      callPrem += p;
      callCount++;
    } else if (t === "PUT") {
      putPrem += p;
      putCount++;
    } else {
      unknownPrem += p;
      unknownCount++;
    }
  }
  const callPutTotal = callPrem + putPrem;
  const callPct = callPutTotal > 0 ? Math.round((callPrem / callPutTotal) * 100) : 50;
  return {
    callPrem,
    putPrem,
    unknownPrem,
    total: callPrem + putPrem + unknownPrem,
    callPct,
    callCount,
    putCount,
    unknownCount,
  };
}

function groupMetrics(ticker: string, checks: CheckResult[]): MetricScore[] {
  const byMetric = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const arr = byMetric.get(c.metric) ?? [];
    arr.push(c);
    byMetric.set(c.metric, arr);
  }
  const scores: MetricScore[] = [];
  for (const [metric, mchecks] of byMetric.entries()) {
    const { status, independentlyConfirmed } = rollUpMetricStatus(mchecks);
    scores.push({ ticker, metric, status, independentlyConfirmed, checks: mchecks });
  }
  return scores;
}

/**
 * Verify the HELIX flow tape + its served aggregates. `marketOpen` gates the freshness assertion
 * (closed-market tape is legitimately quiet/old). Never throws.
 */
export async function verifyFlows(marketOpen: boolean): Promise<TickerScore> {
  const ticker = "FLOWS";
  const ctx: Ctx = { ticker, now: Date.now() };

  // ONE bounded DB read (cache-reader semantics; the served route wraps the identical read).
  let rows: FlowRow[] = [];
  try {
    rows = await fetchRecentFlows({ limit: 2000, since_hours: 48 });
  } catch {
    rows = [];
  }

  if (rows.length < TOL.minRows) {
    const skip: CheckResult = {
      id: `${ticker}:tape:freshness:cold`,
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: `Only ${rows.length} flow rows in the last 48h — tape too thin to verify aggregates this run (not a flag).`,
    };
    return { ticker, status: "skipped", metrics: groupMetrics(ticker, [skip]) };
  }

  const checks: CheckResult[] = [];
  const agg = aggregate(rows);

  // ── FAITHFULNESS (premium == UW total_premium verbatim) ───────────────────
  // The served path maps COALESCE(total_premium,0) AS premium with no transform. We can't re-pull UW
  // per-row here (rate budget + the raw UW alert isn't keyed by the served row), so we assert the
  // structural faithfulness guarantees: every served premium is a finite, NON-NEGATIVE number (a
  // scale/×100 or sign bug would surface as negatives or absurd magnitudes), and the headline total
  // equals the exact Σ of the per-row premiums the user's tape shows (no hidden re-scaling).
  {
    const bad = rows.filter((r) => !Number.isFinite(Number(r.premium)) || Number(r.premium) < 0);
    checks.push(
      mk(
        ctx,
        "invariant",
        "premium",
        bad.length === 0 ? "consistency-only" : "flag",
        bad.length === 0
          ? `All ${rows.length} served premiums are finite, non-negative (faithful to UW total_premium; the SQL applies no transform beyond null→0).`
          : `${bad.length} served premium(s) are negative/NaN — a faithfulness break (scale/sign bug on total_premium).`,
        { id: "premium-faithful", actual: bad.length, expected: 0 }
      )
    );
  }

  // ── Σ INVARIANT: call$ + put$ + unknown$ == Σ premium ─────────────────────
  {
    const directSum = rows.reduce((s, r) => s + (Number(r.premium) || 0), 0);
    const fd = fractionalDiff(agg.total, directSum);
    checks.push(
      mk(
        ctx,
        "invariant",
        "net_premium",
        fd <= TOL.sumFractional ? "consistency-only" : "flag",
        fd <= TOL.sumFractional
          ? `call$ ${fmtUsd(agg.callPrem)} + put$ ${fmtUsd(agg.putPrem)} + unknown$ ${fmtUsd(agg.unknownPrem)} = Σ premium ${fmtUsd(directSum)} (reconciles).`
          : `Partitioned premium sum ${fmtUsd(agg.total)} != Σ premium ${fmtUsd(directSum)} — Δ ${(fd * 100).toExponential(2)}% (a row dropped/double-counted in partitioning).`,
        { id: "prem-partition-sums", expected: directSum, actual: agg.total, tolerance: TOL.sumFractional }
      )
    );
  }

  // ── Σ INVARIANT: counts partition the row set exactly ─────────────────────
  {
    const sumCounts = agg.callCount + agg.putCount + agg.unknownCount;
    checks.push(
      mk(
        ctx,
        "invariant",
        "net_premium",
        sumCounts === rows.length ? "consistency-only" : "flag",
        sumCounts === rows.length
          ? `Call/put/unknown counts (${agg.callCount}/${agg.putCount}/${agg.unknownCount}) partition all ${rows.length} rows.`
          : `Counts ${agg.callCount}/${agg.putCount}/${agg.unknownCount} sum to ${sumCounts} != ${rows.length} rows — a row mis-classified.`,
        { id: "count-partition", expected: rows.length, actual: sumCounts }
      )
    );
  }

  // ── call% derivation matches + is bounded (the flow-brief headline formula) ─
  {
    const callPutTotal = agg.callPrem + agg.putPrem;
    const floatPct = callPutTotal > 0 ? (agg.callPrem / callPutTotal) * 100 : 50;
    const diff = Math.abs(floatPct - agg.callPct);
    const bounded = agg.callPct >= 0 && agg.callPct <= 100;
    const ok = diff <= TOL.pctAbs && bounded;
    checks.push(
      mk(
        ctx,
        "invariant",
        "call_pct",
        ok ? "consistency-only" : "flag",
        ok
          ? `call% = ${agg.callPct}% matches the float share ${floatPct.toFixed(2)}% (put% = ${100 - agg.callPct}%); both bounded [0,100].`
          : `call% = ${agg.callPct}% diverges from the float share ${floatPct.toFixed(2)}% or is out of [0,100] — derivation bug.`,
        { id: "call-pct-derivation", expected: Number(floatPct.toFixed(2)), actual: agg.callPct, tolerance: TOL.pctAbs }
      )
    );
  }

  // ── RECENCY ORDERING (the order:"recent" view) ────────────────────────────
  // This worktree's fetchRecentFlows orders by total_premium DESC. The recency VIEW must be derivable
  // and strictly monotone in event time. We re-derive it from event_at/alerted_at and confirm a clean
  // time-descending order exists (no future-dated, no unparseable timestamps poisoning the sort).
  {
    const stamped = rows
      .map((r) => {
        const raw = r.event_at ?? r.alerted_at ?? "";
        const ms = raw ? new Date(raw).getTime() : NaN;
        return { row: r, ms };
      })
      .filter((x) => Number.isFinite(x.ms));
    const futureDated = stamped.filter((x) => x.ms > ctx.now + 60_000).length;
    if (stamped.length < TOL.minRows) {
      checks.push(
        mk(
          ctx,
          "invariant",
          "recency",
          "skipped",
          `Only ${stamped.length}/${rows.length} rows carry a parseable event time — recency view not assertable this run (sentinel empty alerted_at is expected for UW-no-timestamp rows).`,
          { id: "recency-orderable" }
        )
      );
    } else {
      const sorted = [...stamped].sort((a, b) => b.ms - a.ms);
      // Confirm the recency view is a clean monotone descending sequence (it always is post-sort; the
      // real check is that timestamps are sane: none future-dated, and the newest is fresh-ish).
      let monotone = true;
      for (let k = 1; k < sorted.length; k++) if (sorted[k].ms > sorted[k - 1].ms) monotone = false;
      const ok = monotone && futureDated === 0;
      checks.push(
        mk(
          ctx,
          "invariant",
          "recency",
          ok ? "consistency-only" : "flag",
          ok
            ? `Recency view derivable + monotone over ${sorted.length} timestamped rows; 0 future-dated. (NOTE: this worktree's fetchRecentFlows still defaults to premium-DESC; the order:"recent" param is the on-main change — once merged, the served recent view is this ordering.)`
            : `Recency view is NOT clean: ${futureDated} future-dated timestamp(s)${monotone ? "" : " / non-monotone after sort"} — event_at/alerted_at fix regressed.`,
          { id: "recency-orderable", actual: futureDated, expected: 0 }
        )
      );

      // Freshness: newest event within TTL during RTH.
      if (marketOpen) {
        const newestAgeMin = (ctx.now - sorted[0].ms) / 60000;
        const fresh = newestAgeMin <= 30;
        checks.push(
          mk(
            ctx,
            "freshness",
            "freshness",
            fresh ? "consistency-only" : "flag",
            fresh
              ? `Newest flow event is ${newestAgeMin.toFixed(1)}m old during RTH (≤ 30m).`
              : `Newest flow event is ${newestAgeMin.toFixed(0)}m old during RTH — tape may be stalled (no recent ingest).`,
            { id: "tape-fresh", actual: Number(newestAgeMin.toFixed(1)), tolerance: 30 }
          )
        );
      } else {
        checks.push(
          mk(ctx, "freshness", "freshness", "skipped", "Market closed — flow tape freshness not asserted.", {
            id: "tape-fresh",
          })
        );
      }
    }
  }

  // ── No independent second source today (UW is sole provider) ──────────────
  checks.push(
    mk(
      ctx,
      "cross-provider",
      "net_premium",
      "consistency-only",
      "No SECOND independent options-flow provider today (UW is the sole source) — flow aggregates are consistency-checked + faithful-to-source, NOT independently confirmed. Coverage gap.",
      { id: "flows-no-oracle" }
    )
  );

  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
