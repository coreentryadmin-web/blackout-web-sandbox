/**
 * NUMERIC-GROUNDING ENFORCEMENT (data-correctness audit P0).
 *
 * THE PRINCIPLE: deterministic arithmetic grounding of Claude's free-text play JSON against the
 * SAME chain + dossier data that was put in front of Claude — NOT a second LLM critic. A play may
 * never publish a number that cannot be traced to a real chain contract, a real dossier flow figure,
 * or a real support/resistance level. Where a number can't be traced and the divergence is trade-
 * critical we DROP the play; where it's a soft/cosmetic divergence we KEEP the play but strip/flag
 * the offending number and log it.
 *
 * This module is PURE: it takes already-fetched chain rows (the cache-reader prefetch from
 * generateEditionPlays — no new live fan-out) + the dossier and returns a verdict. The caller
 * (generateEditionPlays) decides drop-vs-keep and feeds the grounding summary into the funnel log.
 *
 * DROP-VS-FLAG POLICY (see docs/NIGHTHAWK_GROUNDING.md):
 *   HARD (drop the play):
 *     - off-chain strike: the play's strike+expiry IS present in the prefetched ATM window but its
 *       OI is below the floor (a positive contradiction — illiquid/non-existent contract), OR
 *     - premium way-off: entry_premium reconciles to NULL while the contract IS confirmed on-chain
 *       (null-premium-as-PASS is rejected), or it is out of tolerance vs the chain ask/mid.
 *   SOFT (keep the play, strip/flag the number, log it):
 *     - flow $ divergence vs the dossier flow figure,
 *     - entry/target/stop level that doesn't trace to a real S/R or chain-derived level,
 *     - prose number (in thesis/key_signal) that diverges from the grounded structured field,
 *     - any PT-like ("price target $X") claim in prose — always stripped (no real PT source).
 *
 * EXACT CONTRACT RULE. The prompt's chain table stays narrow (ATM ±5%, front expiries), but the
 * final published option card is augmented with an exact per-contract snapshot. A parseable contract
 * that still cannot be matched is NOT grounded and must not publish with a fabricated premium.
 */

import type { ChainStrikeRow, EditionChainData } from "./option-chain-prompt";
import { parseOptionsContract } from "./option-chain-prompt";
import { parseEntryPremiumPerShare } from "./play-constraints";
import type { TickerDossier } from "./dossier";
import type { PlaybookPlay } from "./types";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";
import { fmtPremium } from "@/lib/fmt-money";

/** Minimum open interest for a contract to count as a real, tradeable strike. */
export const GROUNDING_MIN_OI = 500;

/** Entry premium must land within ±40% of the chain ask (or mid) for the matched contract.
 *  Wide enough to absorb intraday→overnight quote drift and bid/ask vs mid choices, tight enough
 *  that a fabricated premium (2×+ off) is caught. */
export const PREMIUM_TOLERANCE_PCT = 0.4;

/** Stated total flow $ must reconcile to the dossier flow figure within ±35%. The dossier figure is
 *  the sum of alert premiums (format.ts:327); a stated number more than a third off is fabricated. */
export const FLOW_TOLERANCE_PCT = 0.35;

/** A price level (entry/target/stop) must sit within ±2% of a real S/R level (or a chain strike) to
 *  count as "traced to real structure". Loose because S/R are zones, not exact ticks. */
export const LEVEL_TOLERANCE_PCT = 0.02;

export type GroundingSeverity = "ok" | "flag" | "drop";

export type GroundingIssue = {
  check: "strike" | "premium" | "flow" | "levels" | "price_target" | "prose";
  severity: "flag" | "drop";
  detail: string;
};

export type GroundingResult = {
  /** Final disposition: drop ⇒ remove from edition; flag ⇒ keep, with the play possibly mutated to
   *  strip offending numbers; ok ⇒ untouched. */
  severity: GroundingSeverity;
  /** The (possibly mutated) play. On `drop` this is the input unchanged (caller discards it). */
  play: PlaybookPlay;
  issues: GroundingIssue[];
};

export type GroundingSummary = {
  grounded: number;
  dropped_ungrounded: number;
  flagged: number;
  /** One line per non-ok play, for the funnel log + edition meta. */
  notes: string[];
};

