// Night Hawk 0DTE pane — pure presentation helpers (dependency-light leaf).
// Everything the member-facing pane derives beyond the payload's own numbers lives
// here as tested pure functions: size-chip mapping (B-4), the G-2 unlock countdown,
// evidence-row formatting, gate-code → plain-English labels, the readiness light
// (B-7), and re-entry-lock countdown math. HARD RULE carried from the pane spec:
// none of these functions invent a number — every numeric input is a payload field
// (or the client clock for countdowns/staleness), and absence degrades to null,
// never to a fabricated value.

import { CONVICTION_A_MIN_SCORE } from "@/lib/nighthawk/cortex/compose";

// ── Cortex verdict (defensive structural read) ─────────────────────────────────────
// The cortex wire-in (#318) ships the evidence in TWO shapes the pane must accept:
//  - a fresh find's setup.cortex — ZeroDteCortexAssessment, verdict NESTED under
//    `.verdict` ({abstained:false, decision, verdict:{score, vetoes, ...}});
//  - a committed ledger row's entry_context.cortex — ZeroDteCortexEntryContext,
//    the same fields FLATTENED ({abstained:false, decision, score, vetoes, ...}).
// Both cross an HTTP/JSON boundary before reaching this client, and rows committed
// before the wire-in shipped carry nothing at all — so the pane reads STRUCTURALLY
// and treats any malformed/missing shape as "no verdict" (honest gates-only copy),
// never a crash and never a guessed evidence table.

export type CortexEvidenceItemLike = {
  source: string;
  stance: string;
  weight: number;
  detail: string;
  asOf?: string;
};

export type CortexVerdictLike = {
  score: number;
  conviction: string;
  asOf?: string;
  vetoes: CortexEvidenceItemLike[];
  supports: CortexEvidenceItemLike[];
  opposes: CortexEvidenceItemLike[];
  absent: string[];
  narrative?: string[];
};

function isEvidenceArray(v: unknown): v is CortexEvidenceItemLike[] {
  return (
    Array.isArray(v) &&
    v.every(
      (item) =>
        item != null &&
        typeof item === "object" &&
        typeof (item as CortexEvidenceItemLike).source === "string" &&
        typeof (item as CortexEvidenceItemLike).detail === "string" &&
        typeof (item as CortexEvidenceItemLike).weight === "number"
    )
  );
}

/** Structurally validate a maybe-cortex field. Anything that doesn't carry the full
 *  verdict shape reads as null (no verdict) — the pane then renders the honest
 *  abstain line instead of a partial/garbled evidence table. */
export function readCortexVerdict(raw: unknown): CortexVerdictLike | null {
  if (raw == null || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.score !== "number" || !Number.isFinite(v.score)) return null;
  if (typeof v.conviction !== "string") return null;
  if (!isEvidenceArray(v.vetoes) || !isEvidenceArray(v.supports) || !isEvidenceArray(v.opposes)) return null;
  if (!Array.isArray(v.absent) || !v.absent.every((a) => typeof a === "string")) return null;
  return v as unknown as CortexVerdictLike;
}

/** The pane's normalized cortex state for one play/skip card. */
export type PaneCortexView =
  | { abstained: true; reason: string }
  | { abstained: false; decision: "PASS" | "VETO" | "NET_NEGATIVE" | null; verdict: CortexVerdictLike };

const CORTEX_DECISIONS = new Set(["PASS", "VETO", "NET_NEGATIVE"]);

/**
 * Normalize either cortex shape (nested assessment / flattened entry-context blob)
 * into one view. Null = no verdict on record (pre-wire-in rows, refresh-lane
 * setups, malformed blobs) — rendered as the honest "gates-only" line.
 */
export function readCortexView(raw: unknown): PaneCortexView | null {
  if (raw == null || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.abstained === true) {
    return { abstained: true, reason: typeof a.reason === "string" ? a.reason : "" };
  }
  // Fresh-find assessment nests the verdict; the entry-context blob flattens it.
  const verdict = readCortexVerdict(a.verdict ?? raw);
  if (verdict == null) return null;
  // Defensive: a verdict with zero active evidence IS an abstention (the composer
  // normally converts these upstream — assessCortexVerdict — but never trust a blob).
  if (verdict.supports.length === 0 && verdict.opposes.length === 0 && verdict.vetoes.length === 0) {
    return {
      abstained: true,
      reason: `no Cortex source produced evidence (${verdict.absent.length} absent).`,
    };
  }
  const decision = typeof a.decision === "string" && CORTEX_DECISIONS.has(a.decision) ? (a.decision as "PASS" | "VETO" | "NET_NEGATIVE") : null;
  return { abstained: false, decision, verdict };
}

