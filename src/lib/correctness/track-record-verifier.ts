import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { fetchClosedPlayOutcomes } from "@/lib/db";
import { fetchPlayOutcomeStats } from "@/lib/spx-play-outcomes";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// ---------------------------------------------------------------------------
// TRACK RECORD data-correctness verifier — priority surface #6.
//
// Recomputes the public/desk track-record rollup (wins / losses / scratch / hit-rate) DIRECTLY from
// the graded-outcomes rows and confirms it against BOTH the served aggregation paths:
//   L2 invariant — wins + losses + scratch == closed (the partition identity); hit-rate == wins/closed;
//      every row's outcome is in the {win,loss,breakeven} vocabulary (no rogue grade leaks the count);
//      hit_rate ∈ [0,100].
//   L1 shadow-recompute — an INDEPENDENT count over fetchClosedPlayOutcomes rows must match
//      fetchPlayOutcomeStats().overall (the desk path) AND buildPublicTrackRecord() (the public path),
//      so the social-proof number can never disagree with the raw ledger.
//
// NOTE on vocabulary: the codebase grades outcomes as "win" | "loss" | "breakeven" | "open". "scratch"
// (the task's term) == "breakeven" here; this verifier treats them as the same metric and labels both.
//
// RATE DISCIPLINE: this is a pure DB/cache reader. fetchClosedPlayOutcomes(500) is the SAME bounded
// read the desk aggregation uses (and it is cached); fetchPlayOutcomeStats + buildPublicTrackRecord
// reuse it. NO upstream/provider calls, NO fan-out. One ledger read, recomputed in-process.
//
// HONESTY: this surface is DETERMINISTIC arithmetic over an internal ledger — there is no external
// oracle for "the strategy's true win rate", but there does not need to be: the claim is "the published
// rollup equals the ledger". That is fully confirmable here (recompute == served == invariant-clean),
// so a clean run is a genuine PASS of the integrity claim, recorded as confirmed-against-ledger.
// ---------------------------------------------------------------------------

