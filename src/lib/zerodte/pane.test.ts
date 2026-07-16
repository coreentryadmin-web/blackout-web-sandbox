import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVICTION_A_MIN_SCORE } from "@/lib/nighthawk/cortex/compose";
import { capConvictionDisplay, ZERODTE_CONVICTION_DISPLAY_CAP } from "./conviction";
import {
  evidenceRowParts,
  fmtLockRemaining,
  isCortexBlockCode,
  minutesUntilEtUnlock,
  readCortexVerdict,
  readCortexView,
  readTierAssignment,
  reentryLockRemainingMs,
  resolveZeroDteReadiness,
  suggestedZeroDteSize,
  zeroDteGateLabel,
  type CortexVerdictLike,
} from "./pane";

// ── C-1 conviction display cap ──────────────────────────────────────────────────────

test("capConvictionDisplay: A+ caps to A (C-1 — the A+ band is under calibration investigation)", () => {
  assert.equal(capConvictionDisplay("A+"), "A");
  assert.equal(capConvictionDisplay(" a+ "), "A"); // casing/whitespace never dodges the cap
  assert.equal(ZERODTE_CONVICTION_DISPLAY_CAP, "A");
});

test("capConvictionDisplay: everything at or below A passes through; absent stays absent", () => {
  assert.equal(capConvictionDisplay("A"), "A");
  assert.equal(capConvictionDisplay("B"), "B");
  assert.equal(capConvictionDisplay("C"), "C");
  assert.equal(capConvictionDisplay("high"), "high"); // legacy free-text labels untouched
  assert.equal(capConvictionDisplay(null), null);
  assert.equal(capConvictionDisplay(undefined), null);
  assert.equal(capConvictionDisplay("  "), null); // whitespace-only is not a conviction
});

// ── defensive cortex verdict read ───────────────────────────────────────────────────

const validVerdict: CortexVerdictLike = {
  score: 2.4,
  conviction: "A",
  asOf: "2026-07-14T14:00:00.000Z",
  vetoes: [],
  supports: [
    { source: "gex-walls", stance: "supports", weight: 1.0, detail: "Path to 6300 is clear of opposing walls." },
    { source: "wall-trend", stance: "supports", weight: 1.4, detail: "6300 call wall grew 3 samples running." },
  ],
  opposes: [{ source: "sector-heat", stance: "opposes", weight: 0.3, detail: "Tech sector −0.4% on the day." }],
  absent: ["vex-charm: matrix cold — no VEX read this cycle"],
};

test("readCortexVerdict: full verdict shape passes through", () => {
  const v = readCortexVerdict(validVerdict);
  assert.ok(v);
  assert.equal(v!.score, 2.4);
  assert.equal(v!.supports.length, 2);
});

test("readCortexVerdict: missing/malformed shapes read as null (pre-#318 payloads, partial objects)", () => {
  assert.equal(readCortexVerdict(undefined), null);
  assert.equal(readCortexVerdict(null), null);
  assert.equal(readCortexVerdict("A"), null);
  assert.equal(readCortexVerdict({}), null);
  assert.equal(readCortexVerdict({ score: 2, conviction: "A" }), null); // arrays missing
  assert.equal(readCortexVerdict({ ...validVerdict, score: Number.NaN }), null);
  assert.equal(readCortexVerdict({ ...validVerdict, supports: [{ source: "x" }] }), null); // items malformed
  assert.equal(readCortexVerdict({ ...validVerdict, absent: [42] }), null);
});

test("readCortexView: normalizes a fresh find's NESTED assessment ({decision, verdict}) — the #318 setup shape", () => {
  const view = readCortexView({ decision: "PASS", abstained: false, verdict: validVerdict });
  assert.ok(view && !view.abstained);
  assert.equal(view.decision, "PASS");
  assert.equal(view.verdict.score, 2.4);
});

test("readCortexView: normalizes the ledger's FLATTENED entry_context.cortex blob — same fields, no .verdict nesting", () => {
  const view = readCortexView({ abstained: false, decision: "PASS", as_of: validVerdict.asOf, ...validVerdict });
  assert.ok(view && !view.abstained);
  assert.equal(view.decision, "PASS");
  assert.equal(view.verdict.supports.length, 2);
});

test("readCortexView: an honest ABSTAIN carries its reason; nothing else", () => {
  const view = readCortexView({ abstained: true, reason: "no Cortex source produced evidence (8 absent)." });
  assert.ok(view && view.abstained);
  assert.match(view.reason, /8 absent/);
});

test("readCortexView: a verdict with zero active evidence reads as an abstention, never an empty table", () => {
  const view = readCortexView({ abstained: false, decision: "PASS", verdict: { ...validVerdict, supports: [], opposes: [], vetoes: [] } });
  assert.ok(view && view.abstained);
});

test("readCortexView: pre-wire-in rows / malformed blobs read as null (no verdict on record)", () => {
  assert.equal(readCortexView(undefined), null);
  assert.equal(readCortexView(null), null);
  assert.equal(readCortexView({}), null);
  assert.equal(readCortexView({ decision: "PASS" }), null); // no verdict anywhere
  const view = readCortexView({ abstained: false, decision: "NOT_A_DECISION", verdict: validVerdict });
  assert.ok(view && !view.abstained);
  assert.equal(view.decision, null); // unknown decision string degrades to null, verdict survives
});

