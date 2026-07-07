/**
 * SPX Slayer — SHADOW-MODE factor scoring, precedent-search edition. Same
 * non-negotiable contract as every sibling in this family (read
 * src/lib/spx-signals-shadow.ts's module doc first if you haven't):
 * `computeSpxConfluence()` (src/lib/spx-signals.ts) never imports this file,
 * and this file never imports FROM spx-signals.ts — `git grep
 * spx-signals-shadow-precedents src/lib/spx-signals.ts` returns nothing, so
 * "this cannot touch the live score" is visible by inspection, not just by
 * test. Same n>=10-evidence-before-acting philosophy as every sibling
 * (bie/calibration.ts's `MIN_EVIDENCE = 10`) — this module only ever computes
 * what a candidate factor WOULD have contributed, logged next to the real
 * score for later correlation, with zero live effect until a future,
 * separately-reviewed change promotes it into computeSpxConfluence()'s own
 * `score +=` chain.
 *
 * WHY THIS FACTOR, AND WHY NOW: `src/lib/bie/precedent-search.ts`'s
 * `findSimilarPrecedents()` (Largo's `get_similar_precedents` tool — "has a
 * setup like this happened before, and what happened") has existed since BIE
 * Stage 4, but `alert_audit_log.outcome` sat at NULL forever — nothing ever
 * wrote to it — so `fetchResolvedAlertAuditRows()` matched zero rows and the
 * precedent store has been silently empty since it shipped (see
 * docs/audit/FINDINGS.md's "`alert_audit_log.outcome` was NEVER written by
 * anything" entry). `src/lib/bie/alert-outcome-sync.ts` fixed that
 * propagation gap, so `get_similar_precedents` finally has real graded rows
 * to return. This module is what happens when SPX Slayer's OWN engine asks
 * that same question about its own current setup: query the precedent store
 * for the most similar historical SPX-relevant setups (0DTE Command, Night
 * Hawk, and SPX Slayer's own `spx_claude_play` alerts all feed the same
 * `alert_audit_log` table — see precedent-search.ts's `ALERT_TYPE_LABEL`) and
 * derive a provisional weight from how they actually resolved.
 *
 * BRAND-NEW DATASET, HONESTLY REPRESENTED: the outcome-propagation fix landed
 * the same day as this factor. The precedent corpus is expected to be
 * near-empty right now and will only fill in as `alert-outcome-sync` grades
 * more history and the nightly `ingestAlertPrecedents()` embeds it. A sparse
 * or empty precedent search result is the EXPECTED current state, not a bug
 * — see `MIN_TOTAL_PRECEDENTS` below for how this module represents that
 * honestly (`available:false`, never a fabricated confident reading from 1-2
 * data points).
 *
 * WHAT THE PURE FUNCTIONS BELOW DO NOT DO: `findSimilarPrecedents()` returns
 * `RetrievedChunk[]` — free-text descriptions (see `describeAuditRow()` in
 * precedent-search.ts), not structured columns. There is no separate
 * "direction"/"outcome" field on a retrieved chunk to read directly, so
 * `parsePrecedentDirection`/`parsePrecedentOutcome` below parse those two
 * facts back out of the deterministic, template-generated description text
 * itself (never LLM-generated, so this is a stable, testable contract, not
 * NLP guessing) — see each function's own doc for the exact template it
 * expects.
 *
 * Everything below is a pure function: no DB reads, no fetch, no bare
 * `Date.now()`/`new Date()` — fully unit-testable and structurally incapable
 * of a side effect on the real signal. The actual `findSimilarPrecedents()`
 * call and the "is the search infra even confirmed available" check live in
 * the wiring function, `logSpxPrecedentsShadowFactor`
 * (src/lib/providers/spx-signal-log.ts) — same split as the risk-reversal-
 * skew and mega-cap-catalyst sibling factors (pure scorer here, fetch/wiring
 * there), not the ecosystem-context sibling's "fetch wrapper lives in the
 * sibling file too" shape, because there is no dedicated BIE aggregate
 * function to wrap here — `findSimilarPrecedents()` IS the whole read.
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";
import type { ShadowFactorObservation } from "@/features/spx/lib/spx-signals-shadow";

export type { ShadowFactorObservation } from "@/features/spx/lib/spx-signals-shadow";

/** The slice of BIE's `RetrievedChunk` (src/lib/bie/knowledge.ts) this module
 *  actually reads — kept narrow (rather than accepting the whole type) so a
 *  future field added to RetrievedChunk can't silently change this module's
 *  behavior, same rationale as the ecosystem sibling's `EcosystemShadowInput`. */