// ── B-4 suggested size (0.5× / 1× ONLY) ────────────────────────────────────────────
// Deliberately the crudest possible sizing rule: full unit only when the Cortex
// evidence score clears the SAME floor that earns conviction A (CONVICTION_A_MIN_SCORE
// — one structural argument plus the wall lifecycle agreeing, net of opposition);
// everything else — including "no verdict at all" — is half size. Richer sizing
// (0.25× grades, VIX-scaled units, per-source multipliers) must be EARNED by ≥30
// sessions of calibration data before it may ship; until then anything finer than
// this binary would be a fabricated precision the record cannot back.

export type ZeroDteSizeChip = {
  size: "1×" | "0.5×";
  /** One deterministic sentence for the chip tooltip — inputs only, no invention. */
  basis: string;
};

export function suggestedZeroDteSize(
  cortexScore: number | null | undefined,
  hasVeto: boolean
): ZeroDteSizeChip {
  if (hasVeto) {
    // Defensive: a vetoed verdict should never reach a committed card (the gate
    // stack blocks it), but if one does, it must not read as a full-size endorsement.
    return { size: "0.5×", basis: "Cortex veto present — minimum size only." };
  }
  if (cortexScore != null && Number.isFinite(cortexScore) && cortexScore >= CONVICTION_A_MIN_SCORE) {
    return {
      size: "1×",
      basis: `Cortex evidence score ${round2(cortexScore)} ≥ ${CONVICTION_A_MIN_SCORE} (conviction-A floor) — full unit.`,
    };
  }
  return {
    size: "0.5×",
    basis:
      cortexScore == null
        ? "No Cortex verdict on this commit — half size (conservative default)."
        : `Cortex evidence score ${round2(cortexScore)} below the ${CONVICTION_A_MIN_SCORE} conviction-A floor — half size.`,
  };
}

// ── Evidence row formatting ─────────────────────────────────────────────────────────

