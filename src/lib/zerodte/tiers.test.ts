// Pure table tests for the merit-tier engine core (PR-F). assignZeroDteTier is
// deterministic over its input struct — no providers, no clock, no DB — so every
// boundary (A/B/C points bands, missing-evidence caps, the veto cap, the ET-stamp
// parse) is pinned exactly, in both directions.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assignZeroDteTier,
  displayTierFor,
  tierForSkip,
  tierFromEntryContext,
  TIER_A_MIN_POINTS,
  TIER_B_MIN_POINTS,
  TIER_APLUS_UNLOCK,
  W_SCORE_MID,
  W_SCORE_TOP,
  W_SCORE_PRIME,
  type ZeroDteTierInput,
  type ZeroDteTier,
} from "./tiers";

/** A fully-evidenced input that lands EXACTLY at the A boundary (4 points):
 *  prime score band (+2) + calm VIX (+2), Cortex present but exactly neutral
 *  (0 points — a wash never argues either way), midday commit (no F-4 penalty). */
function boundaryA(overrides: Partial<ZeroDteTierInput> = {}): ZeroDteTierInput {
  return {
    score: 78,
    scoreFloor: 65,
    cortexScore: 0,
    cortexVetoCount: 0,
    cortexSupportCount: 0,
    vixOpen: 16,
    committedEtMinutes: 12 * 60, // 12:00 ET — outside the F-4 early window
    ...overrides,
  };
}

test("tier boundaries, both directions: exactly TIER_A_MIN_POINTS is A, one point under is B", () => {
  assert.equal(TIER_A_MIN_POINTS, 4);
  const at = assignZeroDteTier(boundaryA());
  assert.equal(at.tier, "A");
  // Same input with the score dropped to the mid band (+1 instead of +2) = 3 points → B.
  const under = assignZeroDteTier(boundaryA({ score: 70 }));
  assert.equal(under.tier, "B");
});

test("tier boundaries, both directions: exactly TIER_B_MIN_POINTS is B, one point under is C", () => {
  assert.equal(TIER_B_MIN_POINTS, 1);
  // Below-floor score (−2) + calm VIX (+2) + thin-positive Cortex (+1) = 1 point → B.
  const at = assignZeroDteTier(
    boundaryA({ score: 60, cortexScore: 1.2, cortexSupportCount: 1 })
  );
  assert.equal(at.tier, "B");
  // Neutralize the Cortex point (wash) = −2 + 2 + 0 = 0 points → C.
  const under = assignZeroDteTier(boundaryA({ score: 60 }));
  assert.equal(under.tier, "C");
});

test("A+ is never assignable at entry time — only displayTierFor can promote, and only when unlocked", () => {
  // The strongest constructible input: prime score, calm VIX, clean multi-source
  // Cortex, midday. Still "A" — the type itself has no "A+" to give.
  const maxed = assignZeroDteTier(
    boundaryA({ cortexScore: 3.5, cortexSupportCount: 4 })
  );
  assert.equal(maxed.tier, "A");
  const assignable: ZeroDteTier[] = ["A", "B", "C"]; // compile-time: "A+" would not typecheck
  assert.ok(assignable.includes(maxed.tier));

  // The unlock bar is the record's to clear, and display promotion is gated on it.
  assert.deepEqual(TIER_APLUS_UNLOCK, { minGraded: 10, minWinRatePct: 80 });
  assert.equal(displayTierFor("A", true), "A+");
  assert.equal(displayTierFor("A", false), "A");
  assert.equal(displayTierFor("B", true), "B"); // unlock never promotes non-A plays
});

test("top-band inversion is priced: a raw 85+ score earns LESS than the 75-84 band", () => {
  assert.equal(W_SCORE_TOP, W_SCORE_MID);
  assert.ok(W_SCORE_TOP < W_SCORE_PRIME);
  // Identical evidence except the score: 92 lands B (mid-band credit only), 78 lands A.
  const raw92 = assignZeroDteTier(boundaryA({ score: 92 }));
  const prime78 = assignZeroDteTier(boundaryA({ score: 78 }));
  assert.equal(raw92.tier, "B");
  assert.equal(prime78.tier, "A");
  const discounted = raw92.factors.find((f) => f.label === "Score 85+ (discounted)");
  assert.ok(discounted);
  assert.equal(discounted.direction, "up");
  assert.match(discounted.detail, /inversion/);
});

