// BIE × Night Hawk Cortex — the read bridge (PR-H).
//
// Before this module the awareness was ONE-WAY: the Cortex reads BIE's own composers
// (fetchVectorFullState, market breadth, the flow readers) to build its evidence, but
// nothing under src/lib/bie/ could read the Cortex back — Largo could list 0DTE plays
// yet could not explain WHY anything was committed, vetoed, sized, or exited. This
// module closes the loop with two deterministic reads (no LLM anywhere):
//
//  - readCortexForPlay(ticker, sessionDate?) — the PINNED truth for a decision of
//    record: the ledger row's entry_context.cortex (the full evidence vector the gate
//    stack actually acted on at commit), entry_context.exit (what the exit engine did
//    and why), gate_calibration_json, and — when there is no ledger row — the
//    zerodte_scan_rejections record (which carries Cortex veto / net-negative blocks
//    as gate codes). Pinned means pinned: nothing here is re-derived after the fact.
//  - composeCortexLive(ticker, direction) — "what would the Cortex say RIGHT NOW"
//    for any ticker, via the same fetchCortexInputs → composeCortexEvidence pipeline
//    the scanner runs on gate survivors. Fail-soft and honest: partial sources are
//    surfaced as per-source absent markers (the composer already does this — we
//    surface it, never hide it), and a total outage returns an explicit "no verdict"
//    envelope, never a fabricated one.
//
// Both return the structured BieAnswerEnvelope shape (#63) so Largo renders them
// natively; cortexCitationFor() is the compact form the OTHER intents (verdict /
// ticker_advice / zerodte_plays / the SPX why path) fold in so every synthesis about
// a 0DTE-relevant ticker cites the Cortex alongside its own inputs.
//
// IO discipline: every reader is dynamically imported with a RELATIVE specifier —
// CI's tsx ESM loader cannot resolve "@/" aliases in dynamic import positions (the
// exact silent-fallback bug attachLiveMarkMeta documents in zerodte-service.ts) —
// and every read is read-only + fail-soft. The pure envelope builders are exported
// for hermetic unit tests.

import type { ZeroDteSetupLogRow } from "@/lib/db";
import type { CortexDirection, CortexVerdict } from "@/lib/nighthawk/cortex/types";
import {
  isCortexBlockCode,
  readCortexView,
  zeroDteGateLabel,
  type CortexEvidenceItemLike,
  type PaneCortexView,
} from "@/lib/zerodte/pane";
import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieConfidence,
  type BieEvidence,
  type BieUnavailableSource,
} from "./answer-envelope";
import type { BieComposed } from "./composers-shared";

// ── Small shared formatting helpers ────────────────────────────────────────────────