export type EvidenceRowParts = {
  /** Mono source tag, e.g. "[gex-walls]". */
  tag: string;
  detail: string;
  /** "+0.75" / "−0.60" / "VETO" — the signed effective contribution the score used. */
  weight: string;
  tone: "supports" | "opposes" | "veto";
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One evidence table row: `[source] detail` + the signed weight. Vetoes render the
 *  word VETO instead of a number — they are unbounded hard blocks, not score terms. */
export function evidenceRowParts(item: CortexEvidenceItemLike): EvidenceRowParts {
  const tone: EvidenceRowParts["tone"] =
    item.stance === "veto" ? "veto" : item.stance === "opposes" ? "opposes" : "supports";
  const weight =
    tone === "veto"
      ? "VETO"
      : `${tone === "opposes" ? "−" : "+"}${Math.abs(round2(item.weight)).toFixed(2)}`;
  return { tag: `[${item.source}]`, detail: item.detail, weight, tone };
}

// ── Gate-code → plain-English label ────────────────────────────────────────────────
// Machine codes from the zerodte_scan_rejections namespace (board.ts's
// ZeroDteGateFailure) plus the cortex codes the wire-in adds. The full sentence the
// member reads is always the payload's own `reason`; this label only names WHICH
// gate fired for the badge. Unknown codes (future gates) prettify instead of throwing.

const GATE_LABELS: Record<string, string> = {
  tape_alignment: "G-1 · tape alignment",
  no_market_bias: "G-1 · tape unreadable",
  opening_window: "G-2 · opening window",
  score_floor: "G-3 · score floor",
  governor_max_concurrent: "governor · plans cap",
  governor_session_stops: "governor · stop halt",
  governor_reentry_lock: "governor · re-entry lock",
  correlated_conflict: "governor · correlated conflict",
  gate_context_unavailable: "fail-closed · gate context",
  // Cortex wire-in codes (#318). cortex_veto carries a `:<source>` suffix — handled
  // by the prefix branch in zeroDteGateLabel below.
  cortex_net_negative: "cortex · net-negative",
  // Evidence gates (pre-setup rejections), for completeness if ever surfaced here.
  min_gross: "evidence · premium floor",
  min_aggr_share: "evidence · aggression floor",
  min_dominance: "evidence · dominance floor",
  max_itm_pct: "evidence · moneyness",
  no_dominant_strike: "evidence · no dominant strike",
  no_underlying_price: "evidence · no underlying price",
};

export function zeroDteGateLabel(code: string): string {
  // "cortex_veto:<source>" — one block per vetoing source (cortex-gate.ts); the
  // badge names the source, the payload's reason sentence carries the detail.
  if (code.startsWith("cortex_veto")) {
    const source = code.split(":")[1];
    return source ? `cortex · veto [${source}]` : "cortex · veto";
  }
  return GATE_LABELS[code] ?? code.replace(/_/g, " ");
}

/** True when a gate block came from the Cortex evidence layer (veto/net-negative) —
 *  the SKIP card highlights these like the other hard-risk blocks. */
export function isCortexBlockCode(code: string): boolean {
  return code.startsWith("cortex_veto") || code === "cortex_net_negative";
}

// ── G-2 unlock countdown ───────────────────────────────────────────────────────────
// The payload's opening_window block carries its own unlock as `threshold` (ET
// minutes-since-midnight, 585 = 9:45 ET) and `unlock_et` ("9:45 ET"); the client
// only supplies the ticking clock. Countdown math, not a payload re-derivation.

export function minutesUntilEtUnlock(
  unlockEtMinutes: number | null | undefined,
  nowEtMinutes: number
): number | null {
  if (unlockEtMinutes == null || !Number.isFinite(unlockEtMinutes)) return null;
  const left = unlockEtMinutes - nowEtMinutes;
  return left > 0 ? left : null;
}

// ── Governor re-entry lock countdown ───────────────────────────────────────────────
// `atMs` (stop observation) and `lockMs` (lock length) both arrive in the payload's
// governor summary; the client adds only its clock. A ledger-derived stop with no
// recorded timestamp (at_ms null) has no countable lock — rendered as counted-toward-
// halt but never given a fabricated timer.

export function reentryLockRemainingMs(
  atMs: number | null | undefined,
  lockMs: number,
  nowMs: number
): number | null {
  if (atMs == null || !Number.isFinite(atMs) || !(lockMs > 0)) return null;
  const left = atMs + lockMs - nowMs;
  return left > 0 ? left : null;
}

/** "12m 34s" for a lock countdown (deterministic; ≥1s granularity). */
export function fmtLockRemaining(ms: number): string {
  const totalSec = Math.max(1, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

// ── B-7 readiness light (small version) ────────────────────────────────────────────
// The chip REPORTS server-declared state plus observable transport/freshness — it
// never infers a degradation the payload didn't declare. The "no new commits"
// wording is reserved for the two signals the server itself treats as fail-closed
// inputs (payload.degraded, upstream_ok === false); a merely-stale response or a
// dropped marks stream is reported as exactly that.

export type ZeroDteReadiness = {
  tone: "green" | "amber";
  label: string;
  detail: string;
};

export function resolveZeroDteReadiness(input: {
  /** payload.degraded === true or payload.upstream_ok === false — server-declared. */
  serverDegraded: boolean;
  /** now − Date.parse(payload.as_of); null when as_of is absent/unparseable. */
  asOfAgeMs: number | null;
  /** heat.state !== "CLOSED" — outside the session nothing is expected to stream. */
  sessionLive: boolean;
  /** Transport of the last live-marks payload; null = no frame received yet. */
  marksTransport: "sse" | "poll" | null;
  /** Whether any OPEN/HOLD/TRIM play exists (a dead stream only matters then). */
  hasLivePlays: boolean;
  staleAfterMs?: number;
}): ZeroDteReadiness {
  const staleAfter = input.staleAfterMs ?? 60_000;
  if (input.serverDegraded) {
    return {
      tone: "amber",
      label: "DEGRADED",
      detail: "Degraded data — no new commits (scanner fails closed until its feeds recover).",
    };
  }
  if (!input.sessionLive) {
    return { tone: "green", label: "OFF-HOURS", detail: "Session closed — board frozen at the final state." };
  }
  if (input.asOfAgeMs != null && input.asOfAgeMs > staleAfter) {
    return { tone: "amber", label: "DELAYED", detail: "Board response is stale — numbers may lag the tape." };
  }
  if (input.hasLivePlays && input.marksTransport == null) {
    return { tone: "amber", label: "MARKS DOWN", detail: "Live-marks stream not delivering — marks fall back to the board poll." };
  }
  return { tone: "green", label: "READY", detail: "Board fresh · live marks streaming." };
}
