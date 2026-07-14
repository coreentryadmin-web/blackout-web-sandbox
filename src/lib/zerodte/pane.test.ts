import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVICTION_A_MIN_SCORE } from "@/lib/nighthawk/cortex/compose";
import { capConvictionDisplay, ZERODTE_CONVICTION_DISPLAY_CAP } from "./conviction";
import {
  cortexAbstained,
  evidenceRowParts,
  fmtLockRemaining,
  minutesUntilEtUnlock,
  readCortexVerdict,
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

test("cortexAbstained: no verdict OR a verdict with zero active evidence is an abstention", () => {
  assert.equal(cortexAbstained(null), true);
  assert.equal(cortexAbstained({ ...validVerdict, supports: [], opposes: [], vetoes: [] }), true);
  assert.equal(cortexAbstained(validVerdict), false);
  const vetoOnly = { ...validVerdict, supports: [], opposes: [], vetoes: [{ source: "flow-quality", stance: "veto", weight: 1, detail: "Opposing whale block." }] };
  assert.equal(cortexAbstained(vetoOnly), false);
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
  assert.equal(zeroDteGateLabel("cortex_veto"), "cortex · veto");
  assert.equal(zeroDteGateLabel("some_future_gate"), "some future gate");
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