/** Signed score rendering ("+1.85" / "-0.6" / "0") — matches the Cortex narrative. */
function fmtSigned(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

const fmtNum = (n: unknown, digits = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "—";

/** "[source] detail" with the signed effective weight — one evidence line. */
function evidenceText(item: CortexEvidenceItemLike): string {
  const w =
    item.stance === "veto"
      ? "VETO"
      : `${item.stance === "opposes" ? "−" : "+"}${Math.abs(item.weight).toFixed(2)}`;
  return `${w} [${item.source}] ${item.detail}`;
}

/** Map Cortex evidence items to envelope evidence (facts with per-source provenance —
 *  every line IS a recorded fact about what the composer derived, incl. its weight). */
function envelopeEvidenceFrom(items: CortexEvidenceItemLike[]): BieEvidence[] {
  return items.map((item) => ({
    kind: "fact",
    text: evidenceText(item),
    provenance: { source: `Cortex · ${item.source}`, asOf: item.asOf ?? null },
  }));
}

/** Parse the verdict's "source: reason" absent strings into unavailableSources rows —
 *  surfaced, never silently omitted (§4 honesty). */
function absentToUnavailable(absent: string[]): BieUnavailableSource[] {
  return absent.map((a) => {
    const i = a.indexOf(":");
    return i > 0
      ? { source: `Cortex · ${a.slice(0, i).trim()}`, reason: a.slice(i + 1).trim() }
      : { source: "Cortex", reason: a };
  });
}

/** Direction the question argues about — "short/puts/bearish" words flip it; the
 *  default is long (the scanner's own dominant lane). Exported for the router glue. */
export function directionFromQuestion(question: string): CortexDirection {
  return /\b(shorts?|puts?|bearish|downside|fade|fading)\b/i.test(question) ? "short" : "long";
}

/** Evidence bias for a directional verdict: evidence FOR a long argues bullish, a
 *  veto/net-negative against a long argues bearish (and mirrored for shorts). */
function biasForVerdict(direction: CortexDirection, score: number, hasVeto: boolean): BieBias {
  const supportsPlay = !hasVeto && score > 0;
  const opposesPlay = hasVeto || score < 0;
  if (!supportsPlay && !opposesPlay) return "neutral";
  if (supportsPlay) return direction === "long" ? "bullish" : "bearish";
  return direction === "long" ? "bearish" : "bullish";
}

// ── Structural readers for the pinned blobs (never trust a JSON column) ────────────

/** entry_context.exit as persisted by the exit engine (exit-engine.ts's
 *  ZeroDteExitContext) — read structurally; malformed → null, never a guess. */
export type CortexExitRecordLike = {
  reason: string;
  detail: string;
  mark: number;
  pnl_pct: number | null;
  peak_pnl_pct: number | null;
  at: string;
};

export function readExitRecord(raw: unknown): CortexExitRecordLike | null {
  if (raw == null || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.reason !== "string" || typeof e.detail !== "string") return null;
  if (typeof e.mark !== "number" || !Number.isFinite(e.mark)) return null;
  return {
    reason: e.reason,
    detail: e.detail,
    mark: e.mark,
    pnl_pct: typeof e.pnl_pct === "number" && Number.isFinite(e.pnl_pct) ? e.pnl_pct : null,
    peak_pnl_pct:
      typeof e.peak_pnl_pct === "number" && Number.isFinite(e.peak_pnl_pct) ? e.peak_pnl_pct : null,
    at: typeof e.at === "string" ? e.at : "",
  };
}

/** Plain-English label for the exit engine's machine reasons (exit-engine.ts /
 *  exit-sync.ts). Unknown reasons prettify instead of throwing — additive-safe. */
export function exitReasonLabel(reason: string): string {
  if (reason.startsWith("thesis")) return "thesis break — the Cortex evidence turned against the play";
  if (reason === "flat_theta_bleed") return "flat timeout — theta bleed, a scratch beats decay";
  if (reason === "plan_stop") return "plan stop";
  if (reason.includes("ratchet") || reason.includes("floor") || reason.includes("runner")) {
    return "profit ratchet — a latched floor locked the gain in";
  }
  return reason.replace(/_/g, " ");
}

// ── Pure envelope builders (exported for hermetic tests) ───────────────────────────

/** The ledger-row slice the pinned builder needs (a Pick of db.ts's
 *  ZeroDteSetupLogRow — accepts the full row). */
export type CortexPinnedRowLike = Pick<
  ZeroDteSetupLogRow,
  | "session_date"
  | "ticker"
  | "direction"
  | "top_strike"
  | "status"
  | "plan_outcome"
  | "plan_pnl_pct"
  | "entry_context"
  | "gate_calibration_json"
>;

const CORTEX_FOLLOWUPS = [
  "Show today's 0DTE plays",
  "What is the Cortex?",
  "What is a Cortex veto?",
];

function commitContextLine(ctx: Record<string, unknown> | null): string | null {
  if (!ctx) return null;
  const bits: string[] = [];
  if (typeof ctx.committed_at_et === "string" && ctx.committed_at_et) bits.push(`committed ${ctx.committed_at_et}`);
  if (typeof ctx.score === "number") bits.push(`commit score ${fmtNum(ctx.score, 0)}`);
  if (typeof ctx.vix_open === "number") bits.push(`VIX open ${fmtNum(ctx.vix_open)}`);
  if (typeof ctx.spy_bias === "string" && ctx.spy_bias) bits.push(`SPY bias ${ctx.spy_bias}`);
  if (typeof ctx.gamma_regime === "string" && ctx.gamma_regime) bits.push(`gamma regime ${ctx.gamma_regime}`);
  return bits.length ? `Context at entry: ${bits.join(" · ")}.` : null;
}

/** Whitelist-style scalar rendering of gate_calibration_json — prints only primitive
 *  fields that exist (the blob's exact shape is owned by the calibration lane and
 *  treated as opaque here), never invents. */
function calibrationLines(raw: Record<string, unknown> | null): string[] {
  if (!raw) return [];
  const rows: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (rows.length >= 8) break;
    if (typeof v === "number" && Number.isFinite(v)) rows.push(`- ${k.replace(/_/g, " ")}: ${fmtNum(v)}`);
    else if (typeof v === "string" && v.length <= 160) rows.push(`- ${k.replace(/_/g, " ")}: ${v}`);
    else if (typeof v === "boolean") rows.push(`- ${k.replace(/_/g, " ")}: ${v ? "yes" : "no"}`);
  }
  return rows;
}

/**
 * The pinned WHY-of-record envelope for a committed ledger play: the Cortex verdict
 * exactly as the gate stack acted on it (entry_context.cortex), the honest abstain
 * record when the Cortex could not see, the gates-only statement on pre-wire-in rows
 * — plus what the exit engine did (entry_context.exit) and the gate-calibration
 * verdict pinned at commit. PURE — callers do the IO.
 */
export function buildPinnedCortexEnvelope(row: CortexPinnedRowLike): BieAnswerEnvelope {
  const T = row.ticker.toUpperCase();
  const ctx = row.entry_context ?? null;
  const view: PaneCortexView | null = readCortexView(ctx?.cortex ?? null);
  const exit = readExitRecord(ctx?.exit ?? null);
  const dirWord = row.direction === "long" ? "long (calls)" : "short (puts)";

  const sections: BieAnswerEnvelope["sections"] = [];
  const evidence: BieEvidence[] = [];
  let unavailableSources: BieUnavailableSource[] = [];
  let confidence: BieConfidence;
  let bias: BieBias = "neutral";
  let headline: string;

  const statusBits: string[] = [];
  if (row.status) statusBits.push(`status ${row.status}`);
  if (row.plan_outcome) {
    statusBits.push(
      `graded ${row.plan_outcome}${row.plan_pnl_pct != null ? ` ${row.plan_pnl_pct > 0 ? "+" : ""}${fmtNum(row.plan_pnl_pct, 1)}%` : ""}`
    );
  }

  if (view == null) {
    // Play of record exists but carries no Cortex verdict — committed before the
    // wire-in or on the refresh lane. Say exactly that; never fabricate a verdict.
    headline = `${T} ${dirWord} — committed on the hard gates alone (no Cortex verdict pinned)`;
    sections.push({
      title: "Decision of record",
      body: [
        `${T} was committed ${dirWord}${row.top_strike != null ? ` at the ${fmtNum(row.top_strike)} strike` : ""} on ${row.session_date}, but this row carries NO pinned Cortex verdict — it was committed before the Cortex wire-in or on the refresh lane (the Cortex only runs on fresh gate survivors).`,
        commitContextLine(ctx),
        statusBits.length ? `Now: ${statusBits.join(" · ")}.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      provenance: { source: "0DTE ledger (entry_context)", asOf: null },
    });
    confidence = {
      level: "moderate",
      why: "The commit itself is on record, but no Cortex evidence was pinned — ask for the live Cortex read for a current view.",
    };
  } else if (view.abstained) {
    headline = `${T} ${dirWord} — Cortex ABSTAINED at commit`;
    sections.push({
      title: "Decision of record",
      body: [
        `The Cortex abstained: ${view.reason} The play printed on the hard gates alone — recorded honestly on the row, never dressed as a neutral score.`,
        commitContextLine(ctx),
        statusBits.length ? `Now: ${statusBits.join(" · ")}.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      provenance: { source: "0DTE ledger (entry_context.cortex)", asOf: null },
    });
    confidence = {
      level: "moderate",
      why: "Pinned commit-time record — the abstain itself is the truth of record for this play.",
    };
  } else {
    const v = view.verdict;
    // The FLATTENED entry-context blob stamps its clock as `as_of` (snake, wire
    // shape — cortex-gate.ts's cortexEntryContextFor), not the verdict's camel asOf.
    const rawCortex = (ctx?.cortex ?? null) as Record<string, unknown> | null;
    const pinnedAsOf =
      v.asOf ?? (typeof rawCortex?.as_of === "string" ? (rawCortex.as_of as string) : null);
    const decision = view.decision ?? "PASS";
    bias = biasForVerdict(row.direction, v.score, v.vetoes.length > 0);
    headline = `Why ${T} ${dirWord} was committed — Cortex ${decision}, score ${fmtSigned(v.score)}, conviction ${v.conviction}`;
    sections.push({
      title: "Decision of record",
      body: [
        `Cortex ${decision} at commit: net evidence score ${fmtSigned(v.score)} (Σ supports − Σ opposes), conviction ${v.conviction} — ${v.vetoes.length} veto${v.vetoes.length === 1 ? "" : "es"}, ${v.supports.length} supporting vs ${v.opposes.length} opposing item${v.opposes.length === 1 ? "" : "s"}, ${v.absent.length} source${v.absent.length === 1 ? "" : "s"} absent. This is the exact evidence vector the gate stack acted on — pinned at commit, never re-derived.`,
        commitContextLine(ctx),
        statusBits.length ? `Now: ${statusBits.join(" · ")}.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      bias,
      provenance: { source: "0DTE ledger (entry_context.cortex)", asOf: pinnedAsOf },
    });
    evidence.push(...envelopeEvidenceFrom([...v.vetoes, ...v.supports, ...v.opposes]));
    unavailableSources = absentToUnavailable(v.absent);
    confidence = {
      level: "high",
      why: "Pinned commit-time evidence from the ledger — the WHY of record, exactly what the scanner saw when it committed.",
    };
  }

  if (exit) {
    sections.push({
      title: "What the exit engine did",
      body:
        `Exited: ${exitReasonLabel(exit.reason)}. ${exit.detail}` +
        ` (mark ${fmtNum(exit.mark)}${exit.pnl_pct != null ? `, P&L ${exit.pnl_pct > 0 ? "+" : ""}${fmtNum(exit.pnl_pct, 1)}%` : ""}${exit.peak_pnl_pct != null ? `, peak ${exit.peak_pnl_pct > 0 ? "+" : ""}${fmtNum(exit.peak_pnl_pct, 1)}%` : ""}${exit.at ? `, at ${exit.at}` : ""}.)`,
      provenance: { source: "0DTE exit engine (entry_context.exit)", asOf: exit.at || null },
    });
  }

  const calib = calibrationLines(row.gate_calibration_json ?? null);
  if (calib.length) {
    sections.push({
      title: "Gate calibration at commit",
      body: calib.join("\n"),
      provenance: { source: "0DTE gate calibration (gate_calibration_json)", asOf: null },
    });
  }

  return makeEnvelope({
    headline,
    bias,
    intent: "cortex_read",
    sections,
    evidence,
    confidence,
    unavailableSources,
    followups: [`What does Cortex say about ${T} right now?`, ...CORTEX_FOLLOWUPS.slice(0, 2)],
  });
}

/** The rejection-row slice the skip builder needs (rejections.ts's ZeroDteRejectionRow). */
export type CortexSkipRowLike = {
  observed_at: string;
  session_date: string;
  ticker: string;
  gate_failed: string;
  reason: string | null;
  direction: string | null;
};

/**
 * The pinned WHY-of-record envelope for a SKIPPED ticker: the gate/Cortex blocks the
 * scanner persisted to zerodte_scan_rejections (a Cortex veto or net-negative block
 * arrives here as a `cortex_veto:<source>` / `cortex_net_negative` gate code, exactly
 * like a hard-gate block). PURE — callers do the IO.
 */
export function buildSkipCortexEnvelope(ticker: string, rows: CortexSkipRowLike[]): BieAnswerEnvelope {
  const T = ticker.toUpperCase();
  const cortexBlocks = rows.filter((r) => isCortexBlockCode(r.gate_failed));
  const headline =
    cortexBlocks.length > 0
      ? `Why ${T} was skipped — Cortex block on record`
      : `Why ${T} was skipped — gate block on record`;

  const evidence: BieEvidence[] = rows.slice(0, 8).map((r) => ({
    kind: "fact",
    text: `${zeroDteGateLabel(r.gate_failed)}${r.direction ? ` (${r.direction})` : ""}: ${r.reason ?? "no reason sentence recorded"}`,
    provenance: { source: "0DTE scan rejections", asOf: r.observed_at },
  }));

  return makeEnvelope({
    headline,
    bias: "neutral",
    intent: "cortex_read",
    sections: [
      {
        title: "Blocks of record",
        body:
          `${T} never reached the board this session — the scanner recorded ${rows.length} block state${rows.length === 1 ? "" : "s"} (one row per distinct gate/direction state, not per tick).` +
          (cortexBlocks.length > 0
            ? ` ${cortexBlocks.length} of them ${cortexBlocks.length === 1 ? "is" : "are"} Cortex evidence block${cortexBlocks.length === 1 ? "" : "s"} — the evidence layer said no even where the hard gates passed.`
            : " None of them came from the Cortex evidence layer — the hard gates blocked it first (the Cortex only runs on gate survivors)."),
        evidence,
        provenance: { source: "0DTE scan rejections (zerodte_scan_rejections)", asOf: rows[0]?.observed_at ?? null },
      },
    ],
    evidence: [],
    confidence: {
      level: "high",
      why: "Pinned block records from the scanner's own rejection log — the skip reasons of record, not a reconstruction.",
    },
    followups: [`What does Cortex say about ${T} right now?`, ...CORTEX_FOLLOWUPS.slice(0, 2)],
  });
}

/**
 * The LIVE composition envelope: what the Cortex would say RIGHT NOW. Honest by
 * construction — an all-absent verdict is rendered as "cannot see" (insufficient),
 * never as a neutral score, and every absent source is listed. PURE over a verdict.
 */
export function buildLiveCortexEnvelope(verdict: CortexVerdict): BieAnswerEnvelope {
  const T = verdict.ticker.toUpperCase();
  const active = verdict.vetoes.length + verdict.supports.length + verdict.opposes.length;

  if (active === 0) {
    // Every source reported absent — "the Cortex cannot see", not "sees nothing wrong".
    return makeEnvelope({
      headline: `Cortex cannot see ${T} right now — no verdict`,
      bias: "neutral",
      intent: "cortex_read",
      sections: [
        {
          title: "Why there is no verdict",
          body: `No Cortex source produced evidence for ${T} ${verdict.direction} (${verdict.absent.length} absent). That is an honest no-verdict — the composer never converts silence into a neutral score, and this read fabricates nothing.`,
          provenance: { source: "Night Hawk Cortex (live)", asOf: verdict.asOf },
        },
      ],
      evidence: [],
      confidence: { level: "insufficient", why: "Every Cortex source was absent this turn — nothing to grade." },
      unavailableSources: absentToUnavailable(verdict.absent),
      followups: CORTEX_FOLLOWUPS,
      asOf: verdict.asOf,
    });
  }

  const vetoed = verdict.vetoes.length > 0;
  const bias = biasForVerdict(verdict.direction, verdict.score, vetoed);
  // Mirror the gate bridge's decision table (cortex-gate.ts assessCortexVerdict):
  // veto blocks, net-negative blocks, net ≥ 0 passes.
  const wouldDo = vetoed
    ? "VETO — the gate stack would block this commit outright."
    : verdict.score < 0
      ? "NET-NEGATIVE — a gate-passing setup with net-negative evidence still doesn't print."
      : "PASS — the evidence layer would let a gate-passing commit through.";

  return makeEnvelope({
    headline: `Cortex live read — ${T} ${verdict.direction}: ${vetoed ? `BLOCKED by ${verdict.vetoes.length} veto${verdict.vetoes.length === 1 ? "" : "es"}` : `net score ${fmtSigned(verdict.score)}`}, conviction ${verdict.conviction}`,
    bias,
    intent: "cortex_read",
    sections: [
      {
        title: "Verdict right now",
        body: [
          `Net evidence score ${fmtSigned(verdict.score)} (Σ decayed, per-source-capped supports − Σ opposes) · conviction ${verdict.conviction} · ${verdict.supports.length} supporting vs ${verdict.opposes.length} opposing item${verdict.opposes.length === 1 ? "" : "s"} · ${verdict.absent.length} of the sources absent.`,
          `If a gate-passing ${verdict.direction} setup printed this instant: ${wouldDo}`,
          `This is a LIVE composition (as of ${verdict.asOf}) — what the Cortex would say right now, not a commitment record. A committed play's verdict is pinned at commit time on its ledger row.`,
        ].join("\n"),
        bias,
        provenance: { source: "Night Hawk Cortex (live)", asOf: verdict.asOf, freshness: "live" },
      },
    ],
    evidence: envelopeEvidenceFrom([...verdict.vetoes, ...verdict.supports, ...verdict.opposes]),
    confidence:
      verdict.absent.length >= 5
        ? { level: "low", why: `Only ${8 - verdict.absent.length} of 8 Cortex sources could answer — thin evidence base.` }
        : { level: "moderate", why: "Deterministic live composition over the platform's own readers — evidence, not opinion; not a pinned commit record." },
    unavailableSources: absentToUnavailable(verdict.absent),
    followups: CORTEX_FOLLOWUPS,
    asOf: verdict.asOf,
  });
}

/** Honest hard-failure envelope: the live composition itself failed. Never fabricated. */
export function buildCortexUnavailableEnvelope(ticker: string | null, reason: string): BieAnswerEnvelope {
  const T = ticker ? ticker.toUpperCase() : null;
  return makeEnvelope({
    headline: T ? `Cortex read unavailable for ${T}` : "Cortex read unavailable",
    bias: "neutral",
    intent: "cortex_read",
    sections: [
      {
        // No `unavailable` marker here on purpose: the marker suppresses the body in
        // the markdown rendering, and this body IS the honest answer.
        title: "No verdict",
        body: `The Cortex composition could not run (${reason}). No verdict exists this turn — nothing is fabricated in its place. The 0DTE hard gates are unaffected: they are the safety floor and fail closed on their own inputs.`,
      },
    ],
    evidence: [],
    confidence: { level: "insufficient", why: `Cortex composition failed (${reason}).` },
    unavailableSources: [{ source: "Night Hawk Cortex", reason }],
    followups: CORTEX_FOLLOWUPS,
  });
}

// ── IO: ledger / rejections / live composition (dynamic RELATIVE imports) ──────────

/** Index roots share a chain family — an "SPX" ask must find the SPXW ledger row. */
function tickerMatches(rowTicker: string, asked: string): boolean {
  const a = rowTicker.toUpperCase();
  const b = asked.toUpperCase();
  if (a === b) return true;
  const fam = (t: string) => (t === "SPXW" ? "SPX" : t === "NDXP" ? "NDX" : t === "RUTW" ? "RUT" : t);
  return fam(a) === fam(b);
}

async function ledgerRowsFor(sessionDate?: string): Promise<ZeroDteSetupLogRow[]> {
  try {
    if (sessionDate) {
      // Explicit (possibly past) session → the dated ledger reader directly.
      const db = await import("../db");
      if (!db.dbConfigured()) return [];
      return await db.fetchZeroDteSetupLog(sessionDate).catch(() => []);
    }
    // Default (today) → the scanner's own ledger reader (same rows the board serves).
    const { readZeroDteLedger } = await import("../zerodte/scan");
    return await readZeroDteLedger();
  } catch {
    return [];
  }
}

/**
 * The pinned truth for a committed/skipped ticker this session (or `sessionDate`):
 * ledger row (entry_context.cortex + exit + gate calibration) first, the scanner's
 * rejection log second. Returns null when NO decision of record exists — the caller
 * then falls through to the live composition (or answers honestly).
 */
export async function readCortexForPlay(ticker: string, sessionDate?: string): Promise<BieComposed | null> {
  const T = ticker.toUpperCase().trim();
  if (!T) return null;

  const rows = await ledgerRowsFor(sessionDate);
  const row = rows.find((r) => tickerMatches(r.ticker, T));
  if (row) {
    const envelope = buildPinnedCortexEnvelope(row);
    return {
      answer: envelope.markdown,
      context: {
        mode: "pinned",
        ticker: row.ticker,
        session_date: row.session_date,
        cortex: row.entry_context?.cortex ?? null,
        exit: row.entry_context?.exit ?? null,
      },
      envelope,
    };
  }

  // No committed play — a skip record still IS a decision of record.
  try {
    const { fetchZeroDteRejections } = await import("../zerodte/rejections");
    const all = await fetchZeroDteRejections({ ticker: T, limit: 12 });
    const rej = sessionDate ? all.filter((r) => r.session_date === sessionDate) : all;
    if (rej.length > 0) {
      const envelope = buildSkipCortexEnvelope(T, rej);
      return {
        answer: envelope.markdown,
        context: { mode: "skip", ticker: T, rejections: rej },
        envelope,
      };
    }
  } catch {
    // Rejection log unreadable — fall through; the caller goes live/honest.
  }
  return null;
}

/**
 * Live composition for ANY ticker: fetchCortexInputs (fail-soft per source, absent
 * markers preserved) → composeCortexEvidence → envelope. Never throws — a hard
 * failure returns the honest "no verdict" envelope.
 */
export async function composeCortexLive(ticker: string, direction: CortexDirection): Promise<BieComposed> {
  const T = ticker.toUpperCase().trim();
  try {
    const [{ fetchCortexInputs }, { composeCortexEvidence }] = await Promise.all([
      import("../nighthawk/cortex/fetch"),
      import("../nighthawk/cortex/compose"),
    ]);
    const inputs = await fetchCortexInputs(T, direction, { now: new Date() });
    const verdict = composeCortexEvidence(inputs);
    const envelope = buildLiveCortexEnvelope(verdict);
    return { answer: envelope.markdown, context: { mode: "live", verdict }, envelope };
  } catch (err) {
    const cls = err instanceof Error ? err.name || err.constructor.name : typeof err;
    const envelope = buildCortexUnavailableEnvelope(T, cls);
    return { answer: envelope.markdown, context: { mode: "unavailable", reason: cls }, envelope };
  }
}

/**
 * Session overview for a ticker-less decision question ("why was the top play
 * picked", "explain today's cortex calls"): one line per committed play (pinned
 * verdict or honest abstain) plus every Cortex-blocked skip. Honest empty state.
 */
async function composeCortexSessionOverview(): Promise<BieComposed> {
  const rows = await ledgerRowsFor();
  const lines: BieEvidence[] = [];
  for (const r of rows.slice(0, 10)) {
    const view = readCortexView(r.entry_context?.cortex ?? null);
    const contract = `${r.ticker} ${fmtNum(r.top_strike)}${r.direction === "long" ? "c" : "p"}`;
    const text =
      view == null
        ? `${contract}: committed on the hard gates alone — no Cortex verdict pinned (pre-wire-in or refresh lane).`
        : view.abstained
          ? `${contract}: Cortex ABSTAINED at commit (${view.reason})`
          : `${contract}: Cortex ${view.decision ?? "PASS"} — score ${fmtSigned(view.verdict.score)}, conviction ${view.verdict.conviction}, ${view.verdict.vetoes.length} vetoes.`;
    lines.push({ kind: "fact", text, provenance: { source: "0DTE ledger (entry_context.cortex)" } });
  }

  let cortexSkips: CortexSkipRowLike[] = [];
  try {
    const { fetchZeroDteRejections } = await import("../zerodte/rejections");
    cortexSkips = (await fetchZeroDteRejections({ limit: 40 })).filter((r) => isCortexBlockCode(r.gate_failed));
  } catch {
    /* rejection log unreadable — the plays half still answers */
  }
  for (const r of cortexSkips.slice(0, 6)) {
    lines.push({
      kind: "fact",
      text: `${r.ticker} skipped — ${zeroDteGateLabel(r.gate_failed)}: ${r.reason ?? "no reason sentence recorded"}`,
      provenance: { source: "0DTE scan rejections", asOf: r.observed_at },
    });
  }

  if (lines.length === 0) {
    const envelope = makeEnvelope({
      headline: "No 0DTE decisions on record this session",
      bias: "neutral",
      intent: "cortex_read",
      sections: [
        {
          title: "Nothing to explain yet",
          body: "No committed plays and no Cortex-blocked skips are on record for this session. Name a ticker (e.g. “cortex NVDA”) for a live Cortex read — what the evidence composer would say right now.",
        },
      ],
      evidence: [],
      confidence: { level: "high", why: "Empty ledger + rejection log read directly — an empty record is itself the honest answer." },
      followups: ["cortex SPY", "Show today's 0DTE plays", "What is the Cortex?"],
    });
    return { answer: envelope.markdown, context: { mode: "session", plays: 0, cortex_skips: 0 }, envelope };
  }

  const envelope = makeEnvelope({
    headline: `Cortex decisions this session — ${rows.length} committed play${rows.length === 1 ? "" : "s"}, ${cortexSkips.length} Cortex-blocked skip${cortexSkips.length === 1 ? "" : "s"}`,
    bias: "neutral",
    intent: "cortex_read",
    sections: [
      {
        title: "Decisions of record",
        body: "One line per decision — ask about a specific ticker (“why did we commit NVDA”) for the full pinned evidence table.",
        evidence: lines,
      },
    ],
    evidence: [],
    confidence: { level: "high", why: "Pinned commit/skip records from the ledger and rejection log — decisions of record, not reconstructions." },
    followups: rows[0] ? [`Why did we commit ${rows[0].ticker}?`, ...CORTEX_FOLLOWUPS.slice(0, 2)] : CORTEX_FOLLOWUPS,
  });
  return {
    answer: envelope.markdown,
    context: { mode: "session", plays: rows.length, cortex_skips: cortexSkips.length },
    envelope,
  };
}

/**
 * Router glue for the `cortex_read` intent: pinned record when one exists this
 * session (a committed play or a logged skip is the WHY of record and always wins),
 * live composition otherwise; ticker-less questions get the session overview.
 */
export async function composeCortexRead(ticker: string | null, question: string): Promise<BieComposed> {
  if (!ticker) return composeCortexSessionOverview();
  const pinned = await readCortexForPlay(ticker);
  if (pinned) return pinned;
  return composeCortexLive(ticker, directionFromQuestion(question));
}

// ── Compact citation for the OTHER intents (verdict / advice / plays / SPX why) ────

/** Compact Cortex citation another synthesis folds in alongside its own inputs. */
export type CortexCitation = {
  mode: "pinned" | "live" | "unavailable";
  /** One-line summary ("Cortex PASS — score +1.85, conviction A" / abstain / outage). */
  headline: string;
  /** Up to 3 detail lines (every veto first, then the top evidence by |weight|). */
  lines: string[];
  asOf: string | null;
};

function topByWeight(items: CortexEvidenceItemLike[], n: number): CortexEvidenceItemLike[] {
  return [...items].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, n);
}