function approxEq(a: number, b: number, tolPct: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (b === 0) return a === 0;
  return Math.abs(a - b) / Math.abs(b) <= tolPct;
}

/** Extract bare numeric tokens from prose. Strips $ and commas; keeps decimals and %-context. We
 *  capture the number plus a small trailing unit hint so we can tell a "$" price from a "%" reading. */
function extractProseNumbers(text: string): Array<{ value: number; raw: string; isPct: boolean; isDollar: boolean }> {
  const out: Array<{ value: number; raw: string; isPct: boolean; isDollar: boolean }> = [];
  if (!text) return out;
  // $1,234.56 | 12.5% | 4200 — capture optional leading $ and trailing %.
  const re = /(\$)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(%)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].trim();
    const value = Number(m[2]!.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ value, raw, isPct: m[3] === "%", isDollar: m[1] === "$" });
  }
  return out;
}

/** Find a chain row matching the parsed contract's strike (and expiry if present). Mirrors
 *  evaluatePlayAgainstChain's matcher but returns the rows so we can also read the ask/mid. */
function matchChainRows(
  strike: number,
  expiryYmd: string | null,
  rows: ChainStrikeRow[]
): ChainStrikeRow[] {
  return rows.filter((row) => {
    if (Math.abs(row.strike - strike) > 0.05) return false;
    if (expiryYmd && row.expiry !== expiryYmd) return false;
    return true;
  });
}

function sideAsk(row: ChainStrikeRow, side: "call" | "put" | null): number | null {
  const ask = side === "put" ? row.put_ask : row.call_ask;
  const bid = side === "put" ? row.put_bid : row.call_bid;
  if (ask != null && Number.isFinite(ask) && ask > 0) {
    // Prefer the mid when both sides quote, else fall back to the ask.
    if (bid != null && Number.isFinite(bid) && bid > 0) return (ask + bid) / 2;
    return ask;
  }
  // No call/put hint — take the best available mid across both sides.
  if (side == null) {
    const mids: number[] = [];
    if (row.call_ask && row.call_bid) mids.push((row.call_ask + row.call_bid) / 2);
    else if (row.call_ask) mids.push(row.call_ask);
    if (row.put_ask && row.put_bid) mids.push((row.put_ask + row.put_bid) / 2);
    else if (row.put_ask) mids.push(row.put_ask);
    return mids.length ? Math.min(...mids) : null;
  }
  return null;
}

function replaceEntryPremiumText(optionsPlay: string, premium: number): string {
  const replacement = `entry prem ~$${premium.toFixed(2)}`;
  if (/entry\s+prem\s*~?\$?\d+(?:\.\d+)?/i.test(optionsPlay)) {
    return optionsPlay.replace(/entry\s+prem\s*~?\$?\d+(?:\.\d+)?/i, replacement);
  }
  return `${optionsPlay.replace(/\s+$/, "")}, ${replacement}`;
}

function sideOi(row: ChainStrikeRow, side: "call" | "put" | null): number {
  if (side === "call") return row.call_oi;
  if (side === "put") return row.put_oi;
  return Math.max(row.call_oi, row.put_oi);
}

