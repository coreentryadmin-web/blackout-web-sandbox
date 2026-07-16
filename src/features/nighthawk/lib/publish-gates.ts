// PR-N3 (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §N-3): publish-time sanity gates for
// the overnight edition. The measured problem: 14/24 LONG plays published with band-tops
// >3% below prior close, and the six thin-edition backfill plays sat 6.4%–45.5% below the
// market (DELL 2026-07-08: band $226.82–227.27, stock at $417, target $469.47 — stamped
// conviction "A" mechanically). NO band-vs-spot or achievable-target check existed anywhere
// in the publish path — these unfillable picks are both member-hostile and the source of
// the phantom-win record (N-2).
//
// DESIGN:
//  - Pure module (no I/O, no db) — unit-testable with fixture plays like the rest of this
//    directory. The builder calls applyNighthawkPublishGates at STAGE 6.
//  - The gates threshold the SAME geometry the publish-context pin records
//    (computeNighthawkPublishGeometry, publish-context.ts) — one computation, so the
//    number that blocked a play is byte-identical to the number pinned as evidence.
//  - FAIL-CLOSED: a play whose geometry can't be computed does NOT publish
//    (`geometry_unknown`) — a pick we can't sanity-check is not a pick. This is the
//    opposite polarity of the pin itself (which is fail-soft) because the pin is
//    evidence while the gate is a publish decision.
//  - BLOCKED plays persist as nighthawk_rejected audit rows (play-outcomes.ts stage
//    "publish_gate") and their gate result is pinned into publish_context for published
//    plays too (PASS with margins), so counterfactual grading can judge the gates later —
//    same skip-grading philosophy as the 0DTE rejection funnel.

import type { PlaybookPlay } from "./types";
import type { TickerDossier } from "./dossier";
import type { ScoredCandidate } from "./scorer";
import {
  computeNighthawkPublishGeometry,
  type NighthawkPublishGeometry,
} from "./publish-context";
import {
  isBeforeOrAtMarketCloseEt,
  mostRecentTradingDayEt,
  previousTradingDayEt,
} from "./session";

// ── Gate thresholds (named constants — every number here is calibratable against the
//    margins pinned in publish_context.gates.checks) ────────────────────────────────────

/**
 * G-N1 band-vs-spot (`band_detached`): |spot → fill-edge| may not exceed this % of spot.
 *
 * WHY 3.5 (Phase 3 tuning): overnight plays target next-session action where the open can
 * gap 1-2% from prior close — a 2.5% gate was blocking legitimate entries that sit a normal
 * overnight gap away from the evening's spot. 3.5% still catches the catastrophic class
 * (6.4%–45.5% DELL backfills, 14/24 >3% detached plays) while giving next-session entries
 * the ~1% extra headroom an overnight gap needs. Calibratable from pinned PASS margins.
 */
export const GATE_BAND_MAX_DISTANCE_PCT = 3.5;

/**
 * G-N2 achievable target (`target_unreachable`): |fill-edge → target| may not exceed
 * K × ATR14. Measured from the FILL EDGE, not spot, because that is the entry the play
 * grades from (and G-N1 already pins the edge near spot for anything that publishes).
 *
 * WHY 2.0 (Phase 3 tuning): overnight plays are published the evening before for
 * next-session action. The deterministic path builds targets from real support/resistance
 * levels which can legitimately sit 1.5-2× ATR from entry on a momentum name with a
 * near-term catalyst. K=1.5 was blocking too many valid plays built from real levels;
 * K=2.0 allows strong-expansion targets while still catching the catastrophic class
 * (+8.6%..+106.6% targets ≈ 3×–20×+ ATR). The failing class remains blocked by 5×+.
 */
export const GATE_TARGET_MAX_ATR_MULTIPLE = 2.0;