function citationFromView(view: PaneCortexView, pinnedNote: string): CortexCitation {
  if (view.abstained) {
    return { mode: "pinned", headline: `Cortex ABSTAINED ${pinnedNote}: ${view.reason}`, lines: [], asOf: null };
  }
  const v = view.verdict;
  const lines = [
    ...v.vetoes.map(evidenceText),
    ...topByWeight([...v.supports, ...v.opposes], Math.max(0, 3 - v.vetoes.length)).map(evidenceText),
  ].slice(0, 3);
  return {
    mode: "pinned",
    headline: `Cortex ${view.decision ?? "PASS"} ${pinnedNote}: score ${fmtSigned(v.score)}, conviction ${v.conviction}`,
    lines,
    asOf: v.asOf ?? null,
  };
}

/**
 * The Cortex evidence another intent cites for a 0DTE-relevant ticker: PINNED when a
 * play exists this session (commit-time truth beats any re-derivation), LIVE otherwise
 * (only when `allowLive` — the heavier composition is opt-in per call site), honest
 * "unavailable" on outage. Returns null only when there is genuinely nothing to cite
 * (no pinned record and live not requested). Never throws.
 */
export async function cortexCitationFor(
  ticker: string,
  opts: { direction?: CortexDirection; allowLive?: boolean } = {}
): Promise<CortexCitation | null> {
  const T = ticker.toUpperCase().trim();
  if (!T) return null;
  try {
    const rows = await ledgerRowsFor();
    const row = rows.find((r) => tickerMatches(r.ticker, T));
    if (row) {
      const view = readCortexView(row.entry_context?.cortex ?? null);
      if (view) return citationFromView(view, `(pinned at commit, ${row.session_date})`);
      return {
        mode: "pinned",
        headline: `Cortex: no verdict pinned on the ${row.ticker} play of record (${row.session_date}) — gates-only commit.`,
        lines: [],
        asOf: null,
      };
    }
    if (!opts.allowLive) return null;
    const [{ fetchCortexInputs }, { composeCortexEvidence }] = await Promise.all([
      import("../nighthawk/cortex/fetch"),
      import("../nighthawk/cortex/compose"),
    ]);
    const verdict = composeCortexEvidence(await fetchCortexInputs(T, opts.direction ?? "long", { now: new Date() }));
    const active = verdict.vetoes.length + verdict.supports.length + verdict.opposes.length;
    if (active === 0) {
      return {
        mode: "unavailable",
        headline: `Cortex cannot see ${T} right now (${verdict.absent.length} sources absent) — no verdict.`,
        lines: [],
        asOf: verdict.asOf,
      };
    }
    return {
      mode: "live",
      headline: `Cortex (live, ${verdict.direction}): ${verdict.vetoes.length > 0 ? `VETO — ${verdict.vetoes.length} hard block${verdict.vetoes.length === 1 ? "" : "s"}` : `net score ${fmtSigned(verdict.score)}`}, conviction ${verdict.conviction}${verdict.absent.length ? ` (${verdict.absent.length} sources absent)` : ""}`,
      lines: [
        ...verdict.vetoes.map(evidenceText),
        ...topByWeight([...verdict.supports, ...verdict.opposes], Math.max(0, 3 - verdict.vetoes.length)).map(evidenceText),
      ].slice(0, 3),
      asOf: verdict.asOf,
    };
  } catch (err) {
    const cls = err instanceof Error ? err.name || err.constructor.name : typeof err;
    return { mode: "unavailable", headline: `Cortex read unavailable this turn (${cls}).`, lines: [], asOf: null };
  }
}

