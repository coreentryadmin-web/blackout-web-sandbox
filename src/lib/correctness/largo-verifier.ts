import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { auditLargoAnswerGrounding } from "@/lib/bie/verifier";
import { fetchRecentLargoAnswersWithResults } from "@/lib/largo/largo-store";

// ---------------------------------------------------------------------------
// LARGO (AI terminal) data-correctness verifier — priority surface #7.
//
// THE GOAL: sample recent Largo answers and confirm numeric claims trace to that turn's tool-call
// results — FLAGGING answers where coverage drops below the same threshold largo-terminal.ts uses
// before appending the runtime caution footer, and the footer was NOT appended (undisclosed).
//
// Uses the shared bie/verifier.ts engine (extractNumericClaims + verifyClaims) — the SAME logic
// largo-terminal.ts runs in Layer 4 — NOT a parallel regex. The prior bespoke extractNumericTokens
// regex false-flagged prod answers (e.g. "- 8 alerts" → -8, "$80 max pain" → $80M via a trailing
// "m" in "max", partial decimals) and caused data-correctness cron failures.
//
// RATE DISCIPLINE: one bounded DB read (LIMIT-capped) of already-logged rows — zero upstream provider
// calls, zero per-answer fan-out.
// ---------------------------------------------------------------------------

/** How many recent logged answers to sample per verifier run. */
const LARGO_ANSWER_SAMPLE_SIZE = 50;

function mk(
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `LARGO:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
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

/** Verify Largo numeric grounding against persisted tool_results. Never throws. */
export async function verifyLargo(_marketOpen: boolean): Promise<TickerScore> {
  const ticker = "LARGO";
  const checks: CheckResult[] = [];

  // ── SELF-TEST the grounding engine on a fixture (proves FLAG logic before trusting prod data) ──
  {
    const answer =
      "SPX is at 5,842.30, the call wall sits at 5900 with $2.3M of premium, IV rank 47%. Targets 6100, 6200, 6300.";
    const toolResults: unknown[] = [
      { spot: 5842.31, call_wall: 5900, premium: 2_300_000 },
      { iv_rank: 47 },
    ];
    const { verification, shouldFlag } = auditLargoAnswerGrounding(answer, toolResults);
    const flagged6100 = verification.unverified.some((n) => Math.abs(n - 6100) < 1);
    const ok = shouldFlag && flagged6100 && verification.total >= 4;
    checks.push(
      mk(
        "shadow-recompute",
        "grounding_engine",
        ok ? "consistency-only" : "flag",
        ok
          ? `Numeric-grounding engine self-test PASSED: ${verification.verified}/${verification.total} claims grounded; correctly flags undisclosed low coverage when 6100 target is invented.`
          : `Numeric-grounding engine self-test FAILED (coverage=${verification.coverage}, shouldFlag=${shouldFlag}, unverified=${JSON.stringify(verification.unverified)}) — the FLAG machinery itself has a bug.`,
        { id: "grounding-self-test", expected: "flag undisclosed 6100", actual: String(shouldFlag) }
      )
    );
  }

  // ── REAL-DATA CHECK — same engine + thresholds as largo-terminal Layer 4 ──
  let answers: Awaited<ReturnType<typeof fetchRecentLargoAnswersWithResults>> = [];
  try {
    answers = await fetchRecentLargoAnswersWithResults(LARGO_ANSWER_SAMPLE_SIZE);
  } catch (err) {
    checks.push(
      mk(
        "cross-tool",
        "answer_grounding",
        "skipped",
        `Could not read recent Largo answers: ${err instanceof Error ? err.message : String(err)}.`,
        { id: "largo-answers-read-failed" }
      )
    );
  }

  if (answers.length === 0) {
    checks.push(
      mk(
        "cross-tool",
        "answer_grounding",
        "consistency-only",
        "No recent Largo answers with logged tool_results yet. Tool-result persistence (largo_messages." +
          "tool_results, populated by largo-terminal.ts on every assistant turn) landed this audit — the " +
          "engine will start flagging real answers as traffic accumulates against the new column. Not a " +
          "false green: un-audited by data availability right now, not by design.",
        { id: "largo-no-data-yet" }
      )
    );
  } else {
    const flagged: { id: number; coverage: number; unverified: number[] }[] = [];
    for (const a of answers) {
      const { verification, shouldFlag } = auditLargoAnswerGrounding(a.content, a.tool_results);
      if (shouldFlag) {
        flagged.push({ id: a.id, coverage: verification.coverage, unverified: verification.unverified });
      }
    }

    if (flagged.length > 0) {
      const examples = flagged
        .slice(0, 3)
        .map(
          (f) =>
            `#${f.id}: coverage ${Math.round(f.coverage * 100)}%, unverified sample ${f.unverified.slice(0, 3).join(", ")}`
        )
        .join("; ");
      checks.push(
        mk(
          "shadow-recompute",
          "answer_grounding",
          "flag",
          `${flagged.length}/${answers.length} recent Largo answers had undisclosed low numeric grounding ` +
            `(coverage < 50% with 4+ claims, no runtime caution footer). Examples: ${examples}.`,
          { id: "largo-ungrounded-answers", expected: "0 undisclosed low-coverage", actual: String(flagged.length) }
        )
      );
    } else {
      checks.push(
        mk(
          "shadow-recompute",
          "answer_grounding",
          "pass",
          `${answers.length} recent Largo answers checked — none had undisclosed low numeric grounding ` +
            `against their persisted tool-call results.`,
          { id: "largo-answers-grounded" }
        )
      );
    }
  }

  void _marketOpen;
  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
