import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { fetchSpxAdminAnalytics, type SpxAdminAnalytics } from "@/lib/admin-spx-analytics";
import { buildSpxConfigSnapshot } from "@/lib/admin-spx-config-snapshot";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { runSpxEvaluator, isSpxEvaluatorPlayResult } from "@/lib/spx-evaluator";
import { type SpxPlayPayload } from "@/lib/spx-play-engine";
import { evaluateSpxLotto } from "@/lib/spx-lotto-engine";
import { evaluateSpxPowerHour } from "@/lib/spx-power-hour-engine";
import { runLottoPowerHourLocked } from "@/lib/spx-lotto-powerhour-runner";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { loadWatchRecord } from "@/lib/spx-play-watch";
import { loadPlaySessionMeta } from "@/lib/spx-play-store";
import { loadLottoRecord } from "@/lib/spx-lotto-store";
import { loadPowerHourRecord } from "@/lib/spx-power-hour-store";
import { fetchLottoPlaysForDate } from "@/lib/db";
import { todayEt } from "@/lib/et-date";
import { computeSpxConfluence } from "@/lib/spx-signals";
import { fetchRecentPlayOutcomes } from "@/lib/spx-play-outcomes";
import { buildSpxAdminIssues, type SpxAdminIssuesPayload } from "@/lib/admin-spx-issues";
import { buildSpxTerminalFeed, type SpxTerminalPayload } from "@/lib/admin-spx-terminal";
import { syncAdminIncidents, listOpenAdminIncidents, type AdminIncidentRow } from "@/lib/admin-incidents";
import { SPX_ISSUES_RESOLVE_SCOPE } from "@/lib/spx-issues-sync";
import { getAdminRouteErrors } from "@/lib/admin-route-errors";

export type DeskIntelSection = {
  polled_at: string | null;
  market: {
    open?: boolean;
    status?: string;
    label?: string;
    source?: string;
  };
  price_action: Record<string, unknown>;
  moving_averages: Record<string, unknown>;
  internals: Record<string, unknown>;
  volatility: Record<string, unknown>;
  dealer_gex: Record<string, unknown>;
  flow: Record<string, unknown>;
  tape: SpxDeskPayload["unified_tape"];
  levels: SpxDeskPayload["levels"];
  macro_events: SpxDeskPayload["macro_events"];
  news_headlines: SpxDeskPayload["news_headlines"];
  sector_heat: SpxDeskPayload["sector_heat"];
  leader_stocks: SpxDeskPayload["leader_stocks"];
  oi_changes: SpxDeskPayload["oi_changes"];
  net_prem_ticks: SpxDeskPayload["net_prem_ticks"];
};

export type SpxAdminDashboardPayload = {
  generated_at: string;
  live_engine: boolean;
  analytics: SpxAdminAnalytics;
  config: ReturnType<typeof buildSpxConfigSnapshot>;
  desk: DeskIntelSection;
  confluence: ReturnType<typeof computeSpxConfluence>;
  play: SpxPlayPayload | null;
  lotto: {
    today: Awaited<ReturnType<typeof evaluateSpxLotto>> | null;
    record: Awaited<ReturnType<typeof loadLottoRecord>>;
    history: Awaited<ReturnType<typeof fetchLottoPlaysForDate>>;
  };
  power_hour: {
    today: Awaited<ReturnType<typeof evaluateSpxPowerHour>> | null;
    record: Awaited<ReturnType<typeof loadPowerHourRecord>>;
  };
  state: {
    watch: Awaited<ReturnType<typeof loadWatchRecord>>;
    session_meta: Awaited<ReturnType<typeof loadPlaySessionMeta>>;
  };
  issues: SpxAdminIssuesPayload;
  terminal: SpxTerminalPayload;
  open_incidents: AdminIncidentRow[];
  outcomes_all: Awaited<ReturnType<typeof fetchRecentPlayOutcomes>>;
};

export function buildDeskIntel(desk: SpxDeskPayload): DeskIntelSection {
  return {
    polled_at: desk.polled_at ?? desk.as_of ?? null,
    market: {
      open: desk.market_open,
      status: desk.market_status,
      label: desk.market_label,
      source: desk.source,
    },
    price_action: {
      price: desk.price,
      change_pct: desk.spx_change_pct,
      above_vwap: desk.above_vwap,
      lod: desk.lod,
      hod: desk.hod,
      vwap: desk.vwap,
      pdh: desk.pdh,
      pdl: desk.pdl,
      prior_close: desk.prior_close,
      gap_pct: desk.gap_pct,
      gap_source: desk.gap_source,
      regime: desk.regime,
    },
    moving_averages: {
      ema20: desk.ema20,
      ema50: desk.ema50,
      ema200: desk.ema200,
      sma50: desk.sma50,
      sma200: desk.sma200,
    },
    internals: {
      tick: desk.tick,
      trin: desk.trin,
      add: desk.add,
    },
    volatility: {
      vix: desk.vix,
      vix_change_pct: desk.vix_change_pct,
      iv_rank: desk.uw_iv_rank,
      vix_term: desk.vix_term,
      iv_term_structure: desk.iv_term_structure,
    },
    dealer_gex: {
      gex_net: desk.gex_net,
      gex_king: desk.gex_king,
      max_pain: desk.max_pain,
      gamma_flip: desk.gamma_flip,
      above_gamma_flip: desk.above_gamma_flip,
      gamma_regime: desk.gamma_regime,
      walls: desk.gex_walls,
    },
    flow: {
      flow_0dte_call_premium: desk.flow_0dte_call_premium,
      flow_0dte_put_premium: desk.flow_0dte_put_premium,
      flow_0dte_net: desk.flow_0dte_net,
      tide_bias: desk.tide_bias,
      tide_call_premium: desk.tide_call_premium,
      tide_put_premium: desk.tide_put_premium,
      tide_net: desk.tide_net,
      dark_pool: desk.dark_pool,
      spx_flows: desk.spx_flows,
      nope: desk.nope,
      nope_net_delta: desk.nope_net_delta,
    },
    tape: desk.unified_tape,
    levels: desk.levels,
    macro_events: desk.macro_events,
    news_headlines: desk.news_headlines,
    sector_heat: desk.sector_heat,
    leader_stocks: desk.leader_stocks,
    oi_changes: desk.oi_changes,
    net_prem_ticks: desk.net_prem_ticks,
  };
}