/**
 * One pinned commit-time Cortex line per ledger ticker (uppercased key), for the
 * zerodte_plays composer — ONE ledger read for the whole board, not one per play.
 * Rows with no pinned verdict get an honest "gates-only" line. Never throws.
 */
export async function pinnedCortexLinesForSession(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = await ledgerRowsFor();
    for (const r of rows) {
      const view = readCortexView(r.entry_context?.cortex ?? null);
      const line =
        view == null
          ? "Cortex: no verdict pinned — gates-only commit."
          : view.abstained
            ? `Cortex ABSTAINED at commit: ${view.reason}`
            : `Cortex ${view.decision ?? "PASS"} at commit — score ${fmtSigned(view.verdict.score)}, conviction ${view.verdict.conviction}${view.verdict.vetoes.length ? ` (${view.verdict.vetoes.length} vetoes)` : ""}${view.verdict.supports[0] ? `; top: ${evidenceText(topByWeight(view.verdict.supports, 1)[0]!)}` : ""}`;
      out.set(r.ticker.toUpperCase(), line);
    }
  } catch {
    /* fail-soft: the plays list renders without cortex lines */
  }
  return out;
}

/** Markdown block for a citation — the string composers append to their answers. */
export function renderCortexCitation(c: CortexCitation): string {
  const label =
    c.mode === "pinned"
      ? "**Cortex evidence (0DTE, pinned):**"
      : c.mode === "live"
        ? "**Cortex evidence (0DTE, live):**"
        : "**Cortex evidence (0DTE):**";
  const out = [`${label} ${c.headline}`];
  for (const l of c.lines) out.push(`- ${l}`);
  return out.join("\n");
}
