/**
 * DETERMINISTIC PLAY CRITIC (Phase 3 rebuild — no Claude LLM).
 *
 * Replaces the Claude-based skeptical reviewer with rule-based quality checks that catch
 * the same defect classes the LLM critic was designed for:
 *   - Direction inconsistency (flow direction vs play direction)
 *   - Thin signal confirmation (fewer than 2 positive scoring dimensions)
 *   - Regime contradiction (bearish tide + bullish long play, etc.)
 *   - Score floor (C-conviction plays are cut — not strong enough to publish)
 *   - Conviction inflation (downgrade when confirming signals are weak)
 *
 * When Claude was off (staging), the old critic passed every play through unchanged — no
 * quality review at all. This deterministic critic runs on every deploy, using the same
 * scored-candidate data the ranker already computed.
 */
import type { TickerDossier } from "./dossier";
import type { MarketWideContext } from "./market-wide";
import type { ScoredCandidate } from "./scorer";
import { assignNighthawkTier, nhTierInputFromScored, nhConvictionRank } from "./nighthawk-tiers";
import type { PlaybookPlay } from "./types";

/** Minimum composite score for a play to publish — below this it's cut. */
const CRITIC_SCORE_FLOOR = 25;

/** Minimum number of positive scoring dimensions (out of flow/tech/pos/news/smart_money)
 *  for a play to pass without a downgrade. */
const MIN_CONFIRMING_SIGNALS = 2;

function scoredForPlay(
  play: PlaybookPlay,
  dossiers: Record<string, TickerDossier>,
  ranked: ScoredCandidate[]
): ScoredCandidate | undefined {
  const fromRanked = ranked.find((r) => r.ticker.toUpperCase() === play.ticker.toUpperCase());
  if (fromRanked) return fromRanked;
  const dossier = dossiers[play.ticker.toUpperCase()];
  return dossier?.scored;
}

/** Count how many of the 5 core scoring dimensions are positive (>0). */
function countConfirmingSignals(scored: ScoredCandidate): number {
  let count = 0;
  if (scored.flow_score > 0) count++;
  if (scored.tech_score > 0) count++;
  if (scored.pos_score > 0) count++;
  if (scored.news_score > 0) count++;
  if (scored.smart_money_score > 0) count++;
  return count;
}

/** Check if the market tide contradicts the play direction. */
function tideContradictsDirection(
  tide: MarketWideContext["tide"],
  direction: string
): boolean {
  if (!tide) return false;
  const tideStr = typeof tide === "string" ? tide : String(tide);
  const tideLower = tideStr.toLowerCase();
  const isShort = direction.toUpperCase().includes("SHORT");

  if (isShort && tideLower.includes("bullish")) return true;
  if (!isShort && tideLower.includes("bearish")) return true;
  return false;
}

export async function critiquePlays(params: {
  plays: PlaybookPlay[];
  dossiers: Record<string, TickerDossier>;
  ranked: ScoredCandidate[];
  ctx: MarketWideContext;
}): Promise<{ plays: PlaybookPlay[]; notes: string[] }> {
  const { plays, dossiers, ranked, ctx } = params;
  if (!plays.length) return { plays, notes: [] };

  const notes: string[] = [];
  const surviving: PlaybookPlay[] = [];

  for (const play of plays) {
    const scored = scoredForPlay(play, dossiers, ranked);

    // No scored data → pass through (backfill plays may not have scored candidates).
    if (!scored) {
      surviving.push(play);
      continue;
    }

    // CUT: score below floor.
    if (scored.score < CRITIC_SCORE_FLOOR) {
      notes.push(
        `#${play.rank} ${play.ticker}: CUT — score ${scored.score} below floor ${CRITIC_SCORE_FLOOR}`
      );
      continue;
    }

    // CUT: direction inconsistency — the play's direction doesn't match the flow-derived direction.
    const playIsShort = play.direction.toUpperCase().includes("SHORT");
    const scoredIsShort = scored.direction === "short";
    if (playIsShort !== scoredIsShort) {
      notes.push(
        `#${play.rank} ${play.ticker}: CUT — play direction ${play.direction} contradicts flow-scored direction ${scored.direction}`
      );
      continue;
    }

    // CUT: trading halt (belt-and-suspenders — ranker should have excluded these).
    if (scored.trading_halt) {
      notes.push(`#${play.rank} ${play.ticker}: CUT — trading halt active`);
      continue;
    }

    // PR-N7: conviction ceiling is now the tier engine, not the old score→letter mapping.
    const tierResult = assignNighthawkTier(nhTierInputFromScored(scored));
    const deterministicConviction = tierResult.tier;
    let conviction = play.conviction;
    if (nhConvictionRank(conviction) > nhConvictionRank(deterministicConviction)) {
      notes.push(
        `#${play.rank} ${play.ticker}: DOWNGRADE conviction ${conviction} → ${deterministicConviction} (tier engine: ${tierResult.factors.map(f => f.label).join(", ")})`
      );
      conviction = deterministicConviction;
    }

    // DOWNGRADE: thin signal confirmation. Prefer the scorer's threshold-based count
    // (material contribution, not just >0) when available.
    const confirming = scored.confirming_signals ?? countConfirmingSignals(scored);
    if (confirming < MIN_CONFIRMING_SIGNALS && nhConvictionRank(conviction) > 2) {
      const newConviction = "B";
      notes.push(
        `#${play.rank} ${play.ticker}: DOWNGRADE ${conviction} → ${newConviction} — only ${confirming} confirming signal(s)`
      );
      conviction = newConviction;
    }

    // NOTE: regime contradiction — flag but don't cut (regime is a macro overlay, not a veto).
    if (tideContradictsDirection(ctx.tide, play.direction)) {
      notes.push(
        `#${play.rank} ${play.ticker}: NOTE — play direction ${play.direction} against current market tide`
      );
      // Downgrade by one notch if A+ or A.
      if (nhConvictionRank(conviction) >= 3) {
        const prev = conviction;
        conviction = nhConvictionRank(conviction) === 4 ? "A" : "B";
        notes.push(`#${play.rank} ${play.ticker}: DOWNGRADE ${prev} → ${conviction} (regime headwind)`);
      }
    }

    // NOTE: fundamental flags — informational, never a cut.
    if (scored.fundamental_block && scored.fundamental_flags?.length) {
      notes.push(
        `#${play.rank} ${play.ticker}: NOTE — fundamental flags: ${scored.fundamental_flags.join("; ")}`
      );
    }

    surviving.push({ ...play, conviction });
  }

  if (surviving.length < plays.length) {
    notes.push(
      `Publishing ${surviving.length} vetted play(s) — ${plays.length - surviving.length} cut by deterministic critic.`
    );
  }

  const reranked = surviving.map((p, i) => ({ ...p, rank: i + 1 }));
  return { plays: reranked, notes };
}
