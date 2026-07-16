import { getPlatformSnapshot } from "@/lib/platform";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { todayEt as todayEtStr } from "@/lib/et-date";
import { extractCandidateTickers } from "./candidates";
import { generateEditionPlays } from "./claude-edition";
import { DOSSIER_BATCH_SIZE, MAX_CANDIDATES, MAX_DOSSIER_STOCKS } from "./constants";
import { fetchAllDossiers, resetEditionCongressCache, type TickerDossier } from "./dossier";
import {
  applyHuntScoreFilters,
  huntModeWeights,
  normalizeHuntFilters,
} from "./hunt-mode";
import { parseEntryPremiumPerShare } from "./play-constraints";
import { optionsPlayWithinMaxDte } from "./agents/day-trade-filters";
import { fetchMarketWideContext } from "./market-wide";
import { rankCandidates, regimeContextFromMarket, scoreCandidate, scoreFlowQuality } from "./scorer";
import type { HuntMode, HuntPlay, HuntRequest, PlaybookPlay } from "./types";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";

export type HuntBuildResult = {
  ok: boolean;
  plays: HuntPlay[];
  playbookPlays: PlaybookPlay[];
  message: string;
  candidates: number;
  error?: string;
  duration_ms: number;
};

function toHuntPlay(play: PlaybookPlay): HuntPlay {
  return {
    ticker: play.ticker,
    direction: play.direction,
    thesis: play.thesis || play.key_signal,
    contract: play.options_play,
    entry: play.entry_range,
    target: play.target,
    stop: play.stop,
    score: play.score,
  };
}

