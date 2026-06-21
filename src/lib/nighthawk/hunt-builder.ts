import { getPlatformSnapshot } from "@/lib/platform";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { anthropicConfigured } from "@/lib/providers/anthropic";
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
import { rankCandidates, regimeContextFromMarket, scoreCandidate } from "./scorer";
import type { HuntMode, HuntPlay, HuntRequest, PlaybookPlay } from "./types";

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
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const todayMs = new Date(`${todayEt}T12:00:00-04:00`).getTime();
  return Math.round((expMs - todayMs) / 86_400_000);
}

function dossierHasCatalyst(dossier: TickerDossier): boolean {
  return (
    dossier.news_headlines.length > 0 ||
    dossier.polygon_sentiment.length > 0 ||
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

function rescoreDossier(
  dossier: TickerDossier,
  regime: ReturnType<typeof regimeContextFromMarket>,
  streakWeight: number
) {
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
      insider_buys: dossier.insider_buys,
      predictions_signal: dossier.predictions_signal,
      congress_unusual: dossier.congress_unusual,
      congress_trades: dossier.congress_trades,
      institutional_activity: dossier.institutional_activity,
      fundamental_ratios: dossier.fundamental_ratios,
      trading_halt: dossier.trading_halt,
      risk_reversal_skew: dossier.risk_reversal_skew,
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
      rescoreDossier(dossier, regime, weights.streakWeight);
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