export type PrecedentHit = { chunk: string; similarity: number };

export const PRECEDENT_AGREEMENT_FACTOR = "precedent_search_agreement";

/**
 * Reuses Largo's own `get_similar_precedents` call shape exactly
 * (src/lib/largo/run-tool.ts: `findSimilarPrecedents(query, 5)`) rather than
 * inventing a different k for this call site.
 */
export const PRECEDENT_SEARCH_K = 5;

/**
 * "Not enough precedents yet" floor, per this factor's explicit brand-new-
 * dataset mandate (see module doc above): require a majority of the
 * requested `PRECEDENT_SEARCH_K` to have actually come back before this
 * factor says anything at all, so it doesn't try to speak from 1-2 sparse
 * hits while `alert-outcome-sync` is still backfilling history. `ceil(5/2)`
 * — "mostly" (per the task's own framing: "if the 5 most similar historical
 * setups mostly resolved...") reads as a simple majority of the returned set.
 */
export const MIN_TOTAL_PRECEDENTS = 3;

/**
 * A single directionally-informative precedent (the search "confirmed
 * available" and returned enough total hits) still isn't enough to justify
 * anything above this family's own floor weight — one historical data point
 * agreeing or disagreeing isn't "mostly" anything. Only kicks in once
 * `usable` (same-direction + cleanly target/stop-resolved) is 2 or more.
 */
const MIN_USABLE_FOR_TIERED_WEIGHT = 2;

/**
 * Provisional weight scale — NOT derived from any backtest (see
 * spx-signals-shadow.ts's SEVERITY_WEIGHT comment for the full rationale of
 * why shadow weights are chosen this way at all). Deliberately capped LOWER
 * than most siblings' own ceilings: this is the single least-proven factor in
 * the family (the underlying corpus is hours old as of this factor shipping,
 * see module doc), so its own ceiling (8) is pinned to the ecosystem
 * sibling's own "cross-instrument agreement" STRONG tier
 * (spx-signals-shadow-ecosystem.ts's `ZERODTE_WEIGHT_STRONG`) rather than
 * reaching for the engine's ±18 GEX-wall ceiling — still inside the real
 * engine's overall ±3-to-±18 range, just at the conservative end of it.
 *  - ratio >= 0.8 (near-unanimous agreement among usable precedents): 8
 *  - ratio >= 0.5 (clear majority): 5
 *  - otherwise (any nonzero lean, or usable < MIN_USABLE_FOR_TIERED_WEIGHT): 3
 *    (matches the family's own floor — spx-signals-shadow.ts's LOW anomaly
 *    tier — never zero for a real, if thin, directional lean).
 */
const PRECEDENT_RATIO_STRONG = 0.8;
const PRECEDENT_RATIO_MODERATE = 0.5;
const PRECEDENT_WEIGHT_STRONG = 8;
const PRECEDENT_WEIGHT_MODERATE = 5;
const PRECEDENT_WEIGHT_WEAK = 3;

function precedentMagnitude(absRatio: number, usable: number): number {
  if (usable < MIN_USABLE_FOR_TIERED_WEIGHT) return PRECEDENT_WEIGHT_WEAK;
  if (absRatio >= PRECEDENT_RATIO_STRONG) return PRECEDENT_WEIGHT_STRONG;
  if (absRatio >= PRECEDENT_RATIO_MODERATE) return PRECEDENT_WEIGHT_MODERATE;
  return PRECEDENT_WEIGHT_WEAK;
}

/**
 * Pure query-text builder — composes a short natural-language description of
 * the CURRENT SPX setup in the same register `describeAuditRow()`
 * (precedent-search.ts) uses for the descriptions being searched (e.g.
 * "SPX 0DTE setup, long, B conviction (score 62), mean_revert gamma regime")
 * — per precedent-search.ts's own doc: "query should describe the CURRENT
 * situation in the same register the descriptions above use." Reuses
 * whatever the engine already exposes (`confluence.direction`/`.grade`/
 * `.score`, `desk.gamma_regime`) rather than inventing new inputs — "unknown"
 * gamma regime is omitted rather than embedded as a fact.
 */