/** Pull the first $-price token out of a level string ("$182.50 — prior day high" → 182.5). */
function firstPriceInText(text: string): number | null {
  if (!text || text === "—") return null;
  const m = text.match(/\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/);
  if (!m?.[1]) return null;
  const v = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Each pattern captures (group 1) the numeric dollar value of the PT claim so callers can RECONCILE
 *  a prose PT against a real source PT, not just blindly strip it. */
const PT_PATTERNS: RegExp[] = [
  /\b(?:analyst|street|consensus)?\s*price\s*target[s]?\s*(?:of|:|is|at|=)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/gi,
  /\bPT\s*(?:of|:|at|=)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/g,
  /\$\s*(\d[\d,]*(?:\.\d+)?)\s*PT\b/g,
  /\banalyst[s]?\s*(?:see|target|expect)[a-z]*\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/gi,
];

/** Tolerance band for reconciling a prose PT against the parsed source PT. Within ±20% ⇒ keep. */
export const PRICE_TARGET_TOLERANCE_PCT = 0.2;

/**
 * Strip / reconcile analyst price-target claims in prose.
 *
 *  - When NO `sourcePt` is supplied (dossier has no parsed PT), every PT claim is fabricated → strip.
 *  - When a `sourcePt` exists, a prose PT WITHIN ±20% of it is legitimate → keep; one OUTSIDE the
 *    band is fabricated/misquoted → strip. The phrase is neutralized (not the whole sentence) so the
 *    surrounding thesis stays readable.
 */
export function stripPriceTargetClaims(
  text: string,
  sourcePt?: number | null
): { text: string; stripped: boolean } {
  if (!text) return { text, stripped: false };
  let stripped = false;
  let out = text;
  for (const re of PT_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, (match, num: string) => {
      // No source PT → always fabricated.
      if (sourcePt == null || !Number.isFinite(sourcePt)) {
        stripped = true;
        return "[price target unavailable]";
      }
      const claimed = Number(String(num).replace(/,/g, ""));
      if (!Number.isFinite(claimed) || sourcePt <= 0) {
        stripped = true;
        return "[price target unavailable]";
      }
      // Within tolerance of the real PT → legitimate, keep the original text.
      if (Math.abs(claimed - sourcePt) / sourcePt <= PRICE_TARGET_TOLERANCE_PCT) {
        return match;
      }
      stripped = true;
      return "[price target unavailable]";
    });
  }
  return { text: out, stripped };
}

/**
 * Ground a single play against the chain rows + dossier it was generated from.
 *
 * @param play     the mapped PlaybookPlay (post premium-cap, post soft strike gate)
 * @param chain    the prefetched EditionChainData (spot + ATM±5% front-two-expiry rows) for the
 *                 ticker, from generateEditionPlays' fetchEditionChains call (cache-reader; no fetch)
 * @param dossier  the ticker's dossier (flows, tech S/R, iv_rank)
 */
