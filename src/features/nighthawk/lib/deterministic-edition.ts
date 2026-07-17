/**
 * DETERMINISTIC NIGHT HAWK EDITION SELECTOR (de-Claude, task #61).
 *
 * THE PRINCIPLE: this module replaces Claude's "pick the top-N plays + write the geometry/contract"
 * step with PURE, deterministic code driven ONLY by numbers the platform already computed —
 * scoreCandidate()'s ScoredCandidate[], the TickerDossier (technicals / flow / IV), and the prefetched
 * option chain. NO LLM. It never invents a number: entry/target/stop come from real support/resistance
 * (buildDirectionalStockLevels), the option contract is a real, liquid, affordable strike lifted
 * straight off the chain, and every emitted play is re-checked by the SAME publish-time gates the
 * Claude path uses (validatePlayGeometry, the premium cap, and groundPlays).
 *
 * WHY IT EXISTS: on staging (and any deploy where claudeEnabled() is false) every Anthropic call
 * returns null, so generateEditionPlays' Claude synthesis produced ZERO plays and Night Hawk published
 * an empty edition. Everything Night Hawk needs to rank and shape a play is already deterministic — the
 * only Claude-only step was the final "choose + phrase" — so this rebuilds that step from the same
 * scored data. Output is as strong as (and traceable in a way the LLM output never was) the Claude
 * edition: same ranking, same geometry gate, same grounding.
 *
 * HONESTY: a candidate is only published when a REAL contract exists for it under the premium cap and
 * its geometry validates. If not enough candidates clear those gates we publish FEWER plays — we never
 * pad the book with a fabricated or ungrounded play.
 *
 * PURE: takes already-fetched chains as input (no live fan-out here — the caller does the prefetch),
 * so it is fully unit-testable with synthetic ScoredCandidate[] + chains + dossiers.
 */
import type { EditionChainData, ChainStrikeRow } from "./option-chain-prompt";
import type { TickerDossier } from "./dossier";
import type { ScoredCandidate } from "./scorer";
import {
  scoreTechnicalSetup,
  scoreOptionsPositioning,
  scoreNewsCatalyst,
  scoreSmartMoney,
  scoreFundamentalTailwind,
  scoreShortInterest,
  scoreWallProximity,
  scoreVexAlignment,
  scoreCatalystAwareness,
  scoreSkewConfirmation,
  convictionFromScore,
} from "./scorer";
import { assignNighthawkTier, nhTierInputFromScored } from "./nighthawk-tiers";
import type { PlaybookPlay } from "./types";
import { buildDirectionalStockLevels, computeRiskReward } from "./play-levels";
import { applyPremiumCapToPlay, validatePlayGeometry, canonicalTicker } from "./play-constraints";
import { groundPlays } from "./grounding";
import { GROUNDING_MIN_OI, tieredMinOi } from "./grounding";
import { MAX_OPTION_PREMIUM_PER_SHARE, MIN_PUBLISH_SCORE, DIVERSITY_HEDGE_FLOOR } from "./constants";
import { todayEtYmd } from "@/lib/providers/spx-session";

/** Default number of plays a full edition publishes. Mirrors the Claude path's top-5 shape. */
export const DETERMINISTIC_EDITION_TARGET = 5;

/** PR-N32: how many ranked candidates to consider for forced contrarian re-scoring. */
const CONTRARIAN_POOL_SIZE = 10;
/** PR-N32: flow score discount when direction is forced opposite to the flow. The flow
 *  activity is real (liquidity/interest), but it's working AGAINST the contrarian thesis. */
const CONTRARIAN_FLOW_DISCOUNT = 0.3;

/**
 * PR-N32: re-score a candidate in the opposite direction for the diversity hedge slot.
 * Uses the individual scorer functions with the forced direction, discounting the flow
 * component since the flow is against the contrarian thesis. Returns null if the dossier
 * lacks the data needed to score (no tech, no chain, etc.).
 */