export type NighthawkGateCode =
  | "band_detached" // G-N1
  | "target_unreachable" // G-N2
  | "stale_quote_basis" // G-N3
  | "geometry_unknown"; // fail-closed: gate inputs missing/uncomputable

export type NighthawkGateBlock = {
  code: NighthawkGateCode;
  /** Human-readable, member-safe explanation with the live numbers baked in. */
  reason: string;
  threshold: number | string | null;
  value: number | string | null;
};

/** One evaluated gate — recorded for PASSES too, so publish_context carries the margin
 *  (how close a published play came to each threshold): the calibration substrate. */
export type NighthawkGateCheck = {
  code: NighthawkGateCode;
  passed: boolean;
  value: number | string | null;
  threshold: number | string | null;
};

export type NighthawkPublishGateResult = {
  verdict: "PUBLISH" | "BLOCK";
  /** Empty on PUBLISH. Every failed gate, not just the first — a DELL-class play should
   *  show band_detached AND target_unreachable so calibration sees the full signature. */
  blocks: NighthawkGateBlock[];
  /** All evaluated gates with their raw value vs threshold (PASS margins included). */
  checks: NighthawkGateCheck[];
};

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * G-N3's expected quote basis: which ET session(s) a fresh quote could legitimately be
 * from at `now`. After the close of a trading day (or on a weekend/holiday) the last
 * COMPLETED session is the only honest basis. DURING a trading session the provider may
 * serve either today's in-progress daily bar or the prior session's close, so both are
 * acceptable — the gate exists to catch a quote basis DAYS old (the six backfill plays'
 * 6.4%–45.5% detachment signature: geometry built from a stale dossier, e.g. a
 * checkpoint-resume carrying a prior night's staged tech cards), not to flag an intraday
 * force-rebuild race.
 */
export function acceptableQuoteSessionsEt(now: Date = new Date()): string[] {
  const latest = mostRecentTradingDayEt(now);
  return isBeforeOrAtMarketCloseEt(latest, now) ? [latest, previousTradingDayEt(latest)] : [latest];
}

/**
 * Evaluate the PR-N3 publish gates for ONE play. Pure: same inputs ⇒ same verdict.
 *
 * `quoteSessions` — the acceptable quote-basis sessions (see acceptableQuoteSessionsEt);
 * injected rather than clock-read here so the builder evaluates every play against ONE
 * consistent basis and tests are hermetic.
 */
export function evaluateNighthawkPublishGates(opts: {
  play: PlaybookPlay;
  dossier: TickerDossier | null | undefined;
  quoteSessions: string[];
}): NighthawkPublishGateResult {
  const geo: NighthawkPublishGeometry = computeNighthawkPublishGeometry(opts.play, opts.dossier);
  const blocks: NighthawkGateBlock[] = [];
  const checks: NighthawkGateCheck[] = [];

  // ── Fail-closed pre-condition: every input the three gates threshold on must exist.
  // A missing tech card / unparseable band / absent ATR means the play CANNOT be
  // sanity-checked — and per §N-3 that is itself disqualifying, because the six
  // placeholder backfill plays are exactly what "we published without being able to
  // check" looks like in production.
  const missing: string[] = [];
  if (geo.spot == null) missing.push("spot");
  if (geo.fill_edge == null) missing.push("fill_edge");
  if (geo.band_distance_pct == null) missing.push("band_distance_pct");
  if (geo.target == null) missing.push("target");
  if (geo.atr14 == null || geo.atr14 <= 0) missing.push("atr14");
  if (missing.length) {
    const block: NighthawkGateBlock = {
      code: "geometry_unknown",
      reason: `publish-time geometry could not be computed (missing: ${missing.join(", ")}) — a pick we can't sanity-check is not a pick`,
      threshold: null,
      value: missing.join(", "),
    };
    return {
      verdict: "BLOCK",
      blocks: [block],
      checks: [{ code: "geometry_unknown", passed: false, value: block.value, threshold: null }],
    };
  }
  checks.push({ code: "geometry_unknown", passed: true, value: null, threshold: null });

  // ── G-N1 band-vs-spot ────────────────────────────────────────────────────────────
  const bandDist = round4(geo.band_distance_pct!);
  const bandOk = Math.abs(bandDist) <= GATE_BAND_MAX_DISTANCE_PCT;
  checks.push({
    code: "band_detached",
    passed: bandOk,
    value: bandDist,
    threshold: GATE_BAND_MAX_DISTANCE_PCT,
  });
  if (!bandOk) {
    blocks.push({
      code: "band_detached",
      reason: `entry band edge $${geo.fill_edge} sits ${bandDist}% from spot $${geo.spot} (|max| ${GATE_BAND_MAX_DISTANCE_PCT}%) — not fillable as published`,
      threshold: GATE_BAND_MAX_DISTANCE_PCT,
      value: bandDist,
    });
  }

  // ── G-N2 achievable target ───────────────────────────────────────────────────────
  const targetAtrMultiple = round4(Math.abs(geo.target! - geo.fill_edge!) / geo.atr14!);
  const targetOk = targetAtrMultiple <= GATE_TARGET_MAX_ATR_MULTIPLE;
  checks.push({
    code: "target_unreachable",
    passed: targetOk,
    value: targetAtrMultiple,
    threshold: GATE_TARGET_MAX_ATR_MULTIPLE,
  });
  if (!targetOk) {
    blocks.push({
      code: "target_unreachable",
      reason: `target $${geo.target} is ${targetAtrMultiple}× ATR14 ($${geo.atr14}) from the entry edge $${geo.fill_edge} (max ${GATE_TARGET_MAX_ATR_MULTIPLE}×) — not achievable in the one-session grading horizon`,
      threshold: GATE_TARGET_MAX_ATR_MULTIPLE,
      value: targetAtrMultiple,
    });
  }

  // ── G-N3 stale-quote guard ───────────────────────────────────────────────────────
  // When price_session is unknown (null from hourly fallback with no daily bar), skip
  // the stale-quote check — the play was still built from current data, just undated.
  // Only block when price_session is KNOWN but STALE (wrong trading day). Off-hours and
  // staging builds without a daily bar are legitimate; failing them here turns a
  // recoverable data gap into a phantom defect.
  const quoteOk = geo.quote_session == null || opts.quoteSessions.includes(geo.quote_session);
  checks.push({
    code: "stale_quote_basis",
    passed: quoteOk,
    value: geo.quote_session,
    threshold: opts.quoteSessions.join("|"),
  });
  if (!quoteOk && geo.quote_session != null) {
    blocks.push({
      code: "stale_quote_basis",
      reason: `spot quote is from ${geo.quote_session}, not the session being published from (${opts.quoteSessions.join(" or ")}) — the stale-backfill signature (§N-3: six plays 6.4%–45.5% detached)`,
      threshold: opts.quoteSessions.join("|"),
      value: geo.quote_session,
    });
  }

  return { verdict: blocks.length ? "BLOCK" : "PUBLISH", blocks, checks };
}

export type NighthawkGateBlockedPlay = {
  ticker: string;
  play: PlaybookPlay;
  result: NighthawkPublishGateResult;
  /** The scorer's confluence read for the rejection audit row (null when unavailable). */
  scored: ScoredCandidate | null;
};

/**
 * Gate a whole edition's final plays. Returns the plays that may publish (re-ranked
 * 1..n), the blocked plays (with their full gate result, for the nighthawk_rejected
 * audit rows), and the per-ticker results map (for the publish_context pin — PASSES
 * included, margins and all).
 *
 * Fail-closed even on an evaluator throw: a play whose gate evaluation exploded is
 * BLOCKED as geometry_unknown, never silently published (the inverse of the pin's
 * fail-soft rule — a publish DECISION must not degrade open).
 */
export function applyNighthawkPublishGates(opts: {
  plays: PlaybookPlay[];
  dossiers: Record<string, TickerDossier>;
  quoteSessions: string[];
}): {
  passing: PlaybookPlay[];
  blocked: NighthawkGateBlockedPlay[];
  results: Record<string, NighthawkPublishGateResult>;
} {
  const passing: PlaybookPlay[] = [];
  const blocked: NighthawkGateBlockedPlay[] = [];
  const results: Record<string, NighthawkPublishGateResult> = {};

  for (const play of opts.plays) {
    const ticker = String(play?.ticker ?? "").toUpperCase();
    const dossier = ticker ? (opts.dossiers?.[ticker] ?? opts.dossiers?.[play.ticker] ?? null) : null;
    let result: NighthawkPublishGateResult;
    try {
      result = evaluateNighthawkPublishGates({ play, dossier, quoteSessions: opts.quoteSessions });
    } catch (err) {
      const reason = `gate evaluation failed (${err instanceof Error ? err.message : String(err)}) — fail-closed`;
      result = {
        verdict: "BLOCK",
        blocks: [{ code: "geometry_unknown", reason, threshold: null, value: null }],
        checks: [{ code: "geometry_unknown", passed: false, value: null, threshold: null }],
      };
    }
    if (ticker) results[ticker] = result;
    if (result.verdict === "PUBLISH") {
      passing.push(play);
    } else {
      blocked.push({ ticker, play, result, scored: dossier?.scored ?? null });
    }
  }

  return {
    passing: passing.map((p, i) => ({ ...p, rank: i + 1 })),
    blocked,
    results,
  };
}

/** The recap-only reason line when the gates zero the whole edition — zero honest plays
 *  beats one unfillable play (tonight's real 7/14 edition was already honestly zero-play). */
export function publishGateRecapReason(blocked: NighthawkGateBlockedPlay[]): string {
  const detail = blocked
    .map((b) => `${b.ticker}: ${b.result.blocks.map((x) => x.code).join(",")}`)
    .join("; ");
  return `Publish gates blocked all ${blocked.length} play(s) (${detail}) — zero honest plays beats an unfillable pick.`;
}

// ── Best-available promotion (PR-N13): when the gates zero the entire edition,
// promote the top-scoring blocked plays with warnings instead of publishing zero.
// The pipeline MUST always surface picks for tomorrow — a member sees a warning
// caveat, never an empty playbook.
//
// Ranking: fewer gate failures is strictly better (a play that only fails one gate
// is more trustworthy than one that fails all three). Within the same failure
// count, the play's original confluence score breaks the tie.

/** Compute a promotion priority for a blocked play: lower = better candidate for
 *  promotion. A single-gate failure with a high score is the best rescue pick. */
function promotionBadness(b: NighthawkGateBlockedPlay): number {
  const failCount = b.result.blocks.length;
  const score = b.play.score ?? 0;
  return failCount * 1000 - score;
}

/**
 * Promote the top-scoring blocked plays into publishable plays with gate_promoted
 * and gate_warnings flags. Called when all plays failed the publish gates and the
 * edition would otherwise be zero-play.
 *
 * Returns up to `count` plays ranked 1..N, each carrying gate_promoted:true and
 * gate_warnings with the human-readable failure reasons. The plays are valid
 * PlaybookPlay objects ready for upsert — the caller just publishes them.
 */
export function promoteTopBlocked(
  blocked: NighthawkGateBlockedPlay[],
  count: number,
): PlaybookPlay[] {
  if (!blocked.length || count <= 0) return [];

  const sorted = [...blocked].sort((a, b) => promotionBadness(a) - promotionBadness(b));

  return sorted.slice(0, count).map((b, i) => ({
    ...b.play,
    rank: i + 1,
    gate_promoted: true,
    gate_warnings: b.result.blocks.map((block) => block.reason),
  }));
}