export async function fetchSpxAdminDashboard(options?: {
  liveEngine?: boolean;
  /** EDGE-10: when true (default) the engine runs in read-only snapshot mode.
   *  Pass dryRun:false only after explicit double-confirmation to allow real
   *  BUY/SELL writes and Discord notifications. */
  dryRun?: boolean;
}): Promise<SpxAdminDashboardPayload> {
  const liveEngine = options?.liveEngine ?? false;
  // dryRun defaults to true — mutations require explicit opt-in.
  const dryRun = options?.dryRun !== false;

  const [{ merged }, analytics, outcomes_all, watch, session_meta, lottoRecord, lottoHistory] =
    await Promise.all([
      loadMergedSpxDesk(),
      fetchSpxAdminAnalytics(),
      fetchRecentPlayOutcomes(200),
      loadWatchRecord(),
      loadPlaySessionMeta(),
      loadLottoRecord(),
      fetchLottoPlaysForDate(todayEt()),
    ]);

  const desk = buildDeskIntel(merged);
  const confluence = computeSpxConfluence(merged);

  let play: SpxPlayPayload | null = null;
  let lottoToday: Awaited<ReturnType<typeof evaluateSpxLotto>> | null = null;
  let powerHourToday: Awaited<ReturnType<typeof evaluateSpxPowerHour>> | null = null;

  if (liveEngine) {
    const technicals = await buildPlayTechnicals(merged.price, {
      vwap: merged.vwap,
      pdh: merged.pdh,
      pdl: merged.pdl,
      hod: merged.hod,
      lod: merged.lod,
    });

    if (dryRun) {
      // EDGE-10: dry-run path — read-only snapshot, no DB writes, no Discord. Lotto +
      // power-hour now use their read-only projections too; previously they called the
      // MUTATING evaluate*, silently advancing state and firing live subscriber Discord
      // alerts from the default admin dashboard view (audit P1).
      const { readSpxPlaySnapshot } = await import("@/lib/spx-evaluator");
      const { readSpxLottoSnapshot } = await import("@/lib/spx-lotto-engine");
      const { readSpxPowerHourSnapshot } = await import("@/lib/spx-power-hour-engine");
      const [snapshot, lottoTodayResult, powerHourResult] = await Promise.all([
        readSpxPlaySnapshot(merged, technicals),
        readSpxLottoSnapshot(),
        readSpxPowerHourSnapshot(merged),
      ]);
      play = snapshot;
      lottoToday = lottoTodayResult;
      powerHourToday = powerHourResult;
    } else {
      // Mutate path — only reached after explicit double-confirmation. Lotto/power-hour
      // go through the shared advisory lock so a concurrent cron tick can't double-mutate
      // the shared records or double-fire Discord (the loser renders read-only).
      const [evalResult, lottoPowerHour] = await Promise.all([
        runSpxEvaluator(merged, technicals, "admin_live"),
        runLottoPowerHourLocked(merged, technicals),
      ]);
      lottoToday = lottoPowerHour.lotto;
      powerHourToday = lottoPowerHour.powerHour;
      if (isSpxEvaluatorPlayResult(evalResult)) {
        play = evalResult.play;
      }
    }
  }

  const issues = await buildSpxAdminIssues({
    desk: merged,
    play,
    marketOpen: merged.market_open === true,
  });

  // Reconcile everything EXCEPT the data-integrity namespace — that's owned by the
  // data-integrity cron's own reconcile, so the dashboard must not resolve its incidents.
  // Shared with the spx-issues-sync cron (spx-issues-sync.ts) so both reconcilers of this
  // same issue set can never drift onto two different namespace splits.
  await syncAdminIncidents(issues.issues, { resolveScope: SPX_ISSUES_RESOLVE_SCOPE });
  const openIncidents = await listOpenAdminIncidents(12);
  const routeErrors = getAdminRouteErrors();

  const terminal = buildSpxTerminalFeed({
    issues,
    desk: merged,
    play,
    liveEngine,
    signalsToday: analytics.signals_today,
    flowAlertsToday: analytics.flow_alerts_today,
    routeErrors,
    openIncidents,
  });

  return {
    generated_at: new Date().toISOString(),
    live_engine: liveEngine,
    analytics,
    config: buildSpxConfigSnapshot(),
    desk,
    confluence,
    play,
    lotto: {
      today: lottoToday,
      record: lottoRecord,
      history: lottoHistory,
    },
    power_hour: {
      today: powerHourToday,
      record: await loadPowerHourRecord(),
    },
    state: { watch, session_meta },
    issues,
    terminal,
    open_incidents: openIncidents,
    outcomes_all,
  };
}