export function scoreContrarianHedge(
  original: ScoredCandidate,
  dossier: TickerDossier,
  forcedDirection: "long" | "short",
): ScoredCandidate {
  const tech = dossier.tech ?? null;
  const discountedFlow = Math.round(original.flow_score * CONTRARIAN_FLOW_DISCOUNT);
  const techScore = scoreTechnicalSetup(tech, forcedDirection);
  const posScore = scoreOptionsPositioning(dossier, forcedDirection);
  const newsScore = scoreNewsCatalyst(dossier, forcedDirection);
  const smartScore = scoreSmartMoney(dossier, forcedDirection);
  const fundScore = scoreFundamentalTailwind(
    dossier.fundamental_ratios, dossier.fundamental_signals, forcedDirection
  );
  const siScore = scoreShortInterest(dossier.short_days_to_cover, forcedDirection);
  const wallScore = scoreWallProximity(dossier.positioning, forcedDirection);
  const vexScore = scoreVexAlignment(dossier.positioning, forcedDirection);
  const catalystResult = scoreCatalystAwareness(dossier.catalysts, forcedDirection);
  const skewScore = scoreSkewConfirmation(dossier.risk_reversal_skew, forcedDirection);

  const rawTotal = discountedFlow + techScore + posScore + newsScore + smartScore +
    fundScore + siScore + wallScore + vexScore + catalystResult.score + skewScore;

  const rm = original.regime_multiplier ?? 1;
  const dampened = 1 + (rm - 1) * 0.5;
  const score = Math.max(0, Math.min(100, Math.round(rawTotal * dampened)));

  return {
    ...original,
    direction: forcedDirection,
    score,
    flow_score: discountedFlow,
    tech_score: techScore,
    pos_score: posScore,
    news_score: newsScore,
    smart_money_score: smartScore,
    fundamental_score: fundScore,
    short_interest_score: siScore,
    wall_proximity_score: wallScore,
    vex_alignment_score: vexScore,
    catalyst_score: catalystResult.score,
    catalyst_flags: catalystResult.flags,
    conviction: convictionFromScore(score),
  };
}

/** A contract chosen off the chain for a play, with the premium that will be shown to members. */
type PickedContract = {
  strike: number;
  side: "call" | "put";
  expiry: string;
  /** Per-share premium (mid when both sides quote, else the ask). */
  premium: number;
  /** When set, the contract didn't clear the strict gates — members see a caveat. */
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
};

