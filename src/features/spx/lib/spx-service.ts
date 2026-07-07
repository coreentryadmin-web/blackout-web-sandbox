import {
  fetchClosedPlayOutcomes,
  fetchLottoPlaysForDate,
  fetchOpenSpxPlay,
  fetchRecentSpxSignalLogs,
  fetchSpxAdminRollups,
} from "@/lib/db";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { fetchRecentSpxSnapshots } from "@/features/spx/lib/spx-signal-log";
import { computeFlowStrikeStacks } from "@/lib/largo/flow-strike-stacks";
import { readSpxPlaySnapshot } from "@/features/spx/lib/spx-evaluator";
import { buildPlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { playMemberReadCacheSec } from "@/features/spx/lib/spx-play-config";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { withServerCache } from "@/lib/server-cache";
import { loadPowerHourRecord } from "@/features/spx/lib/spx-power-hour-store";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxDeskSummary } from "@/lib/platform/types";

export function summarizeSpxDesk(merged: SpxDeskPayload): SpxDeskSummary {
  const spx_flows = merged.spx_flows;
  return {
    as_of: merged.as_of,
    market_open: merged.market_open ?? false,
    market_label: merged.market_label ?? "",
    price: merged.price,
    change_pct: merged.spx_change_pct,
    vix: merged.vix,
    vwap: merged.vwap,
    above_vwap: merged.above_vwap,
    hod: merged.hod,
    lod: merged.lod,
    pdh: merged.pdh,
    pdl: merged.pdl,
    ema20: merged.ema20,
    ema50: merged.ema50,
    gamma_flip: merged.gamma_flip,
    gex_net: merged.gex_net,
    gex_king: merged.gex_king,
    max_pain: merged.max_pain,
    gamma_regime: merged.gamma_regime,
    gex_walls: merged.gex_walls,
    flow_0dte_net: merged.flow_0dte_net,
    tide_bias: merged.tide_bias,
    tide_net: merged.tide_net,
    nope: merged.nope,
    tick: merged.tick,
    trin: merged.trin,
    add: merged.add,
    uw_iv_rank: merged.uw_iv_rank,
    regime: merged.regime,
    levels: merged.levels,
    dark_pool: merged.dark_pool,
    spx_flows,
    unified_tape: merged.unified_tape,
    net_prem_ticks: merged.net_prem_ticks,
    news_headlines: merged.news_headlines,
    macro_events: merged.macro_events,
    sector_heat: merged.sector_heat,
    leader_stocks: merged.leader_stocks,
    oi_changes: merged.oi_changes,
    iv_term_structure: merged.iv_term_structure,
    vix_term: merged.vix_term,
    greek_exposure: merged.greek_exposure,
    market_breadth: merged.market_breadth,
    mag7_greek_flow: merged.mag7_greek_flow,
    macro_indicators: merged.macro_indicators,
    strike_stacks: computeFlowStrikeStacks(spx_flows ?? []),
  };
}

export async function getSpxDeskSummary(): Promise<SpxDeskSummary> {
  const { merged } = await loadMergedSpxDesk();
  return summarizeSpxDesk(merged);
}

async function evaluateSpxPlayState() {
  const { merged } = await loadMergedSpxDesk();
  const technicals = await buildPlayTechnicals(merged.price, {
    vwap: merged.vwap,
    pdh: merged.pdh,
    pdl: merged.pdl,
    hod: merged.hod,
    lod: merged.lod,
  });
  return readSpxPlaySnapshot(merged, technicals);
}

/**
 * Single derivation for member `/api/market/spx/play`, BIE `spx_full_state`, and Largo
 * `get_spx_play`. Collapses member polls into one eval per cache window — no
 * stale-while-revalidate so BIE/Largo and the dashboard never disagree on grade/score.
 */
export async function getSpxPlayState() {
  const date = todayEtYmd();
  const ttlMs = playMemberReadCacheSec() * 1000;
  return withServerCache(`spx-play-read:${date}`, ttlMs, evaluateSpxPlayState);
}

export async function getSpxOpenPlay() {
  return { open_play: await fetchOpenSpxPlay(todayEtYmd()) };
}

export async function getSpxTradeHistory(opts?: { ticker?: string; days?: number }) {
  const days = opts?.days ?? 30;
  const cutoff = Date.now() - days * 86400000;
  // OPTIMIZATION NEEDED: fetchClosedPlayOutcomes does not yet accept ticker/date
  // params, so ticker and date filters are applied in-process after fetching 300
  // rows. Push these filters into the DB query layer (fetchClosedPlayOutcomes)
  // to avoid over-fetching when ticker or a short date range is requested.
  let rows = await fetchClosedPlayOutcomes(300);
  if (opts?.ticker) {
    const sym = opts.ticker.toUpperCase();
    rows = rows.filter((r) => r.headline.toUpperCase().includes(sym));
  }
  return rows.filter((r) => new Date(r.closed_at ?? r.opened_at).getTime() >= cutoff).slice(0, 50);
}

export async function getSpxSetupStats() {
  return fetchSpxAdminRollups();
}

export async function getSpxSignalLog(limit = 20) {
  return fetchRecentSpxSignalLogs(limit);
}

/**
 * Task #108 — retrospective engine-state snapshot log, the sibling of getSpxSignalLog
 * above that answers "why was the last signal rejected / what was the engine doing at
 * time Y" instead of "what did it actually fire." Routed through
 * fetchRecentSpxSnapshots (src/lib/providers/spx-signal-log.ts) rather than calling
 * db.ts's fetchRecentSpxEngineSnapshots directly (unlike getSpxSignalLog above, which
 * does bypass its own provider-layer sibling fetchRecentSpxSignals) — kept the query
 * threaded through the provider module that owns the throttle/write side of this
 * feature so both halves live in one place.
 */
export async function getSpxEngineSnapshots(limit = 20) {
  return fetchRecentSpxSnapshots(limit);
}

export async function getSpxLottoState() {
  return fetchLottoPlaysForDate(todayEtYmd());
}

export async function getSpxPowerHourState() {
  return loadPowerHourRecord();
}