// ── PR-F merit-tier structural read ─────────────────────────────────────────────────

test("readTierAssignment: a pinned {tier, factors} blob passes through intact", () => {
  const blob = {
    tier: "B",
    factors: [
      { label: "Mid score band", direction: "up", detail: "Score 68 in 65-74." },
      { label: "Early window", direction: "down", detail: "Committed before 11:00 ET." },
    ],
  };
  assert.deepEqual(readTierAssignment(blob), blob);
  // Zero factors is a legal (if unusual) assignment — the shape is what's validated.
  assert.deepEqual(readTierAssignment({ tier: "C", factors: [] }), { tier: "C", factors: [] });
});

test("readTierAssignment: malformed/absent blobs read as null — no chip, never a guessed grade", () => {
  assert.equal(readTierAssignment(undefined), null);
  assert.equal(readTierAssignment(null), null);
  assert.equal(readTierAssignment("A"), null);
  assert.equal(readTierAssignment({}), null);
  assert.equal(readTierAssignment({ tier: "A" }), null); // factors missing
  assert.equal(readTierAssignment({ tier: "A", factors: "broken" }), null);
  assert.equal(
    readTierAssignment({ tier: "A", factors: [{ label: "x", direction: "sideways", detail: "y" }] }),
    null,
    "an unknown factor direction is a malformed blob"
  );
});

test("readTierAssignment: only assignable letters pass — a blob claiming A+ or F is malformed by definition", () => {
  // A+ is a DISPLAY promotion (displayTierFor over the measured record) and F is the
  // skip pile (tierForSkip) — neither can be a pinned entry assignment, so a blob
  // asserting one must not render as if the engine said it (tiers.ts rules 1 + F).
  assert.equal(readTierAssignment({ tier: "A+", factors: [] }), null);
  assert.equal(readTierAssignment({ tier: "F", factors: [] }), null);
  assert.equal(readTierAssignment({ tier: "D", factors: [] }), null);
});

// ── B-4 suggested size (0.5×/1× only) ───────────────────────────────────────────────

test("suggestedZeroDteSize: score at/above the conviction-A floor earns 1×, everything else 0.5×", () => {
  assert.equal(suggestedZeroDteSize(CONVICTION_A_MIN_SCORE, false).size, "1×");
  assert.equal(suggestedZeroDteSize(CONVICTION_A_MIN_SCORE + 1.3, false).size, "1×");
  assert.equal(suggestedZeroDteSize(CONVICTION_A_MIN_SCORE - 0.01, false).size, "0.5×");
  assert.equal(suggestedZeroDteSize(0, false).size, "0.5×");
});

test("suggestedZeroDteSize: no verdict (null) is the conservative half-size default — never a fabricated 1×", () => {
  assert.equal(suggestedZeroDteSize(null, false).size, "0.5×");
  assert.equal(suggestedZeroDteSize(undefined, false).size, "0.5×");
  assert.equal(suggestedZeroDteSize(Number.NaN, false).size, "0.5×");
});

test("suggestedZeroDteSize: a veto can never read as a full-size endorsement, whatever the score", () => {
  const chip = suggestedZeroDteSize(99, true);
  assert.equal(chip.size, "0.5×");
  assert.match(chip.basis, /veto/i);
});

// ── evidence row formatting ─────────────────────────────────────────────────────────

test("evidenceRowParts: supports render [source] + positive signed weight", () => {
  const row = evidenceRowParts({ source: "gex-walls", stance: "supports", weight: 0.754, detail: "d" });
  assert.equal(row.tag, "[gex-walls]");
  assert.equal(row.weight, "+0.75");
  assert.equal(row.tone, "supports");
});

test("evidenceRowParts: opposes render a negative weight regardless of the raw sign", () => {
  assert.equal(evidenceRowParts({ source: "sector-heat", stance: "opposes", weight: 0.3, detail: "d" }).weight, "−0.30");
  assert.equal(evidenceRowParts({ source: "sector-heat", stance: "opposes", weight: -0.3, detail: "d" }).weight, "−0.30");
});

test("evidenceRowParts: vetoes render the word VETO, never a score number (unbounded hard block)", () => {
  const row = evidenceRowParts({ source: "flow-quality", stance: "veto", weight: 1, detail: "d" });
  assert.equal(row.weight, "VETO");
  assert.equal(row.tone, "veto");
});

// ── gate labels ─────────────────────────────────────────────────────────────────────

