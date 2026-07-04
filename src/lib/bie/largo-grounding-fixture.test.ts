import assert from "node:assert/strict";
import test from "node:test";
import { auditLargoAnswerGrounding } from "./verifier";

test("auditLargoAnswerGrounding: self-test fixture flags invented targets below coverage threshold", () => {
  const answer =
    "SPX is at 5,842.30, the call wall sits at 5900 with $2.3M of premium, IV rank 47%. Targets 6100, 6200, 6300.";
  const toolResults: unknown[] = [
    { spot: 5842.31, call_wall: 5900, premium: 2_300_000 },
    { iv_rank: 47 },
  ];
  const { verification, shouldFlag } = auditLargoAnswerGrounding(answer, toolResults);
  assert.ok(verification.unverified.some((n) => Math.abs(n - 6100) < 1));
  assert.equal(shouldFlag, true);
});

test("auditLargoAnswerGrounding: skips answers that already carry the runtime caution footer", () => {
  const answer =
    "SPX at 9999 with fake levels.\n\n_BIE verification: 5 of 6 figures in this answer could not be traced to data pulled this turn — treat those specific numbers with caution._";
  const { shouldFlag } = auditLargoAnswerGrounding(answer, [{ spot: 5900 }]);
  assert.equal(shouldFlag, false);
});

test("auditLargoAnswerGrounding: does not false-flag list markers like '- 8 alerts'", () => {
  const answer = "Flow tape:\n- 8 alerts · $272K total · 181 fills";
  const toolResults = [{ alerts: 8, premium: 272_000, fills: 181 }];
  const { shouldFlag } = auditLargoAnswerGrounding(answer, toolResults);
  assert.equal(shouldFlag, false);
});

test("auditLargoAnswerGrounding: does not parse '$80 max pain' as $80M", () => {
  const answer = "Near-the-money: $80 max pain is the magnet.";
  const toolResults = [{ max_pain: 80 }];
  const { shouldFlag } = auditLargoAnswerGrounding(answer, toolResults);
  assert.equal(shouldFlag, false);
});