export function groundPlay(
  play: PlaybookPlay,
  chain: EditionChainData | undefined,
  dossier: TickerDossier | undefined
): GroundingResult {
  const issues: GroundingIssue[] = [];
  let mutated = play;
  const rows = chain?.rows ?? [];
  const spot = chain?.spot ?? dossier?.tech?.price ?? 0;

  const parsed = parseOptionsContract(play.options_play);
  const matched = parsed ? matchChainRows(parsed.strike, parsed.expiryYmd, rows) : [];
  const contractOnChain = matched.length > 0;

  // ── CHECK 1 + 2: STRIKE confirmed on-chain (OI floor) + PREMIUM reconciles ────────────────────
  // The chain rows are augmented with exact per-contract snapshots for parseable Claude contracts.
  // If a user-visible option card still cannot be parsed/matched here, the premium is not grounded.
  if (!parsed) {
    issues.push({
      check: "strike",
      severity: "drop",
      detail: `${play.ticker} option contract is unparseable — cannot ground strike/expiry/premium.`,
    });
  } else if (!parsed.expiryYmd || !parsed.side) {
    issues.push({
      check: "strike",
      severity: "drop",
      detail: `${play.ticker} option contract missing ${!parsed.expiryYmd ? "expiry" : "side"} — cannot ground premium.`,
    });
  } else if (!contractOnChain) {
    // SOFT unverifiable (#77 / thin-edition fix): the soft strike gate already passed this play
    // because absence from the narrow ATM window is NOT a contradiction. Dropping here re-introduced
    // the over-filter that zeroed editions. Strip the ungrounded premium and keep the levels-only
    // trade card — never publish a fabricated option quote.
    issues.push({
      check: "strike",
      severity: "flag",
      detail: `${play.ticker} ${parsed.expiryYmd} ${parsed.strike} ${parsed.side} was not found in exact/prefetched chain data — entry premium stripped; verify contract before entry.`,
    });
    mutated = {
      ...mutated,
      entry_premium: undefined,
      entry_cost_per_contract: undefined,
      premium_cap_ok: undefined,
      options_play: `${play.ticker} — option contract not confirmed on chain; verify strike/expiry/premium before entry`,
    };
  } else {
    const bestOi = Math.max(...matched.map((r) => sideOi(r, parsed.side)));
    if (bestOi < GROUNDING_MIN_OI) {
      issues.push({
        check: "strike",
        severity: "drop",
        detail: `${play.ticker} strike ${parsed.strike}${parsed.side ? ` ${parsed.side}` : ""}${parsed.expiryYmd ? ` ${parsed.expiryYmd}` : ""} present on-chain but OI ${bestOi} < ${GROUNDING_MIN_OI} (illiquid/off-chain).`,
      });
    } else {
      // Contract is real & liquid → the displayed premium MUST come from the live contract mark.
      // Claude's estimate is advisory only; overwrite it with the live mark when affordable.
      const premium = parseEntryPremiumPerShare(play);
      // Best (cheapest) ask/mid across matched rows that quote the chosen side.
      const asks = matched
        .map((r) => sideAsk(r, parsed.side))
        .filter((a): a is number => a != null && a > 0);
      const chainAsk = asks.length ? Math.min(...asks) : null;

      if (chainAsk == null) {
        issues.push({
          check: "premium",
          severity: "drop",
          detail: `${play.ticker} contract confirmed on-chain (OI ${bestOi}) but has no usable bid/ask quote — entry_premium cannot be grounded.`,
        });
      } else if (chainAsk > MAX_OPTION_PREMIUM_PER_SHARE) {
        issues.push({
          check: "premium",
          severity: "drop",
          detail: `${play.ticker} live premium $${chainAsk.toFixed(2)} exceeds the $${MAX_OPTION_PREMIUM_PER_SHARE}/share cap — not publishing an unaffordable option card.`,
        });
      } else {
        const livePremium = Number(chainAsk.toFixed(2));
        if (premium == null || Math.abs(premium - livePremium) > 0.005) {
          issues.push({
            check: "premium",
            severity: "flag",
            detail: `${play.ticker} entry_premium ${premium == null ? "missing" : `$${premium.toFixed(2)}`} replaced with live contract mark $${livePremium.toFixed(2)}.`,
          });
        }
        mutated = {
          ...mutated,
          entry_premium: livePremium,
          entry_cost_per_contract: Math.round(livePremium * 100),
          premium_cap_ok: livePremium <= MAX_OPTION_PREMIUM_PER_SHARE,
          options_play: replaceEntryPremiumText(mutated.options_play, livePremium),
        };
      }
    }
  }

  // ── CHECK 3: FLOW $ reconciliation (SOFT) ─────────────────────────────────────────────────────
  // The dossier flow figure is the deterministic source (format.ts:327 sum of alert premiums). If
  // the play's prose states a total flow $, it must reconcile within tolerance — else flag the number.
  if (dossier) {
    const dossierFlow = dossier.flows.reduce(
      (s, f) => s + Number(f.total_premium ?? f.premium ?? 0),
      0
    );
    if (dossierFlow > 0) {
      const flowClaim = extractStatedFlowDollars(`${play.thesis} ${play.key_signal} ${play.risk_note ?? ""}`);
      if (flowClaim != null && !approxEq(flowClaim, dossierFlow, FLOW_TOLERANCE_PCT)) {
        issues.push({
          check: "flow",
          severity: "flag",
          detail: `${play.ticker} stated flow ~${fmtPremium(flowClaim)} diverges from dossier flow ${fmtPremium(dossierFlow)} (>±${Math.round(FLOW_TOLERANCE_PCT * 100)}%).`,
        });
      }
    }
  }

  // ── CHECK 4: ENTRY / TARGET / STOP levels trace to real S/R or a chain strike (SOFT) ──────────
  const support = dossier?.tech?.support_levels ?? [];
  const resistance = dossier?.tech?.resistance_levels ?? [];
  const strikes = rows.map((r) => r.strike);
  const realLevels = [...support, ...resistance, ...strikes].filter((n) => Number.isFinite(n) && n > 0);
  if (realLevels.length) {
    for (const [label, raw] of [
      ["entry", play.entry_range],
      ["target", play.target],
      ["stop", play.stop],
    ] as const) {
      const px = firstPriceInText(raw);
      // Only check values that look like an absolute price near spot (skip ratios, %, tiny premiums).
      if (px == null) continue;
      if (spot > 0 && (px < spot * 0.5 || px > spot * 2)) continue; // not a price level (e.g. premium/contracts)
      const traces = realLevels.some((lv) => approxEq(px, lv, LEVEL_TOLERANCE_PCT));
      if (!traces) {
        issues.push({
          check: "levels",
          severity: "flag",
          detail: `${play.ticker} ${label} $${px} does not trace to any dossier S/R or chain strike (±${Math.round(LEVEL_TOLERANCE_PCT * 100)}%).`,
        });
      }
    }
  }

  // ── CHECK 5: RECONCILE / kill analyst price target (SOFT — strip from prose) ──────────────────
  // We now have a parsed Benzinga PT in the dossier (price target news channel). Reconcile any prose
  // PT against it: WITHIN ±20% of the real PT ⇒ keep; OUTSIDE the band, or when there is NO source
  // PT, ⇒ strip. Done as a mutation so the published prose never carries a made-up/misquoted target.
  {
    const sourcePt = dossier?.benzinga_price_target?.price_target ?? null;
    const t1 = stripPriceTargetClaims(mutated.thesis, sourcePt);
    const t2 = stripPriceTargetClaims(mutated.key_signal, sourcePt);
    const t3 = stripPriceTargetClaims(mutated.target, sourcePt);
    if (t1.stripped || t2.stripped || t3.stripped) {
      mutated = { ...mutated, thesis: t1.text, key_signal: t2.text, target: t3.text };
      issues.push({
        check: "price_target",
        severity: "flag",
        detail:
          sourcePt != null
            ? `${play.ticker} prose price target stripped — outside ±${Math.round(PRICE_TARGET_TOLERANCE_PCT * 100)}% of the parsed analyst PT $${sourcePt}.`
            : `${play.ticker} fabricated analyst price target stripped from prose (no parsed PT source for this ticker).`,
      });
    }
  }

  // ── CHECK 6: PROSE-vs-STRUCTURED divergence (SOFT — flag) ─────────────────────────────────────
  // Compare trade-critical numbers in prose against the grounded structured fields. We flag (not
  // mutate prose surgically — the structured fields are what the UI renders for the trade card; the
  // prose is supporting context) so a future renderer can prefer the structured grounded value.
  {
    const proseNums = extractProseNumbers(`${mutated.thesis} ${mutated.key_signal}`);
    const groundedStrike = parsed?.strike ?? null;
    const groundedIv = play.iv_rank ?? dossier?.iv_rank ?? null;
    // IV rank: a %-number in prose that's wildly off the grounded IV rank is a fabricated reading.
    if (groundedIv != null) {
      for (const n of proseNums) {
        if (!n.isPct) continue;
        if (n.value > 100) continue; // not an IV rank reading
        // Heuristic: a prose %-token that is NOT close to the grounded IV rank AND reads like an IV
        // rank claim ("IV rank", "IVR") nearby — flag the divergence.
        if (/iv\s*rank|ivr|implied/i.test(mutated.thesis + mutated.key_signal) && !approxEq(n.value, groundedIv, 0.25)) {
          issues.push({
            check: "prose",
            severity: "flag",
            detail: `${play.ticker} prose IV-rank-like value ${n.raw} diverges from grounded IV rank ${groundedIv}.`,
          });
          break;
        }
      }
    }
    // Strike echoed in prose ("calls at 185") that doesn't match the structured/parsed strike.
    // Drop a prose number that: sits in a plausible strike range near spot, appears alongside a
    // call/put/strike word, is NOT the grounded structured strike, and is NOT any real chain strike.
    // (We don't drop a prose number that merely echoes a different but real chain strike — that's
    // legitimate context, not a fabrication.)
    const hasStrikeWord = /\b(call|put|strike)s?\b/i.test(`${mutated.thesis} ${mutated.key_signal}`);
    if (groundedStrike != null && contractOnChain && hasStrikeWord) {
      for (const n of proseNums) {
        if (n.isPct || n.isDollar) continue;
        if (spot > 0 && (n.value < spot * 0.5 || n.value > spot * 2)) continue; // not a strike-range value
        const isGroundedStrike = Math.abs(n.value - groundedStrike) <= 0.05;
        const isRealChainStrike = rows.some((r) => Math.abs(r.strike - n.value) <= 0.05);
        if (!isGroundedStrike && !isRealChainStrike) {
          issues.push({
            check: "prose",
            severity: "drop",
            detail: `${play.ticker} prose references ${n.raw} near a strike claim but the grounded contract strike is ${groundedStrike} and ${n.raw} is not in the chain — dropping user-visible contradictory setup text.`,
          });
          break;
        }
      }
    }
  }

  const hasDrop = issues.some((i) => i.severity === "drop");
  const severity: GroundingSeverity = hasDrop ? "drop" : issues.length ? "flag" : "ok";
  return { severity, play: mutated, issues };
}