test("zeroDteGateLabel: known codes map to their gate names; unknown codes prettify, never throw", () => {
  assert.equal(zeroDteGateLabel("tape_alignment"), "G-1 · tape alignment");
  assert.equal(zeroDteGateLabel("opening_window"), "G-2 · opening window");
  assert.equal(zeroDteGateLabel("score_floor"), "G-3 · score floor");
  assert.equal(zeroDteGateLabel("governor_session_stops"), "governor · stop halt");
  assert.equal(zeroDteGateLabel("correlated_conflict"), "governor · correlated conflict");
  assert.equal(zeroDteGateLabel("cortex_net_negative"), "cortex · net-negative");
  assert.equal(zeroDteGateLabel("vix_elevated"), "G-4 · VIX elevated");
  assert.equal(zeroDteGateLabel("vix_extreme"), "G-4 · VIX extreme");
  assert.equal(zeroDteGateLabel("cross_system_conflict"), "G-6 · cross-system conflict");
  assert.equal(zeroDteGateLabel("some_future_gate"), "some future gate");
});

test("zeroDteGateLabel: cortex_veto:<source> names the vetoing source on the badge", () => {
  assert.equal(zeroDteGateLabel("cortex_veto:flow-quality"), "cortex · veto [flow-quality]");
  assert.equal(zeroDteGateLabel("cortex_veto"), "cortex · veto"); // defensive: bare code
});

test("isCortexBlockCode: veto (any source) and net-negative are cortex blocks; hard gates are not", () => {
  assert.equal(isCortexBlockCode("cortex_veto:gex-walls"), true);
  assert.equal(isCortexBlockCode("cortex_net_negative"), true);
  assert.equal(isCortexBlockCode("tape_alignment"), false);
});

// ── G-2 unlock countdown ────────────────────────────────────────────────────────────

test("minutesUntilEtUnlock: counts down to the payload's threshold (585 = 9:45 ET), null once unlocked", () => {
  const unlock = 9 * 60 + 45;
  assert.equal(minutesUntilEtUnlock(unlock, 9 * 60 + 31), 14);
  assert.equal(minutesUntilEtUnlock(unlock, 9 * 60 + 44), 1);
  assert.equal(minutesUntilEtUnlock(unlock, 9 * 60 + 45), null); // unlocked — no countdown chip
  assert.equal(minutesUntilEtUnlock(unlock, 10 * 60), null);
  assert.equal(minutesUntilEtUnlock(null, 9 * 60 + 31), null); // no threshold in the payload → no chip
});

// ── re-entry lock countdown ─────────────────────────────────────────────────────────

test("reentryLockRemainingMs: counts down from the recorded stop; untimed ledger stops get NO fabricated timer", () => {
  const lock = 20 * 60 * 1000;
  const stoppedAt = 1_000_000;
  assert.equal(reentryLockRemainingMs(stoppedAt, lock, stoppedAt + 5 * 60 * 1000), 15 * 60 * 1000);
  assert.equal(reentryLockRemainingMs(stoppedAt, lock, stoppedAt + lock), null); // expired
  assert.equal(reentryLockRemainingMs(null, lock, 123), null); // at_ms null → no timer, ever
});

test("fmtLockRemaining: m/s rendering", () => {
  assert.equal(fmtLockRemaining(15 * 60 * 1000), "15m 00s");
  assert.equal(fmtLockRemaining(61_000), "1m 01s");
  assert.equal(fmtLockRemaining(9_000), "9s");
});

// ── B-7 readiness light ─────────────────────────────────────────────────────────────

test("readiness: server-declared degradation is the ONLY state that says 'no new commits'", () => {
  const r = resolveZeroDteReadiness({
    serverDegraded: true,
    asOfAgeMs: 1_000,
    sessionLive: true,
    marksTransport: "sse",
    hasLivePlays: true,
  });
  assert.equal(r.tone, "amber");
  assert.match(r.detail, /no new commits/);
});

test("readiness: a stale response is reported as DELAYED — the chip never infers 'no new commits' from age", () => {
  const r = resolveZeroDteReadiness({
    serverDegraded: false,
    asOfAgeMs: 120_000,
    sessionLive: true,
    marksTransport: "sse",
    hasLivePlays: true,
  });
  assert.equal(r.tone, "amber");
  assert.equal(r.label, "DELAYED");
  assert.doesNotMatch(r.detail, /no new commits/);
});

test("readiness: marks transport down with live plays is amber; without live plays it stays green", () => {
  const base = { serverDegraded: false, asOfAgeMs: 2_000, sessionLive: true, marksTransport: null } as const;
  assert.equal(resolveZeroDteReadiness({ ...base, hasLivePlays: true }).tone, "amber");
  assert.equal(resolveZeroDteReadiness({ ...base, hasLivePlays: false }).tone, "green");
});

test("readiness: fresh board + streaming marks is green; a closed session is green OFF-HOURS", () => {
  const live = resolveZeroDteReadiness({
    serverDegraded: false,
    asOfAgeMs: 3_000,
    sessionLive: true,
    marksTransport: "sse",
    hasLivePlays: true,
  });
  assert.equal(live.tone, "green");
  assert.equal(live.label, "READY");
  const closed = resolveZeroDteReadiness({
    serverDegraded: false,
    asOfAgeMs: 3_600_000, // an old as_of off-hours is expected, not a warning
    sessionLive: false,
    marksTransport: null,
    hasLivePlays: false,
  });
  assert.equal(closed.tone, "green");
  assert.equal(closed.label, "OFF-HOURS");
});