test("missing evidence degrades, never upgrades: each null caps the tier", () => {
  // Missing VIX: otherwise-A evidence caps at B, with a down factor saying why.
  const noVix = assignZeroDteTier(boundaryA({ vixOpen: null, cortexScore: 3, cortexSupportCount: 3 }));
  assert.equal(noVix.tier, "B");
  assert.ok(noVix.factors.some((f) => f.label === "VIX unknown" && f.direction === "down"));

  // Missing Cortex: same cap.
  const noCortex = assignZeroDteTier(boundaryA({ cortexScore: null }));
  assert.equal(noCortex.tier, "B");
  assert.ok(noCortex.factors.some((f) => f.label === "Cortex evidence missing" && f.direction === "down"));

  // Missing commit time: same cap.
  const noTime = assignZeroDteTier(boundaryA({ committedEtMinutes: null }));
  assert.equal(noTime.tier, "B");

  // Missing score: unrankable — hard cap at C even with everything else perfect.
  const noScore = assignZeroDteTier(boundaryA({ score: null, cortexScore: 3, cortexSupportCount: 3 }));
  assert.equal(noScore.tier, "C");
  assert.ok(noScore.factors.some((f) => f.label === "Score missing" && f.direction === "down"));

  // All-null input: worst honest answer, never a throw.
  const empty = assignZeroDteTier({
    score: null,
    scoreFloor: null,
    cortexScore: null,
    cortexVetoCount: null,
    cortexSupportCount: null,
    vixOpen: null,
    committedEtMinutes: null,
  });
  assert.equal(empty.tier, "C");
  assert.ok(empty.factors.every((f) => f.direction === "down"));
});

test("a Cortex veto forces the tier to C, whatever else aligned", () => {
  const vetoed = assignZeroDteTier(
    boundaryA({ cortexScore: 3, cortexSupportCount: 4, cortexVetoCount: 1 })
  );
  assert.equal(vetoed.tier, "C");
  const factor = vetoed.factors.find((f) => f.label === "Cortex veto");
  assert.ok(factor);
  assert.equal(factor.direction, "down");
});

test("early-window penalty (F-4): a pre-11:00 commit costs exactly the boundary point", () => {
  // boundaryA is exactly 4 points; committing it at 10:05 ET (−1) drops it to B.
  const early = assignZeroDteTier(boundaryA({ committedEtMinutes: 10 * 60 + 5 }));
  assert.equal(early.tier, "B");
  assert.ok(early.factors.some((f) => f.label === "Early window" && f.direction === "down"));
  // 11:00 exactly is OUTSIDE the early window (boundary in the other direction).
  const at11 = assignZeroDteTier(boundaryA({ committedEtMinutes: 11 * 60 }));
  assert.equal(at11.tier, "A");
});

test("VIX bands both directions: 16.9 calm, 17 elevated, 20 extreme, 14 neutral", () => {
  assert.equal(assignZeroDteTier(boundaryA({ vixOpen: 16.9 })).tier, "A");
  // 17.0 flips the +2 to −2 — boundaryA drops from 4 points to 0 → C.
  assert.equal(assignZeroDteTier(boundaryA({ vixOpen: 17 })).tier, "C");
  // Sub-15: evidence present but no measured edge — no points, no cap → 2 points → B.
  const sub15 = assignZeroDteTier(boundaryA({ vixOpen: 14 }));
  assert.equal(sub15.tier, "B");
  assert.ok(!sub15.factors.some((f) => f.label.startsWith("VIX")));
  // Extreme is worse than elevated: −3 → boundaryA lands at 1 → still C via points.
  assert.equal(assignZeroDteTier(boundaryA({ vixOpen: 21 })).tier, "C");
});

test("factors are human-readable chips: every factor carries label/direction/detail", () => {
  const { factors } = assignZeroDteTier(boundaryA({ vixOpen: 18, cortexScore: -1.5 }));
  assert.ok(factors.length >= 3);
  for (const f of factors) {
    assert.equal(typeof f.label, "string");
    assert.ok(f.label.length > 0);
    assert.ok(f.direction === "up" || f.direction === "down");
    assert.ok(f.detail.length > 10); // a sentence, not a code
  }
});

test("determinism: same input, same assignment", () => {
  const input = boundaryA({ vixOpen: 18.2, cortexScore: 0.8, cortexSupportCount: 1 });
  assert.deepEqual(assignZeroDteTier(input), assignZeroDteTier(input));
});

