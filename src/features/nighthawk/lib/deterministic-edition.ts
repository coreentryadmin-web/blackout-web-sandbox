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
import { assignNighthawkTier, nhTierInputFromScored } from "./nighthawk-tiers";
import type { PlaybookPlay } from "./types";
import { buildDirectionalStockLevels, formatStockLevel } from "./play-levels";
import { applyPremiumCapToPlay, validatePlayGeometry, canonicalTicker } from "./play-constraints";
import { groundPlays } from "./grounding";
import { GROUNDING_MIN_OI, tieredMinOi } from "./grounding";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";

/** Default number of plays a full edition publishes. Mirrors the Claude path's top-5 shape. */
export const DETERMINISTIC_EDITION_TARGET = 5;

/** A contract chosen off the chain for a play, with the premium that will be shown to members. */
type PickedContract = {
  strike: number;
  side: "call" | "put";
  expiry: string;
  /** Per-share premium (mid when both sides quote, else the ask). Always ≤ the premium cap. */
  premium: number;
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
 *  integers ("$120"); fractional strikes keep up to two decimals with no trailing zeros ("$122.5"). */
function formatStrike(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : String(Number(strike.toFixed(2)));
}

/**
 * Pick the most at-the-money strike on the chosen side that is BOTH liquid (OI ≥ the grounding floor)
 * AND affordable (premium ≤ the per-share cap). Long ⇒ calls, short ⇒ puts. Deterministic tie-break:
 * closest strike to spot first, then nearest expiry, then lower strike — so identical inputs always
 * yield the identical contract. Returns null when no strike clears both gates (⇒ skip the candidate).
 */
export function pickChainContract(
  chain: EditionChainData,
  direction: "long" | "short"
): PickedContract | null {
  const side: "call" | "put" = direction === "long" ? "call" : "put";
  const spot = chain.spot;
  const minOi = spot > 0 ? tieredMinOi(spot) : GROUNDING_MIN_OI;
  const eligible: Array<PickedContract & { dist: number }> = [];
  for (const row of chain.rows) {
    const oi = contractOi(row, side);
    if (oi < minOi) continue;
    const premium = contractPremium(row, side);
    if (premium == null || premium > MAX_OPTION_PREMIUM_PER_SHARE) continue;
    eligible.push({
      strike: row.strike,
      side,
      expiry: row.expiry,
      premium: Number(premium.toFixed(2)),
      dist: spot > 0 ? Math.abs(row.strike - spot) : row.strike,
    });
  }
  if (!eligible.length) return null;
  eligible.sort(
    (a, b) => a.dist - b.dist || a.expiry.localeCompare(b.expiry) || a.strike - b.strike
  );
  const best = eligible[0]!;
  return { strike: best.strike, side: best.side, expiry: best.expiry, premium: best.premium };
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

  return buildDirectionalStockLevels({ direction, support, resistance, spot: px });
}

/**
 * Build a concise, GROUNDED thesis from the deterministic score breakdown + dossier technicals. Leads
 * with the dominant scoring drivers (flow / technical / positioning / smart-money / news) so members
 * see WHY the play ranked, then appends the technicals one-liner and any risk flags. No prose the
 * numbers can't back — this is the same data the score itself is computed from.
 */
export function buildDeterministicThesis(
  scored: ScoredCandidate,
  dossier: TickerDossier | undefined
): { thesis: string; key_signal: string } {
  const dirWord = scored.direction === "short" ? "bearish" : "bullish";
  const drivers: Array<{ label: string; value: number }> = [
    { label: "options flow", value: scored.flow_score },
    { label: "technical setup", value: scored.tech_score },
    { label: "dealer/OI positioning", value: scored.pos_score },
    { label: "smart-money", value: scored.smart_money_score },
    { label: "news/catalyst", value: scored.news_score },
  ];
  // Include fundamental and short-interest if they're material.
  if (scored.fundamental_score != null && Math.abs(scored.fundamental_score) >= 2) {
    drivers.push({ label: "fundamentals", value: scored.fundamental_score });
  }
  if (scored.short_interest_score != null && scored.short_interest_score >= 3) {
    drivers.push({ label: "short squeeze", value: scored.short_interest_score });
  }

  const top = drivers
    .filter((d) => Number.isFinite(d.value) && Math.abs(d.value) >= 1)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3);
  const driverText = top.length
    ? top.map((d) => `${d.label} (${d.value > 0 ? "+" : ""}${Math.round(d.value)})`).join(", ")
    : "composite confluence";

  const key_signal = `${dirWord.toUpperCase()} — score ${scored.score} (${scored.conviction}); ${driverText}.`;

  const parts: string[] = [
    `${dirWord.charAt(0).toUpperCase() + dirWord.slice(1)} ${scored.ticker}: score ${scored.score} (${scored.conviction}), driven by ${driverText}.`,
  ];
  if (dossier?.tech?.summary) parts.push(dossier.tech.summary);
  if (dossier?.flow_streak?.streak_days && dossier.flow_streak.streak_days >= 2) {
    parts.push(`${dossier.flow_streak.streak_days}-day flow streak.`);
  }
  if (dossier?.iv_rank != null && dossier.iv_rank > 0) {
    const ivLabel = dossier.iv_rank > 70 ? "elevated" : dossier.iv_rank > 40 ? "moderate" : "low";
    parts.push(`IV rank ${Math.round(dossier.iv_rank)} (${ivLabel}).`);
  }
  if (dossier?.greek_flow) {
    const gf = dossier.greek_flow;
    parts.push(`Dealer flow ${gf.bias} (net Δ ${gf.net_delta > 0 ? "+" : ""}${Math.round(gf.net_delta).toLocaleString()}).`);
  }
  const flags = [
    ...(scored.catalyst_flags ?? []),
    ...(scored.fundamental_block ? scored.fundamental_flags ?? [] : []),
  ];
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
  const { thesis, key_signal } = buildDeterministicThesis(scored, dossier);
  const options_play = contract
    ? `${scored.ticker} ${contract.expiry} $${formatStrike(contract.strike)} ${contract.side.toUpperCase()} — entry prem ~$${contract.premium.toFixed(2)}`
    : `${scored.ticker} — check option chain for suitable contract`;
  const base: PlaybookPlay = {
    rank,
    ticker: scored.ticker,
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
  };
  if (contract) {
    return applyPremiumCapToPlay(base, { entry_premium: contract.premium, options_play });
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
}): { plays: PlaybookPlay[]; funnel: { candidates: number; contract_ok: number; stock_only: number; no_chain: number; no_spot: number; premium_capped: number; geometry_fail: number; geometry_ok: number; premium_ok: number; grounded: number; dropped_ungrounded: number } } {
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

  for (const scored of params.ranked) {
    if (built.length >= buffer) break;
    if (scored.trading_halt) continue;
    const ticker = scored.ticker.toUpperCase();
    const canon = canonicalTicker(ticker);
    if (selectedFamilies.has(canon)) continue;
    const chain = params.chains[ticker];
    const dossier = params.dossierMap[ticker] ?? params.dossierMap[scored.ticker];
    const spot = chain?.spot ?? dossier?.tech?.price ?? null;

    const contract = chain ? pickChainContract(chain, scored.direction) : null;
    if (contract) {
      contractOk += 1;
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

    if (contract && play.premium_cap_ok === false) {
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

  console.info(`[nighthawk/det-edition] funnel: ${params.ranked.length} candidates → chains for ${Object.keys(params.chains).length} tickers → ${contractOk} with contract, ${stockOnly} stock-only, ${noChainCount} no chain, ${noSpotCount} no spot, ${premiumCapCount} premium-capped, ${geometryFailCount} geometry-fail → ${built.length} built`);

  // Ground survivors that HAVE chain contracts (stock-only plays skip grounding since
  // there's no contract to reconcile — their levels are already from real S/R data).
  const withContract = built.filter((p) => p.entry_premium != null);
  const stockOnlyPlays = built.filter((p) => p.entry_premium == null);
  const { plays: grounded, summary } = groundPlays(withContract, params.chains, params.dossierMap);

  // Merge grounded option plays + stock-only plays, sorted by score descending
  const merged = [...grounded, ...stockOnlyPlays].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );

  // PR-N15: directional diversity — if all plays are the same direction and we have room,
  // ensure at least one contrarian play for hedge/balance. A 5-play all-LONG book in a
  // bullish market leaves members with zero downside protection.
  let finalPlays = merged.slice(0, target);
  if (finalPlays.length >= 4) {
    const dirs = new Set(finalPlays.map((p) => p.direction));
    if (dirs.size === 1) {
      const dominant = finalPlays[0]!.direction;
      const oppositeDir = dominant === "LONG" ? "short" : "long";
      for (const scored of params.ranked) {
        if (scored.trading_halt) continue;
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
        // Replace the weakest same-direction play with this contrarian play
        finalPlays[finalPlays.length - 1] = p;
        break;
      }
    }
  }

  finalPlays = finalPlays.map((p, i) => ({ ...p, rank: i + 1 }));

  return {
    plays: finalPlays,
    funnel: {
      candidates: params.ranked.length,
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