/** Pull a stated total-flow dollar figure from prose ("$4.2M in call flow", "$850K premium"). Returns
 *  the dollar value (expanded from M/K) or null. Only matches when a flow/premium word is adjacent so
 *  we don't mistake a price or strike for a flow figure. */
export function extractStatedFlowDollars(text: string): number | null {
  if (!text) return null;
  // $4.2M / $850K / $1,200,000 immediately followed (within a few words) by flow|premium|prem|call flow|put flow
  const re = /\$\s*(\d+(?:\.\d+)?)\s*([MK])?\b(?=[^.]{0,24}?(?:flow|premium|prem\b))/gi;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let v = Number(m[1]);
    if (!Number.isFinite(v)) continue;
    const unit = (m[2] ?? "").toUpperCase();
    if (unit === "M") v *= 1_000_000;
    else if (unit === "K") v *= 1_000;
    // Take the largest stated flow figure (the "total" claim, not a per-strike sliver).
    if (best == null || v > best) best = v;
  }
  return best;
}

/** task #141: one HARD-dropped play's ticker/original play/drop-severity issues, so the caller can
 *  build a durable rejection-audit row citing exactly which claimed level(s) failed to ground and
 *  against what — `summary.notes` only has a flattened text line, not the structured detail. */
export type GroundingDroppedPlay = { ticker: string; play: PlaybookPlay; issues: GroundingIssue[] };