test("tierForSkip: F by definition, gate blocks become verbatim down factors", () => {
  const skip = tierForSkip([
    { code: "tape_alignment", reason: "Long setup fights the DOWN market tape." },
    { code: "cortex_veto:catalysts", reason: "Cortex veto [catalysts]: earnings tonight." },
  ]);
  assert.equal(skip.tier, "F");
  assert.deepEqual(
    skip.factors.map((f) => [f.label, f.direction]),
    [
      ["tape_alignment", "down"],
      ["cortex_veto:catalysts", "down"],
    ]
  );
  assert.equal(skip.factors[1]!.detail, "Cortex veto [catalysts]: earnings tonight.");
  // No blocks supplied (context-unavailable path) — still F, with an honest factor.
  const bare = tierForSkip();
  assert.equal(bare.tier, "F");
  assert.equal(bare.factors.length, 1);
  assert.equal(bare.factors[0]!.direction, "down");
});

// ── tierFromEntryContext — the retroactive adapter over real pinned blobs ─────────

/** A realistic post-#318 pinned blob (entry-context.ts shape): full Cortex evidence
 *  vector, VIX, bias, ET stamp — what a committed row's entry_context looks like. */
const PINNED_FULL: Record<string, unknown> = {
  vix_open: 16.2,
  spy_bias: "up",
  gamma_regime: "short_gamma",
  score: 78,
  committed_at_et: "2026-07-10 12:10 ET",
  cortex: {
    abstained: false,
    decision: "PASS",
    as_of: "2026-07-10T16:10:00.000Z",
    score: 1.85,
    conviction: "B",
    vetoes: [],
    supports: [
      { source: "positioning", detail: "dealer short gamma below spot", weight: 1.0 },
      { source: "flow", detail: "sweep cluster same-direction", weight: 0.85 },
    ],
    opposes: [],
    absent: ["catalysts"],
    narrative: ["..."],
  },
};

test("tierFromEntryContext: a full pinned blob adapts cleanly (prime score + calm VIX + clean Cortex + midday → A)", () => {
  const assigned = tierFromEntryContext(PINNED_FULL);
  assert.ok(assigned);
  assert.equal(assigned.tier, "A");
  assert.ok(assigned.factors.some((f) => f.label === "Clean Cortex support"));
  assert.ok(assigned.factors.some((f) => f.label === "VIX calm band"));
});

test("tierFromEntryContext: the real 7/13 MU pinned shape (pre-Cortex row) degrades honestly", () => {
  // The exact blob shape record.test.ts's 7/13 fixture carries: score 54, VIX 17.2,
  // no cortex key at all (pre-#318), no committed_at_et (pre-stamp).
  const assigned = tierFromEntryContext({ score: 54, vix_open: 17.2, spy_bias: "down" });
  assert.ok(assigned);
  // Below-floor score (−2) + elevated VIX (−2), Cortex + time missing (caps) → C.
  assert.equal(assigned.tier, "C");
  assert.ok(assigned.factors.some((f) => f.label === "Score below floor"));
  assert.ok(assigned.factors.some((f) => f.label === "VIX elevated"));
  assert.ok(assigned.factors.some((f) => f.label === "Cortex evidence missing"));
});

test("tierFromEntryContext: abstained Cortex is an evidence gap, not a zero", () => {
  const assigned = tierFromEntryContext({
    ...PINNED_FULL,
    cortex: { abstained: true, reason: "no Cortex source produced evidence (6 absent)" },
  });
  assert.ok(assigned);
  assert.equal(assigned.tier, "B"); // A-grade numbers, but no corroboration → capped
  assert.ok(assigned.factors.some((f) => f.label === "Cortex evidence missing"));
});

test("tierFromEntryContext: ET stamp parses; malformed fields degrade to null, never throw", () => {
  // Early-window stamp costs the F-4 point: 09:55 ET drops PINNED_FULL from A to...
  // +2 prime, +2 calm VIX, +2 clean cortex, −1 early = 5 → still A (evidence-rich
  // plays survive one drag; the boundary case is covered above).
  const early = tierFromEntryContext({ ...PINNED_FULL, committed_at_et: "2026-07-10 09:55 ET" });
  assert.ok(early);
  assert.ok(early.factors.some((f) => f.label === "Early window"));

  // Malformed stamp/score/vix: each degrades to the missing-evidence path.
  const mangled = tierFromEntryContext({
    score: "78", // wrong type
    vix_open: Number.NaN,
    committed_at_et: "noon-ish",
    cortex: { abstained: false, score: "high", vetoes: "none", supports: null },
  });
  assert.ok(mangled);
  assert.equal(mangled.tier, "C"); // unrankable score caps at C
  assert.ok(mangled.factors.some((f) => f.label === "Score missing"));
});

test("tierFromEntryContext: no blob at all is untierable (null), not a fake C", () => {
  assert.equal(tierFromEntryContext(null), null);
  assert.equal(tierFromEntryContext(undefined), null);
});
