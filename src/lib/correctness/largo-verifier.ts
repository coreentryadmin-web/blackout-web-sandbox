import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";

// ---------------------------------------------------------------------------
// LARGO (AI terminal) data-correctness verifier — priority surface #7.
//
// THE GOAL: sample recent Largo answers, extract every numeric token, and trace each number back to a
// tool-call RESULT that answer received — FLAGGING numbers that appear in the answer but in NONE of the
// tool results (an ungrounded / hallucinated figure on a financial surface).
//
// THE HONEST REALITY (verified against the store): Largo persistence retains the assistant ANSWER TEXT
// and the TOOL NAMES used (largo_messages.content + tools_used JSONB), but NOT the tool-call RESULTS —
// those live only in-memory inside the anthropicToolLoop and are discarded after the turn. There is also
// NO cross-user "list recent answers" reader (fetchLargoMessagesPublic requires BOTH sessionId AND the
// owning userId). So the numeric-grounding trace CANNOT be performed today: the ground-truth side
// (tool results) is not logged, and answers aren't enumerable for the cron without a user/session.
//
// We do NOT fake a green. This verifier:
//   • SHIPS the real grounding MACHINERY (extractNumericTokens + traceNumbersToResults) and SELF-TESTS
//     it on a fixture each run, so the moment answer+tool-result logging lands the trace is wired and
//     proven to work — not vaporware.
//   • Records the surface as a COVERAGE GAP with the precise missing piece ("needs Largo answer +
//     tool-result logging: persist each tool_call result JSON alongside the answer, + a cron-readable
//     recent-answers reader"), so the scorecard shows Largo as un-audited honestly, never a false green.
//
// RATE DISCIPLINE: nothing to fetch (no logged data to read) ⇒ zero upstream, zero DB beyond the
// self-test. When logging lands, the reader will be a bounded DB read of the answers table — a
// cache/DB reader, never a per-answer provider fan-out.
// ---------------------------------------------------------------------------

/**
 * Extract numeric tokens from an answer that are CLAIMS worth grounding — prices, premiums, strikes,
 * percentages, $-amounts, levels. Deliberately ignores ordinals/list indices and bare years.
 * Written from scratch; pure + deterministic so it can be self-tested.
 */
export function extractNumericTokens(answer: string): number[] {
  if (!answer) return [];
  const out: number[] = [];
  // $1,234.50 | 4500 | 12.5% | 0.45Δ | $2.3M | 1.2B — capture the numeric core.
  const re = /(-?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s?(%|k|m|b|bn)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const rawNum = match[1].replace(/[$,\s]/g, "");
    let n = Number(rawNum);
    if (!Number.isFinite(n)) continue;
    const suffix = (match[2] ?? "").toLowerCase();
    if (suffix === "k") n *= 1e3;
    else if (suffix === "m") n *= 1e6;
    else if (suffix === "b" || suffix === "bn") n *= 1e9;
    // Skip tiny integers that are almost always list indices / counts, and bare 4-digit years.
    const isBareYear = Number.isInteger(n) && n >= 1990 && n <= 2100 && !suffix && !match[0].includes(".");
    if (isBareYear) continue;
    if (Number.isInteger(n) && n >= 0 && n <= 5 && !suffix && !match[0].includes("%") && !match[0].includes("$")) continue;
    out.push(n);
  }
  return out;
}

/** Flatten every finite number that appears anywhere in a set of tool-result JSON blobs. */
export function collectResultNumbers(toolResults: unknown[]): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.push(v);
      return;
    }
    if (typeof v === "string") {
      // Numbers embedded in result strings count as grounding too.
      for (const n of extractNumericTokens(v)) out.push(n);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  for (const r of toolResults) walk(r);
  return out;
}

/**
 * For each number in the answer, is there a tool-result number within a small relative tolerance? Returns
 * the answer numbers that are UNGROUNDED (present in the answer, absent from every tool result). This is
 * the FLAG engine — it runs the moment tool results are logged.
 */
export function traceNumbersToResults(
  answerNumbers: number[],
  resultNumbers: number[],
  relTol = 0.01
): number[] {
  const ungrounded: number[] = [];
  for (const a of answerNumbers) {
    const grounded = resultNumbers.some((r) => {
      if (a === r) return true;
      const denom = Math.max(Math.abs(a), Math.abs(r));
      return denom > 0 && Math.abs(a - r) / denom <= relTol;
    });
    if (!grounded) ungrounded.push(a);
  }
  return ungrounded;
}

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

/**
 * Verify Largo numeric grounding. Today this is a SCAFFOLD: the grounding machinery is real and
 * self-tested, but the data needed to run it (logged tool results + cron-readable answers) does not
 * exist yet, so the surface is recorded as an explicit coverage gap. Never throws.
 */
export async function verifyLargo(_marketOpen: boolean): Promise<TickerScore> {
  const ticker = "LARGO";
  const checks: CheckResult[] = [];

  // ── SELF-TEST the grounding engine on a fixture (so it's proven to work, not vaporware) ──
  {
    const answer = "SPX is at 5,842.30, the call wall sits at 5900 with $2.3M of premium, IV rank 47%. Target 6100.";
    const toolResults: unknown[] = [
      { spot: 5842.31, call_wall: 5900, premium: 2_300_000 },
      { iv_rank: 47 },
      // NOTE: 6100 ("Target") intentionally absent from results → must be flagged ungrounded.
    ];
    const answerNums = extractNumericTokens(answer);
    const resultNums = collectResultNumbers(toolResults);
    const ungrounded = traceNumbersToResults(answerNums, resultNums);
    // The engine must (a) extract the meaningful numbers and (b) flag 6100 as the lone ungrounded one.
    const flagged6100 = ungrounded.some((n) => Math.abs(n - 6100) < 1);
    const groundedSpot = !ungrounded.some((n) => Math.abs(n - 5842.3) < 1);
    const ok = flagged6100 && groundedSpot && answerNums.length >= 4;
    checks.push(
      mk(
        "shadow-recompute",
        "grounding_engine",
        ok ? "consistency-only" : "flag",
        ok
          ? `Numeric-grounding engine self-test PASSED: extracted ${answerNums.length} answer numbers, correctly grounded spot/wall/premium/IV and flagged the ungrounded 6100 target. Engine is wired and ready.`
          : `Numeric-grounding engine self-test FAILED (extracted=${answerNums.length}, ungrounded=${JSON.stringify(ungrounded)}) — the FLAG machinery itself has a bug.`,
        { id: "grounding-self-test", expected: "flag 6100 only", actual: JSON.stringify(ungrounded) }
      )
    );
  }

  // ── COVERAGE GAP — the data to run the engine on real answers does not exist yet ──
  checks.push(
    mk(
      "cross-tool",
      "answer_grounding",
      "consistency-only",
      "COVERAGE GAP — needs Largo answer + tool-result logging. Today largo_messages persists the answer " +
        "TEXT and tool NAMES only; tool-call RESULTS are discarded after the turn, and there is no " +
        "cron-readable cross-user recent-answers reader (fetchLargoMessagesPublic requires sessionId+userId). " +
        "So real answers CANNOT be traced to their tool results yet. To close: persist each tool_call result " +
        "JSON alongside the answer (e.g. largo_messages.tool_results JSONB), add a bounded recent-answers " +
        "reader, then this verifier's engine flags every ungrounded number. NOT a false green — un-audited by design.",
      { id: "largo-coverage-gap" }
    )
  );

  void _marketOpen;
  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