export function buildPrecedentSearchQuery(
  desk: Pick<SpxDeskPayload, "gamma_regime">,
  direction: SpxPlayDirection | null,
  grade: string,
  score: number
): string {
  const dirWord = direction === "long" ? "long" : direction === "short" ? "short" : "no stated direction";
  const gammaNote =
    desk.gamma_regime && desk.gamma_regime !== "unknown" ? `, ${desk.gamma_regime} gamma regime` : "";
  return `SPX 0DTE setup, ${dirWord}, ${grade} conviction (score ${Math.round(score)})${gammaNote}`;
}

/**
 * Parses the direction a retrieved precedent chunk stated for ITSELF back out
 * of `describeAuditRow()`'s deterministic template (precedent-search.ts):
 * `"${kind} alert on ${ticker}, ${direction}${conviction}..."` where
 * `direction` is the raw `alert_audit_log.direction` value verbatim — "long"/
 * "short" platform-wide today (0DTE, Night Hawk, and `spx_claude_play` all
 * write that exact vocabulary — confirmed via a repo-wide grep of every
 * `insertAlertAuditLog`/`direction:` call site) or the literal string
 * "no stated direction" when the row had none. "bullish"/"bearish" are also
 * matched defensively in case a future alert type ever writes that
 * vocabulary directly — same "never fabricate, degrade to neutral for
 * anything unrecognized" rule the sibling files' own `directionOf` helpers
 * use.
 */
export function parsePrecedentDirection(chunk: string): "bullish" | "bearish" | "neutral" {
  const lower = chunk.toLowerCase();
  if (/\b(long|bullish)\b/.test(lower)) return "bullish";
  if (/\b(short|bearish)\b/.test(lower)) return "bearish";
  return "neutral";
}

export type PrecedentOutcome = "target" | "stop" | "ambiguous" | "unfilled";

/**
 * Parses the terminal outcome back out of `describeAuditRow()`'s trailing
 * `"Outcome: ${outcome}."` clause. Only ever embeds rows
 * `fetchResolvedAlertAuditRows()` already filtered to
 * `TERMINAL_ALERT_OUTCOMES` (`target|stop|ambiguous|unfilled` — db.ts), so
 * "Outcome: not yet graded." should never actually appear in a real precedent
 * chunk — handled defensively anyway (returns `null`, same as any
 * unrecognized/malformed text) rather than throwing on a corpus this module
 * doesn't control the shape of end-to-end.
 */
export function parsePrecedentOutcome(chunk: string): PrecedentOutcome | null {
  const m = chunk.match(/Outcome:\s*(target|stop|ambiguous|unfilled)\b/i);
  return m ? (m[1].toLowerCase() as PrecedentOutcome) : null;
}

/**
 * Pure scorer. Two independent honesty gates before any directional weight is
 * ever computed:
 *
 *  1. `searchConfirmedAvailable` — mirrors every sibling's staleness-guard
 *     discipline (e.g. computeShadowFactors' `flowFeedFresh`,
 *     deriveEcosystemShadowFactors' `flow_feed_fresh`). `findSimilarPrecedents`
 *     -> `searchKnowledge()` fails open to `[]` on THREE indistinguishable
 *     conditions (bie/knowledge.ts): not configured (DB or Voyage embeddings
 *     key missing), a real query that found nothing above the similarity
 *     floor, or an internal error. The caller (`logSpxPrecedentsShadowFactor`,
 *     spx-signal-log.ts) passes `bieEmbeddingsConfigured() && dbConfigured()`
 *     as the best available "the search could even have run" proxy — the
 *     same class of honest, documented limitation the mega-cap-catalyst
 *     sibling's `catalystFetchOk` already accepts for its own fetcher.
 *  2. `MIN_TOTAL_PRECEDENTS` — even when the search is confirmed capable of
 *     running, a near-empty corpus (expected right now, see module doc) isn't
 *     enough basis to say anything. Both gates return `available:false`,
 *     never a fabricated neutral OR fabricated directional reading.
 *
 * Once both gates clear, precedents are tallied against `confluenceDirection`
 * ("same direction" per the task's own framing): a precedent whose OWN
 * direction matches the engine's current bias and resolved "target" is
 * evidence FOR continuing that direction; matches and resolved "stop" is
 * evidence AGAINST. Precedents with the opposite direction, no stated
 * direction, or a resolved-but-not-directional outcome (`ambiguous`/
 * `unfilled`) are not tallied either way — they are real, counted-toward-
 * `total` hits, just not usable evidence for THIS comparison.
 */