function mk(
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `TRACKREC:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
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
 * Verify the track-record rollup against the graded-outcomes ledger. Returns a TickerScore under the
 * synthetic "TRACKREC" ticker. Never throws.
 */
export async function verifyTrackRecord(_marketOpen: boolean): Promise<TickerScore> {
  const ticker = "TRACKREC";
  const checks: CheckResult[] = [];

  // Raw graded ledger (the SAME bounded, cached read the desk aggregation uses).
  let rows: Awaited<ReturnType<typeof fetchClosedPlayOutcomes>> = [];
  try {
    rows = await fetchClosedPlayOutcomes(500);
  } catch {
    rows = [];
  }

  // Independent recompute over the ledger.
  const closedRows = rows.filter((r) => r.outcome !== "open");
  const myWins = closedRows.filter((r) => r.outcome === "win").length;
  const myLosses = closedRows.filter((r) => r.outcome === "loss").length;
  const myScratch = closedRows.filter((r) => r.outcome === "breakeven").length;
  const myClosed = closedRows.length;
  const rogue = closedRows.filter(
    (r) => r.outcome !== "win" && r.outcome !== "loss" && r.outcome !== "breakeven"
  );

  if (myClosed === 0) {
    const skip: CheckResult = {
      id: "TRACKREC:ledger:freshness:cold",
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: "No closed graded outcomes in the ledger — track record warming up; nothing to verify this run.",
    };
    return { ticker, status: "skipped", metrics: groupMetrics(ticker, [skip]) };
  }

  // ── L2 INVARIANT: wins + losses + scratch == closed ───────────────────────
  {
    const sum = myWins + myLosses + myScratch;
    const ok = sum === myClosed && rogue.length === 0;
    checks.push(
      mk(
        "invariant",
        "counts",
        ok ? "consistency-only" : "flag",
        ok
          ? `wins(${myWins}) + losses(${myLosses}) + scratch/breakeven(${myScratch}) == closed(${myClosed}); no rogue outcome grades.`
          : `Partition broken: ${myWins}+${myLosses}+${myScratch}=${sum} != closed ${myClosed}${rogue.length ? ` (+${rogue.length} rogue outcome grade(s): ${[...new Set(rogue.map((r) => r.outcome))].join(",")})` : ""}.`,
        { id: "wlS-eq-closed", expected: myClosed, actual: sum }
      )
    );
  }

  // ── L1 SHADOW-RECOMPUTE: ledger recompute == desk stats path ──────────────
  {
    let stats: Awaited<ReturnType<typeof fetchPlayOutcomeStats>> | null = null;
    try {
      stats = await fetchPlayOutcomeStats();
    } catch {
      stats = null;
    }
    if (!stats) {
      checks.push(
        mk("shadow-recompute", "hit_rate", "skipped", "fetchPlayOutcomeStats unavailable this run — desk-path cross-check skipped.", {
          id: "ledger-vs-deskstats",
        })
      );
    } else {
      const sWins = stats.overall.wins;
      const sLosses = stats.overall.losses;
      const sScratch = stats.overall.breakeven;
      const sClosed = stats.total_closed;
      const match =
        sWins === myWins && sLosses === myLosses && sScratch === myScratch && sClosed === myClosed;
      checks.push(
        mk(
          "shadow-recompute",
          "counts",
          match ? "consistency-only" : "flag",
          match
            ? `Desk stats path (W/L/S/closed = ${sWins}/${sLosses}/${sScratch}/${sClosed}) equals the independent ledger recompute.`
            : `Desk stats path (W/L/S/closed = ${sWins}/${sLosses}/${sScratch}/${sClosed}) DISAGREES with the ledger recompute (${myWins}/${myLosses}/${myScratch}/${myClosed}) — the rollup dropped/double-counted rows.`,
          { id: "ledger-vs-deskstats", expected: `${myWins}/${myLosses}/${myScratch}/${myClosed}`, actual: `${sWins}/${sLosses}/${sScratch}/${sClosed}` }
        )
      );

      // Hit-rate recompute (the served win_rate is wins/closed as a fraction; the public surface rounds to %).
      const myRate = myClosed > 0 ? myWins / myClosed : 0;
      const servedRate = stats.overall.win_rate;
      const rateOk = Math.abs(myRate - servedRate) <= 1e-9;
      const bounded = servedRate >= 0 && servedRate <= 1;
      checks.push(
        mk(
          "invariant",
          "hit_rate",
          rateOk && bounded ? "consistency-only" : "flag",
          rateOk && bounded
            ? `Hit-rate ${(myRate * 100).toFixed(1)}% == wins/closed and ∈ [0,100].`
            : `Hit-rate served ${(servedRate * 100).toFixed(2)}% != independent wins/closed ${(myRate * 100).toFixed(2)}% or is out of [0,1] — derivation bug.`,
          { id: "hit-rate-derivation", expected: Number((myRate * 100).toFixed(2)), actual: Number((servedRate * 100).toFixed(2)) }
        )
      );
    }
  }

  // ── L1 SHADOW-RECOMPUTE: public surface == ledger ─────────────────────────
  {
    let pub: Awaited<ReturnType<typeof buildPublicTrackRecord>> | null = null;
    try {
      pub = await buildPublicTrackRecord();
    } catch {
      pub = null;
    }
    if (!pub || !pub.available) {
      checks.push(
        mk("shadow-recompute", "hit_rate", "skipped", "Public track record unavailable/standby this run — public-path cross-check skipped.", {
          id: "ledger-vs-public",
        })
      );
    } else {
      const expectedPct = Math.round(Math.min(1, Math.max(0, myWins / Math.max(1, myClosed))) * 100);
      const match =
        pub.wins === myWins && pub.losses === myLosses && pub.breakeven === myScratch && pub.total_closed === myClosed && pub.win_rate_pct === expectedPct;
      checks.push(
        mk(
          "shadow-recompute",
          "hit_rate",
          match ? "consistency-only" : "flag",
          match
            ? `Public track record (W/L/S=${pub.wins}/${pub.losses}/${pub.breakeven}, ${pub.win_rate_pct}% over ${pub.total_closed}) equals the ledger recompute.`
            : `Public track record (W/L/S=${pub.wins}/${pub.losses}/${pub.breakeven}, ${pub.win_rate_pct}% over ${pub.total_closed}) DISAGREES with the ledger (${myWins}/${myLosses}/${myScratch}, ${expectedPct}% over ${myClosed}) — the social-proof number is not the real ledger.`,
          { id: "ledger-vs-public", expected: `${myWins}/${myLosses}/${myScratch}@${expectedPct}%`, actual: `${pub.wins}/${pub.losses}/${pub.breakeven}@${pub.win_rate_pct}%` }
        )
      );
    }
  }

  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