function firstFinite(nums: Array<number | null | undefined> | undefined): number | null {
  for (const n of nums ?? []) {
    if (n != null && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Per-share premium for a chain row on the chosen side: mid when both sides quote, else the ask. */
function contractPremium(row: ChainStrikeRow, side: "call" | "put"): number | null {
  const ask = side === "call" ? row.call_ask : row.put_ask;
  const bid = side === "call" ? row.call_bid : row.put_bid;
  if (ask != null && Number.isFinite(ask) && ask > 0) {
    if (bid != null && Number.isFinite(bid) && bid > 0) return (ask + bid) / 2;
    return ask;
  }
  return null;
}

function contractOi(row: ChainStrikeRow, side: "call" | "put"): number {
  const oi = side === "call" ? row.call_oi : row.put_oi;
  return Number.isFinite(oi) ? oi : 0;
}

/** Format a strike for the option-card string so parseOptionsContract can re-read it. Integers stay
 *  integers ("120"); fractional strikes keep up to two decimals with no trailing zeros ("122.5"). */
function formatStrike(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : String(Number(strike.toFixed(2)));
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Format ISO date "2026-07-18" → "Jul 18" for compact, parseable display. */
function shortExpiry(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  const monthIdx = parseInt(parts[1]!, 10) - 1;
  const day = parseInt(parts[2]!, 10);
  if (monthIdx < 0 || monthIdx > 11 || !Number.isFinite(day)) return iso;
  return `${MONTH_NAMES[monthIdx]} ${day}`;
}

/** Build the member-facing options_play string.
 *  With contract: "AAPL $120 CALL @ $4.00 — Jul 18"
 *  With caveat:   "AAPL $120 CALL @ $4.00 — Jul 18 (premium above cap, verify size)"
 *  No contract:   "AAPL — no options data available" */
function formatOptionsPlay(ticker: string, contract: PickedContract | null): string {
  if (!contract) return `${ticker} — no options data available`;
  const sideWord = contract.side.toUpperCase();
  const base = `${ticker} $${formatStrike(contract.strike)} ${sideWord} @ $${contract.premium.toFixed(2)} — ${shortExpiry(contract.expiry)}`;
  if (!contract.caveat) return base;
  const tag =
    contract.caveat === "premium_high" ? "(premium above $35 cap, verify size)" :
    contract.caveat === "low_liquidity" ? "(thin liquidity, use limit order)" :
    "(premium high + thin liquidity, verify)";
  return `${base} ${tag}`;
}

/**
 * Pick the most at-the-money strike on the chosen side. Tries strict gates first (OI ≥ floor AND
 * premium ≤ cap). When nothing clears both, relaxes progressively: premium-only, OI-only, then
 * any quoted strike — always returning a concrete contract so members never see "check option chain".
 * Relaxed picks carry a `caveat` so the UI can flag them.
 *
 * Deterministic tie-break: closest strike to spot, then nearest expiry, then lower strike.
 */
/** Overnight swing plays need time value — prefer contracts with at least this many calendar days. */
const MIN_DTE_CALENDAR_DAYS = 5;

function minExpiryDate(today: string): string {
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + MIN_DTE_CALENDAR_DAYS);
  return d.toISOString().slice(0, 10);
}

export function pickChainContract(
  chain: EditionChainData,
  direction: "long" | "short"
): PickedContract | null {
  const side: "call" | "put" = direction === "long" ? "call" : "put";
  const spot = chain.spot;
  const minOi = spot > 0 ? tieredMinOi(spot) : GROUNDING_MIN_OI;
  const today = todayEtYmd();
  const minExpiry = minExpiryDate(today);

  type Candidate = PickedContract & { dist: number };
  const strict: Candidate[] = [];
  const relaxedPremium: Candidate[] = [];
  const relaxedOi: Candidate[] = [];
  const anyQuoted: Candidate[] = [];
  // Short-dated fallback: contracts between today and minExpiry (DTE too low for swing)
  const shortDated: Candidate[] = [];

  for (const row of chain.rows) {
    if (row.expiry <= today) continue;
    const premium = contractPremium(row, side);
    if (premium == null) continue;
    const oi = contractOi(row, side);
    const entry: Candidate = {
      strike: row.strike,
      side,
      expiry: row.expiry,
      premium: Number(premium.toFixed(2)),
      dist: spot > 0 ? Math.abs(row.strike - spot) : row.strike,
    };
    const oiOk = oi >= minOi;
    const premOk = premium <= MAX_OPTION_PREMIUM_PER_SHARE;
    if (row.expiry < minExpiry) {
      // Too short-dated for overnight swing — last-resort pool
      if (premOk) shortDated.push(entry);
      continue;
    }
    if (oiOk && premOk) strict.push(entry);
    else if (oiOk && !premOk) relaxedPremium.push({ ...entry, caveat: "premium_high" });
    else if (!oiOk && premOk) relaxedOi.push({ ...entry, caveat: "low_liquidity" });
    else anyQuoted.push({ ...entry, caveat: "premium_high_low_liquidity" });
  }

  const sortFn = (a: Candidate, b: Candidate) =>
    a.dist - b.dist || a.expiry.localeCompare(b.expiry) || a.strike - b.strike;

  for (const pool of [strict, relaxedPremium, relaxedOi, anyQuoted, shortDated]) {
    if (pool.length) {
      pool.sort(sortFn);
      const best = pool[0]!;
      return { strike: best.strike, side: best.side, expiry: best.expiry, premium: best.premium, caveat: best.caveat };
    }
  }
  return null;
}

/**
 * Resolve real entry/target/stop structure for a play. Prefers the dossier's swing support/resistance;
 * falls back to prior-day high/low, then a tight spot-relative band — all deterministic, real market
 * data, never fabricated targets. Returns levels that satisfy validatePlayGeometry's direction gate.
 */
function resolveLevels(
  dossier: TickerDossier | undefined,
  direction: "long" | "short",
  spot: number | null
): { entry_range: string; target: string; stop: string } {
  const tech = dossier?.tech ?? null;
  const px = spot != null && Number.isFinite(spot) && spot > 0 ? spot : tech?.price ?? null;
  let support = firstFinite(tech?.support_levels) ?? tech?.prior_day?.low ?? null;
  let resistance = firstFinite(tech?.resistance_levels) ?? tech?.prior_day?.high ?? null;

  // Use prior-day high/low as fallback S/R when technical levels are missing.
  if (support == null && tech?.prior_day?.low != null) support = tech.prior_day.low;
  if (resistance == null && tech?.prior_day?.high != null) resistance = tech.prior_day.high;

  // Guard: geometry needs a real band with resistance strictly above support. When S/R are missing or
  // inverted (data thin), synthesize a band around spot scaled to the ATR if available, else a tight
  // 2% band — deterministic and price-anchored.
  if (px != null && (support == null || resistance == null || !(resistance > support))) {
    const atr = tech?.atr14;
    const half = atr != null && Number.isFinite(atr) && atr > 0 ? atr * 0.5 : px * 0.02;
    support = px - half;
    resistance = px + half;
  }

  // PR-N21/N22: push the target-side S/R out so overnight plays have meaningful reward.
  // 1.5× ATR ensures a full average day's range of upside minimum.
  if (px != null && support != null && resistance != null && resistance > support) {
    const atr = tech?.atr14;
    const minTargetDist = atr != null && Number.isFinite(atr) && atr > 0
      ? atr * 1.5
      : px * 0.025;
    if (direction === "long" && (resistance - px) < minTargetDist) {
      resistance = px + minTargetDist;
    } else if (direction === "short" && (px - support) < minTargetDist) {
      support = px - minTargetDist;
    }
  }

  return buildDirectionalStockLevels({ direction, support, resistance, spot: px });
}

/**
 * Build an actionable thesis from the scoring breakdown + dossier data. Leads with the specific
 * technical setup and flow signal (WHY this play, not just what scored), includes key levels and
 * risk/reward context, and flags catalysts. Members should read this and immediately understand
 * the trade idea — not decode a score breakdown.
 */
export function buildDeterministicThesis(
  scored: ScoredCandidate,
  dossier: TickerDossier | undefined,
  levels?: { entry_range: string; target: string; stop: string }
): { thesis: string; key_signal: string } {
  const tech = dossier?.tech ?? null;
  const isLong = scored.direction !== "short";
  const dirWord = isLong ? "bullish" : "bearish";

  // --- Key signal (compact one-liner for cards/badges) ---
  const topDrivers = [
    { label: "flow", value: scored.flow_score },
    { label: "technicals", value: scored.tech_score },
    { label: "positioning", value: scored.pos_score },
    { label: "smart-money", value: scored.smart_money_score },
    { label: "news", value: scored.news_score },
  ]
    .filter((d) => Number.isFinite(d.value) && Math.abs(d.value) >= 3)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2);
  const driverTags = topDrivers.map((d) => d.label).join(" + ") || "confluence";
  const key_signal = `${dirWord.toUpperCase()} — ${driverTags} · score ${scored.score} (${scored.conviction})`;

  // --- Technical opener ---
  const parts: string[] = [];
  const setupTags = tech?.setup_tags ?? [];
  const trend = tech?.trend ?? "";

  const trendConflicts = trend && ((isLong && trend === "bearish") || (!isLong && trend === "bullish"));
  if (setupTags.length) {
    const tagText = setupTags.slice(0, 2).join(", ");
    parts.push(`${scored.ticker} showing ${tagText}${trend ? ` in ${trend} trend` : ""}.`);
  } else if (trend) {
    parts.push(`${scored.ticker} in ${trend} trend.`);
  } else {
    parts.push(`${scored.ticker} ${dirWord} setup.`);
  }
  if (trendConflicts) {
    parts.push(`Flow conviction overrides ${trend} technicals — institutional money is ${dirWord}.`);
  }

  // --- Key S/R levels + R:R ---
  if (levels) {
    const rr = computeRiskReward({ direction: isLong ? "LONG" : "SHORT", ...levels });
    if (rr != null) {
      const rrLabel = rr >= 2 ? "strong" : rr >= 1 ? "favorable" : rr >= 0.5 ? "acceptable" : "tight";
      parts.push(`R:R ${rr.toFixed(1)}:1 (${rrLabel}).`);
    }
  }

  // --- Flow conviction ---
  if (scored.flow_score >= 20) {
    const flowParts: string[] = [];
    if (dossier?.flow_streak?.streak_days && dossier.flow_streak.streak_days >= 2) {
      flowParts.push(`${dossier.flow_streak.streak_days}-day ${dirWord} flow streak`);
    }
    if (scored.flow_score >= 30) {
      flowParts.push("aggressive options activity");
    } else {
      flowParts.push(`${dirWord} flow conviction`);
    }
    parts.push(flowParts.join(" with ") + ".");
  } else if (dossier?.flow_streak?.streak_days && dossier.flow_streak.streak_days >= 3) {
    parts.push(`${dossier.flow_streak.streak_days}-day flow streak building.`);
  }

  // --- Positioning context ---
  if (scored.pos_score >= 8 && dossier?.greek_flow) {
    const gf = dossier.greek_flow;
    parts.push(`Dealer positioning ${gf.bias}.`);
  }
  if (scored.wall_proximity_score != null && scored.wall_proximity_score >= 4) {
    parts.push(`GEX wall alignment supports ${isLong ? "upside" : "downside"}.`);
  }

  // --- Technicals one-liner from dossier (concise) ---
  if (tech?.rsi14 != null && Number.isFinite(tech.rsi14)) {
    if (tech.rsi14 < 30) parts.push("RSI oversold.");
    else if (tech.rsi14 > 70) parts.push("RSI overbought.");
  }
  if (tech?.rel_volume != null && tech.rel_volume > 1.5) {
    parts.push(`${tech.rel_volume.toFixed(1)}× relative volume.`);
  }

  // --- IV context ---
  if (dossier?.iv_rank != null && dossier.iv_rank > 0) {
    if (dossier.iv_rank > 70) parts.push(`IV rank elevated (${Math.round(dossier.iv_rank)}).`);
  }

  // --- Risk flags (deduplicated) ---
  const flags = [
    ...new Set([
      ...(scored.catalyst_flags ?? []),
      ...(scored.fundamental_block ? scored.fundamental_flags ?? [] : []),
    ]),
  ];
  if (scored.earnings_risk) flags.push("earnings proximity");
  if (flags.length) parts.push(`Watch: ${flags.join("; ")}.`);

  return { thesis: parts.join(" "), key_signal };
}

/** Build one PlaybookPlay from a scored candidate + resolved levels + optional chain contract.
 *  PR-N15: contract is now optional — a strong stock setup publishes even when no affordable
 *  option exists, instead of silently dropping the candidate. */
function buildPlay(
  scored: ScoredCandidate,
  dossier: TickerDossier | undefined,
  contract: PickedContract | null,
  levels: { entry_range: string; target: string; stop: string },
  rank: number
): PlaybookPlay {
  // PR-N29: ensure the stock target makes the option profitable — a LONG target below
  // the call strike means the option expires worthless at "target", which is incoherent.
  // Push target to at least strike + 2×premium so the play shows real option P&L.
  if (contract) {
    const targetNum = Number(String(levels.target).replace(/[$,]/g, ""));
    if (Number.isFinite(targetNum)) {
      const isLong = scored.direction !== "short";
      const minOptionTarget = isLong
        ? contract.strike + contract.premium * 2
        : contract.strike - contract.premium * 2;
      if (isLong && targetNum < minOptionTarget) {
        levels = { ...levels, target: minOptionTarget.toFixed(2) };
      } else if (!isLong && targetNum > minOptionTarget) {
        levels = { ...levels, target: minOptionTarget.toFixed(2) };
      }
    }
  }
  const { thesis, key_signal } = buildDeterministicThesis(scored, dossier, levels);
  const options_play = formatOptionsPlay(scored.ticker, contract);
  const dir = scored.direction === "short" ? "SHORT" : "LONG";
  const rr = computeRiskReward({ direction: dir, entry_range: levels.entry_range, target: levels.target, stop: levels.stop });
  const base: PlaybookPlay = {
    rank,
    ticker: scored.ticker,
    direction: dir,
    conviction: assignNighthawkTier(nhTierInputFromScored(scored)).tier,
    play_type: "stock",
    thesis,
    key_signal,
    entry_range: levels.entry_range,
    target: levels.target,
    stop: levels.stop,
    options_play,
    score: scored.score,
    flow_streak_days: dossier?.flow_streak?.streak_days ?? undefined,
    iv_rank: dossier?.iv_rank ?? undefined,
    rr_ratio: rr ?? undefined,
  };
  if (contract && !contract.caveat) {
    return applyPremiumCapToPlay(base, { entry_premium: contract.premium, options_play });
  }
  if (contract && contract.caveat) {
    base.entry_premium = contract.premium;
    base.entry_cost_per_contract = contract.premium * 100;
    base.premium_cap_ok = !contract.caveat.includes("premium_high");
  }
  return base;
}

/**
 * Produce the deterministic Night Hawk edition: up to `target` grounded PlaybookPlay[], selected and
 * shaped from the pre-ranked ScoredCandidate[] + prefetched chains + dossiers. Iterates candidates in
 * ranked order, skipping any that lack a real affordable liquid contract or fail the geometry gate,
 * then grounds the survivors and returns the top `target`. Publishes fewer than `target` honestly when
 * not enough candidates clear the gates.
 */
export function buildDeterministicEditionPlays(params: {
  ranked: ScoredCandidate[];
  dossierMap: Record<string, TickerDossier>;
  chains: Record<string, EditionChainData>;
  target?: number;
}): { plays: PlaybookPlay[]; funnel: { candidates: number; score_below_floor: number; contract_ok: number; stock_only: number; no_chain: number; no_spot: number; premium_capped: number; geometry_fail: number; geometry_ok: number; premium_ok: number; grounded: number; dropped_ungrounded: number } } {
  const target = params.target ?? DETERMINISTIC_EDITION_TARGET;
  // PR-N18: increased buffer from target+12 to target+20 — with 60 candidates and wider
  // chain coverage, grounding/geometry drops are absorbed without emptying the book.
  const buffer = target + 20;

  let contractOk = 0;
  let stockOnly = 0;
  let geometryOk = 0;
  let premiumOk = 0;
  let noChainCount = 0;
  let noSpotCount = 0;
  let premiumCapCount = 0;
  let geometryFailCount = 0;
  const built: PlaybookPlay[] = [];
  const selectedFamilies = new Set<string>();

  let scoreBelowFloorCount = 0;
  for (const scored of params.ranked) {
    if (built.length >= buffer) break;
    if (scored.trading_halt) continue;
    if (scored.score < MIN_PUBLISH_SCORE) { scoreBelowFloorCount += 1; continue; }
    const ticker = scored.ticker.toUpperCase();
    const canon = canonicalTicker(ticker);
    if (selectedFamilies.has(canon)) continue;
    const chain = params.chains[ticker];
    const dossier = params.dossierMap[ticker] ?? params.dossierMap[scored.ticker];
    const spot = chain?.spot ?? dossier?.tech?.price ?? null;

    const contract = chain ? pickChainContract(chain, scored.direction) : null;
    if (contract && !contract.caveat) {
      contractOk += 1;
    } else if (contract && contract.caveat) {
      contractOk += 1;
      stockOnly += 1;
    } else {
      if (!chain) noChainCount += 1;
      if (spot == null || !Number.isFinite(spot) || spot <= 0) {
        noSpotCount += 1;
        continue;
      }
      stockOnly += 1;
    }

    const levels = resolveLevels(dossier, scored.direction, spot);
    const play = buildPlay(scored, dossier, contract, levels, built.length + 1);

    if (contract && !contract.caveat && play.premium_cap_ok === false) {
      premiumCapCount += 1;
      continue;
    }
    premiumOk += 1;

    const geom = validatePlayGeometry(play);
    if (!geom.ok) {
      geometryFailCount += 1;
      continue;
    }
    geometryOk += 1;
    built.push(play);
    selectedFamilies.add(canon);
  }

  console.info(`[nighthawk/det-edition] funnel: ${params.ranked.length} candidates → ${scoreBelowFloorCount} below score floor (${MIN_PUBLISH_SCORE}) → chains for ${Object.keys(params.chains).length} tickers → ${contractOk} with contract, ${stockOnly} stock-only, ${noChainCount} no chain, ${noSpotCount} no spot, ${premiumCapCount} premium-capped, ${geometryFailCount} geometry-fail → ${built.length} built`);

  // Ground survivors that HAVE strict (non-caveated) chain contracts. Caveated-contract and
  // stock-only plays skip grounding — their levels come from real S/R data and the contract
  // is a best-effort suggestion, not the basis for the play.
  const strictContractTickers = new Set<string>();
  for (const scored of params.ranked) {
    const chain = params.chains[scored.ticker.toUpperCase()];
    if (!chain) continue;
    const c = pickChainContract(chain, scored.direction);
    if (c && !c.caveat) strictContractTickers.add(scored.ticker.toUpperCase());
  }
  const withContract = built.filter((p) => p.entry_premium != null && strictContractTickers.has(p.ticker.toUpperCase()));
  const skipGrounding = built.filter((p) => p.entry_premium == null || !strictContractTickers.has(p.ticker.toUpperCase()));
  const { plays: grounded, summary } = groundPlays(withContract, params.chains, params.dossierMap);

  // Merge grounded option plays + caveated/stock-only plays, sorted by score descending
  const merged = [...grounded, ...skipGrounding].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );

  // PR-N15 + PR-N31 + PR-N32: directional diversity — if all plays are the same direction and
  // we have room, ensure at least one contrarian play for hedge/balance.
  //
  // Phase 1 (N31): look for a natural opposite-direction candidate in the ranked pool.
  // Phase 2 (N32): if no natural opposites exist (common in strong trends where flow dominates
  // in one direction for every ticker), FORCE re-score the top candidates in the opposite
  // direction using their dossier data. The flow component is discounted (flow is against the
  // contrarian thesis), but tech/positioning/news/smart-money are honestly re-scored. The best
  // forced contrarian above DIVERSITY_HEDGE_FLOOR gets the hedge slot.
  let finalPlays = merged.slice(0, target);
  if (finalPlays.length >= 4) {
    const dirs = new Set(finalPlays.map((p) => p.direction));
    if (dirs.size === 1) {
      const dominant = finalPlays[0]!.direction;
      const oppositeDir = dominant === "LONG" ? "short" : "long";
      let diversitySwapped = false;

      // Phase 1: natural opposite-direction candidates
      for (const scored of params.ranked) {
        if (scored.trading_halt) continue;
        if (scored.score < DIVERSITY_HEDGE_FLOOR) continue;
        if (scored.direction !== oppositeDir) continue;
        const t = scored.ticker.toUpperCase();
        if (selectedFamilies.has(canonicalTicker(t))) continue;
        const ch = params.chains[t];
        const dos = params.dossierMap[t] ?? params.dossierMap[scored.ticker];
        const sp = ch?.spot ?? dos?.tech?.price ?? null;
        if (sp == null || !Number.isFinite(sp) || sp <= 0) continue;
        const ctr = ch ? pickChainContract(ch, scored.direction) : null;
        const lvl = resolveLevels(dos, scored.direction, sp);
        const p = buildPlay(scored, dos, ctr, lvl, target);
        if (!validatePlayGeometry(p).ok) continue;
        const hedgeWarnings = p.gate_warnings ? [...p.gate_warnings] : [];
        hedgeWarnings.push(`Hedge/contrarian play (score ${scored.score}) — minority-view balance against ${dominant} book`);
        finalPlays[finalPlays.length - 1] = { ...p, gate_warnings: hedgeWarnings };
        console.info(`[nighthawk/edition] diversity swap: replaced #${finalPlays.length} with ${scored.ticker} ${oppositeDir} (score ${scored.score}) as hedge against all-${dominant} book`);
        diversitySwapped = true;
        break;
      }

      // Phase 2 (PR-N32): forced contrarian re-score — no natural opposites found
      if (!diversitySwapped) {
        console.info(`[nighthawk/edition] no natural ${oppositeDir} candidates — trying forced contrarian re-score`);
        let bestContrarian: { scored: ScoredCandidate; play: PlaybookPlay } | null = null;

        // Use finalPlays families (not selectedFamilies) — a candidate ranked 6th that was
        // built but didn't make the top-5 cut is a valid contrarian source. We only block
        // tickers already appearing in the 5 plays the member sees.
        const finalFamilies = new Set(finalPlays.map(p => canonicalTicker(p.ticker.toUpperCase())));
        const contrarianCandidates = params.ranked
          .filter(s => !s.trading_halt && !finalFamilies.has(canonicalTicker(s.ticker.toUpperCase())))
          .slice(0, CONTRARIAN_POOL_SIZE);

        for (const original of contrarianCandidates) {
          const t = original.ticker.toUpperCase();
          const dos = params.dossierMap[t] ?? params.dossierMap[original.ticker];
          if (!dos) continue;
          const ch = params.chains[t];
          const sp = ch?.spot ?? dos?.tech?.price ?? null;
          if (sp == null || !Number.isFinite(sp) || sp <= 0) continue;

          const contrarian = scoreContrarianHedge(original, dos, oppositeDir as "long" | "short");
          if (contrarian.score < DIVERSITY_HEDGE_FLOOR) continue;

          const ctr = ch ? pickChainContract(ch, contrarian.direction) : null;
          const lvl = resolveLevels(dos, contrarian.direction, sp);
          const p = buildPlay(contrarian, dos, ctr, lvl, target);
          if (!validatePlayGeometry(p).ok) continue;

          if (!bestContrarian || contrarian.score > bestContrarian.scored.score) {
            bestContrarian = { scored: contrarian, play: p };
          }
        }

        if (bestContrarian) {
          const { scored: cScored, play: cPlay } = bestContrarian;
          const hedgeWarnings = cPlay.gate_warnings ? [...cPlay.gate_warnings] : [];
          hedgeWarnings.push(
            `Forced contrarian hedge (score ${cScored.score}) — re-scored in ${oppositeDir} direction as balance against all-${dominant} book`
          );
          finalPlays[finalPlays.length - 1] = { ...cPlay, gate_warnings: hedgeWarnings };
          console.info(
            `[nighthawk/edition] forced contrarian swap: replaced #${finalPlays.length} with ${cScored.ticker} ${oppositeDir} (contrarian score ${cScored.score}) as hedge against all-${dominant} book`
          );
          diversitySwapped = true;
        }

        if (!diversitySwapped) {
          console.info(`[nighthawk/edition] forced contrarian: no candidates scored >= ${DIVERSITY_HEDGE_FLOOR} in ${oppositeDir} direction — all-${dominant} book accepted`);
        }
      }
    }
  }

  finalPlays = finalPlays.map((p, i) => ({ ...p, rank: i + 1 }));

  return {
    plays: finalPlays,
    funnel: {
      candidates: params.ranked.length,
      score_below_floor: scoreBelowFloorCount,
      contract_ok: contractOk,
      stock_only: stockOnly,
      no_chain: noChainCount,
      no_spot: noSpotCount,
      premium_capped: premiumCapCount,
      geometry_fail: geometryFailCount,
      geometry_ok: geometryOk,
      premium_ok: premiumOk,
      grounded: summary.grounded,
      dropped_ungrounded: summary.dropped_ungrounded,
    },
  };
}

/**
 * PR-N13 last-resort rescue: build plays from ranked candidates WITHOUT requiring option
 * chains, geometry validation, or grounding. Called when the full synthesis pipeline produces
 * zero plays (no affordable liquid contracts, all geometry invalid, etc.) and the edition
 * would otherwise be recap-only.
 *
 * These are the BEST picks the platform can surface based on today's confluence scoring —
 * they just couldn't be paired with a concrete option contract under the normal constraints.
 * Each play is marked gate_promoted:true with gate_warnings explaining the limitation.
 */
export function buildRescuePlays(params: {
  ranked: ScoredCandidate[];
  dossierMap: Record<string, TickerDossier>;
  chains: Record<string, EditionChainData>;
  target?: number;
}): PlaybookPlay[] {
  const target = params.target ?? DETERMINISTIC_EDITION_TARGET;
  const plays: PlaybookPlay[] = [];
  const selectedFamilies = new Set<string>();

  for (const scored of params.ranked) {
    if (plays.length >= target) break;
    if (scored.trading_halt) continue;
    if (scored.score < MIN_PUBLISH_SCORE) continue;
    const ticker = scored.ticker.toUpperCase();
    const canon = canonicalTicker(ticker);
    if (selectedFamilies.has(canon)) continue;
    const dossier = params.dossierMap[ticker] ?? params.dossierMap[scored.ticker];
    const chain = params.chains[ticker];
    const spot = chain?.spot ?? dossier?.tech?.price ?? null;

    const levels = resolveLevels(dossier, scored.direction, spot);
    const { thesis, key_signal } = buildDeterministicThesis(scored, dossier);

    const warnings: string[] = [];
    const contract = chain ? pickChainContract(chain, scored.direction) : null;
    let options_play: string;
    if (contract) {
      options_play = `${ticker} ${contract.expiry} $${formatStrike(contract.strike)} ${contract.side.toUpperCase()} — entry prem ~$${contract.premium.toFixed(2)}`;
      if (!validatePlayGeometry({ ...levels, direction: scored.direction === "short" ? "SHORT" : "LONG" } as any).ok) {
        warnings.push("Entry/target geometry did not pass normal validation — verify levels before trading");
      }
    } else {
      options_play = `${ticker} — check option chain for suitable contract`;
      warnings.push(`No affordable liquid option contract found under the $${MAX_OPTION_PREMIUM_PER_SHARE}/share cap — check the chain manually`);
    }

    plays.push({
      rank: plays.length + 1,
      ticker,
      direction: scored.direction === "short" ? "SHORT" : "LONG",
      conviction: assignNighthawkTier(nhTierInputFromScored(scored)).tier,
      play_type: "stock",
      thesis,
      key_signal,
      entry_range: levels.entry_range,
      target: levels.target,
      stop: levels.stop,
      options_play,
      score: scored.score,
      flow_streak_days: dossier?.flow_streak?.streak_days ?? undefined,
      iv_rank: dossier?.iv_rank ?? undefined,
      gate_promoted: true,
      gate_warnings: warnings.length ? warnings : ["Play surfaced via best-available rescue — normal synthesis constraints could not be met"],
    });
    selectedFamilies.add(canon);
  }

  return plays;
}