/**
 * Ground an entire batch of plays. Returns the surviving (kept, possibly mutated) plays plus a
 * summary for the funnel log + edition meta. Dropped plays are removed; flagged plays are kept with
 * any PT prose stripped. NEVER throws — a grounding error degrades to keeping the play untouched.
 */
export function groundPlays(
  plays: PlaybookPlay[],
  chains: Record<string, EditionChainData>,
  dossiers: Record<string, TickerDossier>
): { plays: PlaybookPlay[]; summary: GroundingSummary; dropped: GroundingDroppedPlay[] } {
  const kept: PlaybookPlay[] = [];
  // task #141: additive — records the SAME plays `summary.dropped_ungrounded` already counted and
  // `summary.notes` already logged as text, just structured instead of flattened, so a caller can
  // write a durable per-ticker audit row. Drop/keep logic and thresholds below are untouched.
  const dropped: GroundingDroppedPlay[] = [];
  const summary: GroundingSummary = { grounded: 0, dropped_ungrounded: 0, flagged: 0, notes: [] };

  for (const play of plays) {
    let result: GroundingResult;
    try {
      const tk = play.ticker.toUpperCase();
      result = groundPlay(play, chains[tk], dossiers[tk]);
    } catch (err) {
      // Defensive: a grounding bug must never drop a play or crash the build. Keep it untouched.
      console.error(`[nighthawk/grounding] ${play.ticker} grounding errored — keeping play untouched:`, err);
      kept.push(play);
      summary.grounded += 1;
      continue;
    }

    if (result.severity === "drop") {
      summary.dropped_ungrounded += 1;
      const dropIssues = result.issues.filter((i) => i.severity === "drop");
      const reason = dropIssues.map((i) => i.detail).join(" ");
      summary.notes.push(`DROP ${play.ticker}: ${reason}`);
      console.warn(`[nighthawk/grounding] DROP ${play.ticker}: ${reason}`);
      dropped.push({ ticker: play.ticker, play, issues: dropIssues });
      continue;
    }

    if (result.severity === "flag") {
      summary.flagged += 1;
      const reason = result.issues.map((i) => `[${i.check}] ${i.detail}`).join(" ");
      summary.notes.push(`FLAG ${play.ticker}: ${reason}`);
      console.warn(`[nighthawk/grounding] FLAG ${play.ticker}: ${reason}`);
    } else {
      summary.grounded += 1;
    }
    kept.push(result.play);
  }

  // Re-rank survivors 1..N so a dropped play doesn't leave a rank gap.
  const reranked = kept.map((p, i) => ({ ...p, rank: i + 1 }));
  return { plays: reranked, summary, dropped };
}