export function computePrecedentShadowFactor(
  precedents: PrecedentHit[],
  searchConfirmedAvailable: boolean,
  confluenceDirection: SpxPlayDirection | null
): ShadowFactorObservation[] {
  if (!searchConfirmedAvailable) {
    return [
      {
        factor_name: PRECEDENT_AGREEMENT_FACTOR,
        available: false,
        implied_weight: 0,
        direction: "neutral",
        detail:
          "BIE precedent search not confirmed available (DB or Voyage embeddings not configured) — cannot distinguish a real empty corpus from a disabled search pipeline",
      },
    ];
  }

  const total = precedents.length;
  if (total < MIN_TOTAL_PRECEDENTS) {
    return [
      {
        factor_name: PRECEDENT_AGREEMENT_FACTOR,
        available: false,
        implied_weight: 0,
        direction: "neutral",
        detail: `Only ${total}/${PRECEDENT_SEARCH_K} similar precedents returned — below the ${MIN_TOTAL_PRECEDENTS}-of-${PRECEDENT_SEARCH_K} floor to speak with any confidence. Expected right now: alert_audit_log.outcome propagation (bie/alert-outcome-sync.ts) only just started backfilling graded rows, so the precedent corpus is still near-empty, not broken.`,
      },
    ];
  }

  if (confluenceDirection == null) {
    return [
      {
        factor_name: PRECEDENT_AGREEMENT_FACTOR,
        available: true,
        implied_weight: 0,
        direction: "neutral",
        detail: `${total} precedents found but the engine has no directional bias right now to compare them against`,
      },
    ];
  }

  const confluenceBullish = confluenceDirection === "long";
  let forCount = 0;
  let againstCount = 0;
  for (const p of precedents) {
    const dir = parsePrecedentDirection(p.chunk);
    if (dir === "neutral") continue; // precedent had no stated direction of its own — not comparable
    const sameDirection = (dir === "bullish") === confluenceBullish;
    if (!sameDirection) continue; // a different setup direction — not "the same direction" this factor tallies

    const outcome = parsePrecedentOutcome(p.chunk);
    if (outcome === "target") forCount += 1;
    else if (outcome === "stop") againstCount += 1;
    // ambiguous/unfilled/unrecognized: resolved, but not directionally informative — not tallied
  }

  const usable = forCount + againstCount;
  if (usable === 0) {
    return [
      {
        factor_name: PRECEDENT_AGREEMENT_FACTOR,
        available: true,
        implied_weight: 0,
        direction: "neutral",
        detail: `${total} precedents found, but none were both same-direction (${confluenceDirection}) as the current setup and cleanly resolved target/stop`,
      },
    ];
  }

  // `net` is "evidence for continuing the CURRENT (confluenceDirection) bias" —
  // positive when target-resolutions dominate, negative when stop-resolutions
  // do — independent of whether that bias itself is bullish or bearish. It
  // must be translated into the engine's own signed score convention (positive
  // = bullish lean, negative = bearish lean — see spx-signals.ts's VWAP/GEX
  // factors: `score += above ? w : -w`) via the CURRENT direction's own sign,
  // not net's sign directly: e.g. 3 same-direction SHORT precedents that all
  // resolved "target" is strong evidence FOR continuing short — a BEARISH
  // lean (negative weight) — even though net itself is positive (+3 "for").
  const net = forCount - againstCount;
  const ratio = net / usable;
  const magnitude = precedentMagnitude(Math.abs(ratio), usable);
  const directionSign = confluenceBullish ? 1 : -1;
  const weight = net === 0 ? 0 : Math.sign(net) * directionSign * magnitude;
  const dir: "bullish" | "bearish" | "neutral" = weight > 0 ? "bullish" : weight < 0 ? "bearish" : "neutral";

  return [
    {
      factor_name: PRECEDENT_AGREEMENT_FACTOR,
      available: true,
      implied_weight: weight,
      direction: dir,
      detail: `${forCount}/${usable} same-direction (${confluenceDirection}) precedents resolved target, ${againstCount}/${usable} resolved stop (of ${total} total returned) [shadow: not scored]`,
    },
  ];
}
