import { upsertNighthawkEdition } from "@/lib/db";
import { marketPlatform } from "@/lib/platform";
import { uwConfigured } from "@/lib/providers/config";
import { polygonConfigured } from "@/lib/providers/config";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { extractCandidateTickers } from "./candidates";
import { fetchAllDossiers } from "./dossier";
import { generateEditionPlays } from "./claude-edition";
import { formatTickerDossierText } from "./format";
import { fetchIndexDossiers } from "./index-dossier";
import { fetchMarketWideContext } from "./market-wide";
import { rankCandidates } from "./scorer";
import { DOSSIER_BATCH_SIZE, MAX_CANDIDATES, MAX_DOSSIER_STOCKS } from "./constants";
import { nextTradingDayEt, todayEt } from "./session";
import type { NightHawkEdition, PlaybookPlay } from "./types";

export type EditionBuildResult = {
  ok: boolean;
  edition_for: string;
  plays_count: number;
  candidates: number;
  error?: string;
  duration_ms: number;
};

export async function buildEveningEdition(opts?: {
  force?: boolean;
}): Promise<EditionBuildResult> {
  const started = Date.now();
  const editionFor = nextTradingDayEt(todayEt());

  if (!uwConfigured() && !polygonConfigured()) {
    return {
      ok: false,
      edition_for: editionFor,
      plays_count: 0,
      candidates: 0,
      error: "No market data API keys configured (UW or Polygon required).",
      duration_ms: Date.now() - started,
    };
  }

  try {
    console.info("[nighthawk/edition] phase 1: market-wide context");
    const ctx = await fetchMarketWideContext();

    console.info("[nighthawk/edition] phase 2: candidate selection");
    const candidates = extractCandidateTickers(ctx.stock_flows, ctx.hot_chains, MAX_CANDIDATES);
    if (!candidates.length) {
      return {
        ok: false,
        edition_for: editionFor,
        plays_count: 0,
        candidates: 0,
        error: "No flow candidates found for today's session.",
        duration_ms: Date.now() - started,
      };
    }

    console.info(`[nighthawk/edition] phase 3: dossiers for ${candidates.length} tickers`);
    const dossiers = await fetchAllDossiers(candidates, DOSSIER_BATCH_SIZE);

    const scoredList = Object.values(dossiers)
      .filter((d) => d.tech != null)
      .map((d) => d.scored!)
      .filter(Boolean);

    const ranked = rankCandidates(scoredList, MAX_DOSSIER_STOCKS);
    const topDossiers = ranked
      .map((s) => dossiers[s.ticker])
      .filter(Boolean);

    console.info("[nighthawk/edition] phase 3b: index/ETF dossiers");
    const [indexDossiers, spxDesk, flowTape] = await Promise.all([
      fetchIndexDossiers(ctx),
      marketPlatform.spx.getSpxDeskSummary().catch(() => null),
      marketPlatform.flows.getFlowTapeSummary({ limit: 30 }).catch(() => null),
    ]);

    console.info(`[nighthawk/edition] phase 4: Claude synthesis (${ranked.length} ranked stocks)`);
    const { plays, recap, raw } = await generateEditionPlays({
      ctx,
      dossiers: topDossiers,
      ranked,
      indexDossiers,
    });

    if (!plays.length) {
      return {
        ok: false,
        edition_for: editionFor,
        plays_count: 0,
        candidates: candidates.length,
        error: anthropicConfigured()
          ? "Claude returned no parseable plays."
          : "Claude not configured and mechanical fallback empty.",
        duration_ms: Date.now() - started,
      };
    }

    console.info("[nighthawk/edition] phase 5: persist edition");
    await upsertNighthawkEdition({
      edition_for: editionFor,
      session_date: ctx.today,
      recap_headline: recap.headline,
      recap_summary: recap.summary,
      market_recap: {
        tide: recap.tide,
        spx_vix: recap.spx_vix,
        sector_strength: recap.sector_strength,
        sector_weakness: recap.sector_weakness,
        catalysts: recap.catalysts,
        hot_chains: ctx.hot_chains.slice(0, 10),
        sector_tides: ctx.sector_tides,
        index_flows: ctx.index_flows,
        top_net_impact: ctx.top_net_impact.slice(0, 10),
        vix_iv_rank: ctx.vix_iv_rank,
        vix_term: ctx.vix_term,
        index_dossiers: indexDossiers,
        spx_desk: spxDesk,
        flow_tape: flowTape,
      },
      plays,
      meta: {
        candidates: candidates.length,
        ranked_tickers: ranked.map((r) => r.ticker),
        claude: Boolean(raw),
        built_at: new Date().toISOString(),
        force: Boolean(opts?.force),
        dossier_context: Object.fromEntries(
          topDossiers
            .filter((d) => d.scored)
            .map((d) => [d.ticker, formatTickerDossierText(d, d.scored!)])
        ),
        play_explanations: {},
        platform: {
          spx_price: spxDesk?.price ?? null,
          spx_regime: spxDesk?.gamma_regime ?? null,
          flow_alert_count: flowTape?.count ?? null,
        },
      },
    });

    return {
      ok: true,
      edition_for: editionFor,
      plays_count: plays.length,
      candidates: candidates.length,
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[nighthawk/edition] build failed:", error);
    return {
      ok: false,
      edition_for: editionFor,
      plays_count: 0,
      candidates: 0,
      error: message,
      duration_ms: Date.now() - started,
    };
  }
}

export function rowToNightHawkEdition(row: {
  edition_for: string;
  published_at: string;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap: Record<string, unknown>;
  plays: unknown[];
}): NightHawkEdition {
  const plays = (row.plays as PlaybookPlay[]) ?? [];
  return {
    available: plays.length > 0,
    edition_for: row.edition_for,
    published_at: row.published_at,
    recap_headline: row.recap_headline,
    recap_summary: row.recap_summary,
    market_recap: row.market_recap,
    plays: plays.map((p, i) => ({ ...p, rank: p.rank ?? i + 1 })),
  };
}