function flowPremium(flow: Record<string, unknown>): number | null {
  const raw = flow.premium ?? flow.total_premium ?? flow.premium_total;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Per-share option premium from UW flow row (not block total). */
function flowEntryPremiumPerShare(flow: Record<string, unknown>): number | null {
  const direct = Number(flow.price ?? flow.fill_price ?? flow.avg_fill ?? flow.per_share_premium);
  if (Number.isFinite(direct) && direct > 0 && direct < 500) return direct;

  const block = flowPremium(flow);
  if (block == null) return null;

  const contracts = Number(flow.size ?? flow.volume ?? flow.total_size ?? flow.contracts);
  if (Number.isFinite(contracts) && contracts > 0) {
    const perShare = block / (contracts * 100);
    if (Number.isFinite(perShare) && perShare > 0 && perShare < 500) return perShare;
  }
  return null;
}

function filterPlaybookPlays(
  plays: PlaybookPlay[],
  filters: ReturnType<typeof normalizeHuntFilters>
): PlaybookPlay[] {
  let out = plays;
  if (filters.max_entry_premium != null) {
    out = out.filter((p) => {
      const prem = p.entry_premium ?? parseEntryPremiumPerShare(p);
      return prem == null || prem <= filters.max_entry_premium!;
    });
  }
  if (filters.dte_max != null) {
    out = out.filter((p) => optionsPlayWithinMaxDte(p.options_play, filters.dte_max!));
  }
  return out;
}

function flowDteDays(flow: Record<string, unknown>): number | null {
  const exp = String(flow.expiry ?? flow.expiration ?? "");
  if (!exp) return null;
  const expMs = new Date(exp.includes("T") ? exp : `${exp}T16:00:00-04:00`).getTime();
  if (!Number.isFinite(expMs)) return null;
  const todayEt = todayEtStr();
  const todayMs = new Date(`${todayEt}T12:00:00-04:00`).getTime();
  return Math.round((expMs - todayMs) / 86_400_000);
}

function dossierHasCatalyst(dossier: TickerDossier): boolean {
  return (
    dossier.news_headlines.length > 0 ||
    dossier.polygon_sentiment.length > 0 ||
    (dossier.catalysts?.length ?? 0) > 0 ||
    dossier.predictions_signal != null ||
    dossier.congress_unusual.length > 0 ||
    dossier.insider_buys > 0
  );
}

function dossierPassesPrefilters(dossier: TickerDossier, filters: ReturnType<typeof normalizeHuntFilters>): boolean {
  if (filters.sector) {
    const sector = (dossier.sector ?? "").toLowerCase();
    if (!sector.includes(filters.sector.toLowerCase())) return false;
  }
  if (filters.min_streak != null && dossier.flow_streak.streak_days < filters.min_streak) {
    return false;
  }
  if (filters.max_iv_rank != null && dossier.iv_rank != null && dossier.iv_rank > filters.max_iv_rank) {
    return false;
  }
  if (filters.dte_min != null || filters.dte_max != null) {
    const dtes = dossier.flows.map(flowDteDays).filter((d): d is number => d != null);
    if (dtes.length) {
      const nearest = Math.min(...dtes);
      if (filters.dte_min != null && nearest < filters.dte_min) return false;
      if (filters.dte_max != null && nearest > filters.dte_max) return false;
    }
  }
  if (filters.require_catalyst && !dossierHasCatalyst(dossier)) {
    return false;
  }
  if (filters.max_entry_premium != null) {
    const perShare = dossier.flows
      .map(flowEntryPremiumPerShare)
      .filter((p): p is number => p != null);
    if (perShare.length && Math.min(...perShare) > filters.max_entry_premium) return false;
  }
  return true;
}

/** Returns tomorrow's date (YYYY-MM-DD) if the ticker appears in tomorrow_earnings, else null. */
function earningsDateForTicker(
  ticker: string,
  tomorrowEarnings: Record<string, unknown>[],
  tomorrow: string
): string | null {
  const sym = ticker.toUpperCase();
  const hit = tomorrowEarnings.some(
    (r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym
  );
  return hit ? tomorrow : null;
}

export function rescoreDossier(
  dossier: TickerDossier,
  regime: ReturnType<typeof regimeContextFromMarket>,
  streakWeight: number,
  ctx: { today: string; tomorrow: string; tomorrow_earnings: Record<string, unknown>[] }
) {
  const earningsDate = earningsDateForTicker(dossier.ticker, ctx.tomorrow_earnings, ctx.tomorrow);
  dossier.scored = scoreCandidate(
    dossier.ticker,
    dossier.flows,
    dossier.tech,
    {
      dark_pool: dossier.dark_pool,
      oi_change: dossier.oi_change,
      positioning: dossier.positioning,
      strike_stacks: dossier.strike_stacks,
      news_headlines: [...dossier.news_headlines, ...dossier.polygon_sentiment],
      catalysts: dossier.catalysts,
      insider_buys: dossier.insider_buys,
      predictions_signal: dossier.predictions_signal,
      congress_unusual: dossier.congress_unusual,
      congress_trades: dossier.congress_trades,
      institutional_activity: dossier.institutional_activity,
      fundamental_ratios: dossier.fundamental_ratios,
      trading_halt: dossier.trading_halt,
      risk_reversal_skew: dossier.risk_reversal_skew,
      short_days_to_cover: dossier.short_days_to_cover,
      earnings_date: earningsDate,
      today_ymd: ctx.today,
      tomorrow_ymd: ctx.tomorrow,
      benzinga_price_target: dossier.benzinga_price_target,
      greek_flow: dossier.greek_flow,
    },
    dossier.flow_streak,
    regime,
    { streakWeight }
  );
}

/** Run the full Night Hawk hunt scan synchronously (edition pipeline + mode overrides). */
export async function runHuntScan(request: HuntRequest): Promise<HuntBuildResult> {
  const started = Date.now();
  const mode = request.mode;
  const weights = huntModeWeights(mode);
  const filters = normalizeHuntFilters(mode, request.filters ?? {});

  if (!uwConfigured() && !polygonConfigured()) {
    return {
      ok: false,
      plays: [],
      playbookPlays: [],
      message: "No market data API keys configured (UW or Polygon required).",
      candidates: 0,
      error: "missing_api_keys",
      duration_ms: Date.now() - started,
    };
  }

  try {
    console.info("[nighthawk/hunt] phase 1: market-wide context");
    const ctx = await fetchMarketWideContext();
    const regime = regimeContextFromMarket(ctx);

    console.info("[nighthawk/hunt] phase 2: candidate selection");
    const candidates = await extractCandidateTickers(ctx.stock_flows, ctx.hot_chains, MAX_CANDIDATES, {
      topNetImpact: ctx.top_net_impact,
      sweepBonus: weights.sweepBonus,
      minLiquidity: filters.min_premium ?? weights.minLiquidity,
      watchlist: filters.watchlist,
    });

    if (!candidates.length) {
      return {
        ok: false,
        plays: [],
        playbookPlays: [],
        message: "No flow candidates matched your hunt filters.",
        candidates: 0,
        error: "no_candidates",
        duration_ms: Date.now() - started,
      };
    }

    console.info(`[nighthawk/hunt] phase 3: dossiers for ${candidates.length} tickers`);
    resetEditionCongressCache();
    const dossiers = await fetchAllDossiers(candidates, DOSSIER_BATCH_SIZE, regime);

    const dossierList = Object.values(dossiers).filter(
      (d) => d.scored != null && dossierPassesPrefilters(d, filters)
    );

    for (const dossier of dossierList) {
      rescoreDossier(dossier, regime, weights.streakWeight, ctx);
    }

    // HELIX Postgres flow score: query flow_alerts for the last 4h per ticker and run
    // the same scoreFlowQuality logic so the numeric flow signal from the HELIX tape
    // contributes to the scored total (not just as injected text for Claude).
    if (dbConfigured()) {
      const helixFlowMap: Record<string, number> = {};
      await Promise.all(
        dossierList.map(async (dossier) => {
          try {
            const pgRows = await fetchRecentFlows({
              ticker: dossier.ticker,
              since_hours: 4,
              min_premium: 50_000,
              order: "premium",
            });
            if (pgRows.length > 0) {
              // Map PG FlowRow shape to the generic Record<string, unknown>[] scoreFlowQuality expects.
              const mapped = pgRows.map((r) => ({
                total_premium: r.premium,
                option_type: r.option_type,
                expiry: r.expiry,
                strike: r.strike,
                ask_side_pct: r.ask_pct ?? null,
                is_sweep: r.alert_rule?.toLowerCase().includes("sweep") ?? false,
                is_opening: false, // PG rows lack explicit opening-trade flag
              }));
              const helix = scoreFlowQuality(mapped);
              helixFlowMap[dossier.ticker] = helix.direction === dossier.scored?.direction
                ? helix.score
                : -helix.score; // negative marker: live tape CONTRADICTS the thesis
            }
          } catch {
            // Non-fatal: Postgres may be unavailable during overnight cron; skip gracefully.
          }
        })
      );
      // HELIX CONFIRMATION bonus (audit HIGH — the old version was the pipeline's most
      // plausible false-strong source). Three fixes vs the raw "+= helixScore":
      //  1. The Postgres tape is the SAME UW flow-alerts feed the dossier's flow_score
      //     already scored — adding a second full 0–38 read double-counted one signal.
      //     Treated as CONFIRMATION now: capped at +8 (score/4).
      //  2. Direction-gated: a put-dominant live tape no longer boosts a LONG. A
      //     contradicting tape applies a small penalty (−4 max) instead of a bonus.
      //  3. Regime-scaled: the base score already carries regimeMultiplier; the raw
      //     add-on bypassed it. Scale the bonus by the candidate's own multiplier.
      for (const dossier of dossierList) {
        const scored = dossier.scored;
        if (!scored) continue;
        const helixRead = helixFlowMap[dossier.ticker] ?? 0;
        if (helixRead === 0) continue;
        const mult = scored.regime_multiplier ?? 1;
        const bonus = helixRead > 0
          ? Math.min(8, Math.round((helixRead / 4) * mult))
          : -Math.min(4, Math.round((-helixRead / 8) * mult));
        scored.score = Math.min(100, Math.max(0, scored.score + bonus));
      }
    }

    const scoredList = dossierList.map((d) => d.scored!).filter(Boolean);
    const filtered = applyHuntScoreFilters(scoredList, filters);
    const { ranked, exclusionReason } = rankCandidates(filtered, MAX_DOSSIER_STOCKS);
    const topDossiers = ranked.map((s) => dossiers[s.ticker]).filter(Boolean);

    if (!ranked.length) {
      return {
        ok: false,
        plays: [],
        playbookPlays: [],
        message: exclusionReason ?? "Candidates scanned but none passed hunt score filters.",
        candidates: candidates.length,
        error: "no_ranked",
        duration_ms: Date.now() - started,
      };
    }

    const effectiveMaxDte =
      filters.dte_max != null
        ? filters.dte_max
        : mode === "day" && filters.max_dte != null
          ? filters.max_dte
          : weights.maxDte;

    console.info(`[nighthawk/hunt] phase 4: Claude synthesis (${ranked.length} ranked)`);
    const { plays: rawPlays } = await generateEditionPlays({
      ctx,
      dossiers: topDossiers,
      ranked,
      huntMode: mode,
      maxDte: effectiveMaxDte,
    });

    const playbookPlays = filterPlaybookPlays(rawPlays, filters);

    if (!playbookPlays.length) {
      return {
        ok: false,
        plays: [],
        playbookPlays: [],
        message: anthropicConfigured()
          ? "Scan complete but Claude returned no parseable plays."
          : "Claude not configured — mechanical fallback produced no plays.",
        candidates: candidates.length,
        error: "no_plays",
        duration_ms: Date.now() - started,
      };
    }

    const huntPlays = playbookPlays.map(toHuntPlay);
    return {
      ok: true,
      plays: huntPlays,
      playbookPlays,
      message: `${mode} hunt complete — ${huntPlays.length} plays from ${candidates.length} candidates.`,
      candidates: candidates.length,
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[nighthawk/hunt] failed:", error);
    return {
      ok: false,
      plays: [],
      playbookPlays: [],
      message: `Hunt failed: ${message}`,
      candidates: 0,
      error: message,
      duration_ms: Date.now() - started,
    };
  }
}

export async function huntPlatformContext() {
  const platform = await getPlatformSnapshot({ include: ["spx", "flows", "nighthawk"], flowLimit: 40 });
  return {
    spx_price: platform.spx?.price ?? null,
    flow_alerts: platform.flows?.count ?? 0,
    edition_for: platform.nighthawk?.edition_for ?? null,
    edition_plays: platform.nighthawk?.play_count ?? 0,
  };
}
