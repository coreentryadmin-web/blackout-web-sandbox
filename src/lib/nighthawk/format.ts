import { formatFlowStrikeStackLine } from "@/lib/largo/flow-strike-stacks";
import { fmtPremium } from "@/lib/fmt-money";
import {
  EDITION_SYNTHESIS_OVERSHOOT,
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
  PLAYBOOK_PREMIUM_CAP_LINE,
} from "./constants";
import type { TickerDossier } from "./dossier";
import type { HuntMode } from "./types";
import { huntDteGuidance } from "./hunt-mode";
import type { MarketWideContext } from "./market-wide";
import type { ScoredCandidate } from "./scorer";
import { formatSpxGapContext } from "./spx-gap";
import { formatPlatformIntelForPrompt } from "./platform-intel-snapshot";
import type { SpxDeskSummary, FlowTapeSummary } from "@/lib/platform/types";
import type { PlayOutcomeStats } from "@/lib/spx-play-outcomes";
import type { marketPlatform } from "@/lib/platform";

export type EngineState = {
  play: Awaited<ReturnType<typeof marketPlatform.spx.getSpxPlayState>> | null;
  openPlay: Awaited<ReturnType<typeof marketPlatform.spx.getSpxOpenPlay>>["open_play"] | null;
  lotto: Awaited<ReturnType<typeof marketPlatform.spx.getSpxLottoState>>;
  powerHour: Awaited<ReturnType<typeof marketPlatform.spx.getSpxPowerHourState>> | null;
};

// Cross-tool: the live SPX engine state (play + open play + lotto) so the overnight
// edition AI knows what the platform's own engines are holding into the next session.
function formatEngineState(engine?: EngineState | null): string {
  if (!engine) return "Live engines unavailable.";
  const parts: string[] = [];

  const play = engine.play;
  if (play && play.available) {
    const dir = play.direction ? play.direction.toUpperCase() : "-";
    const lvl = play.levels;
    const lvlStr = lvl
      ? `entry ${lvl.entry ?? "-"} · stop ${lvl.stop ?? "-"} · target ${lvl.target ?? "-"}`
      : "no levels";
    parts.push(
      `SPX engine: ${play.phase} · ${play.action} ${dir} · grade ${play.grade} · score ${play.score} (${lvlStr})`
    );
  } else {
    parts.push("SPX engine: SCANNING - no live play.");
  }

  const op = engine.openPlay;
  if (op) {
    const opt = op.option_label ? ` · ${op.option_label}${op.option_premium ? ` @ ${op.option_premium}` : ""}` : "";
    parts.push(
      `SPX open play: ${op.direction.toUpperCase()} from ${op.entry_price} · stop ${op.stop ?? "-"} · target ${op.target ?? "-"} · grade ${op.grade}${opt}`
    );
  } else {
    parts.push("SPX open play: none.");
  }

  const lotto = engine.lotto ?? [];
  if (lotto.length) {
    const lottoStr = lotto
      .slice(0, 4)
      .map((l) => `${l.contract_label} (${l.phase}${l.outcome ? `/${l.outcome}` : ""})`)
      .join(", ");
    parts.push(`Lotto: ${lotto.length} pick(s) - ${lottoStr}`);
  } else {
    parts.push("Lotto: no picks today.");
  }

  const ph = engine.powerHour;
  if (ph && ph.phase !== "NONE") {
    const dir = ph.direction ? ph.direction.toUpperCase() : "-";
    const tgt = ph.target_price != null ? ph.target_price : `${ph.target_pts}pt`;
    const stp = ph.stop_price != null ? ph.stop_price : `${ph.stop_pts}pt`;
    parts.push(
      `Power hour: ${ph.phase} ${dir} · ${ph.contract_label} · anchor ${ph.anchor_price}${ph.entry_price != null ? ` · entry ${ph.entry_price}` : ""} · target ${tgt} · stop ${stp} · conf ${ph.confidence}`
    );
  } else {
    parts.push("Power hour: idle.");
  }

  return parts.join("\n");
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Cross-tool: the desk's own realized track record (closed SPX play outcomes) so the
// overnight edition AI is anchored to how the live engines have actually performed.
function formatTrackRecord(stats?: PlayOutcomeStats | null): string {
  if (!stats || stats.total_closed === 0) return "";
  const o = stats.overall;
  const cb = stats.cold_buy;
  const wp = stats.watch_promote;
  const days = Math.round(stats.days_of_data);
  const split = (label: string, b: typeof cb): string | null =>
    b.count > 0
      ? `${label} ${b.wins}-${b.losses} (${pct(b.win_rate)}, +${b.avg_mfe.toFixed(1)}/-${b.avg_mae.toFixed(1)} pts)`
      : null;
  const splits = [split("cold-buy", cb), split("watch-promote", wp)].filter(Boolean).join(" · ");
  return `DESK TRACK RECORD (${stats.total_closed} closed plays / ${days}d): overall ${o.wins}-${o.losses}-${o.breakeven} (${pct(o.win_rate)} win-rate)${splits ? ` · ${splits}` : ""}`;
}

/** Summarized LIVE SPX desk + HELIX flow tape for the overnight edition prompt.
 *  Overnight context only - keep it terse. gex_walls/levels/greek_exposure are typed
 *  `unknown` on SpxDeskSummary, so narrow defensively here. */
function formatLiveSpxSection(
  spxDesk: SpxDeskSummary | null | undefined,
  flowTape: FlowTapeSummary | null | undefined
): string {
  if (!spxDesk && !flowTape) return "";
  const lines: string[] = [];

  if (spxDesk) {
    const d = spxDesk;
    const chg = d.change_pct != null ? ` (${d.change_pct >= 0 ? "+" : ""}${d.change_pct.toFixed(2)}%)` : "";
    const vwapTag = d.vwap != null ? ` · VWAP ${d.vwap.toFixed(0)} (${d.above_vwap ? "above" : "below"})` : "";
    const vixTag = d.vix != null ? ` · VIX ${d.vix.toFixed(2)}` : "";
    lines.push(`SPX ${d.price.toFixed(2)}${chg}${vwapTag}${vixTag} · regime ${d.regime ?? "?"}`);

    const walls = Array.isArray(d.gex_walls) ? (d.gex_walls as Array<{ strike?: number; kind?: string }>) : [];
    const wallStr = walls
      .slice(0, 4)
      .map((w) => `${w.kind === "support" ? "S" : "R"} ${Number(w.strike).toFixed(0)}`)
      .join(", ");
    const flipTag = d.gamma_flip != null ? `gamma flip ${d.gamma_flip.toFixed(0)} (${d.gamma_regime ?? "?"})` : `gamma regime ${d.gamma_regime ?? "?"}`;
    lines.push(`${flipTag}${wallStr ? ` · GEX walls: ${wallStr}` : ""}${d.gex_king != null ? ` · GEX king ${d.gex_king.toFixed(0)}` : ""}${d.max_pain != null ? ` · max pain ${d.max_pain.toFixed(0)}` : ""}`);

    const flowBits = [
      d.flow_0dte_net != null ? `0DTE net ${d.flow_0dte_net >= 0 ? "+" : ""}${fmtPremium(Math.abs(d.flow_0dte_net))}${d.flow_0dte_net >= 0 ? " call lean" : " put lean"}` : null,
      d.nope != null ? `NOPE ${d.nope >= 0 ? "+" : ""}${d.nope.toFixed(1)}` : null,
      d.tide_bias ? `tide ${d.tide_bias}` : null,
      d.uw_iv_rank != null ? `IV rank ${Number(d.uw_iv_rank).toFixed(0)}` : null,
    ].filter(Boolean);
    if (flowBits.length) lines.push(flowBits.join(" · "));

    const ge = d.greek_exposure as { headline?: string } | null | undefined;
    if (ge?.headline) lines.push(`Dealer gamma: ${ge.headline}`);
  }

  if (flowTape?.recent?.length) {
    const tape = flowTape.recent
      .slice(0, 5)
      .map((f) => `${f.ticker} ${String(f.option_type).toUpperCase().startsWith("P") ? "PUT" : "CALL"} ${f.strike} ${String(f.expiry).slice(0, 10)} ${fmtPremium(Number(f.premium ?? 0))} ${f.direction}`)
      .join("; ");
    lines.push(`HELIX tape (top ${Math.min(5, flowTape.recent.length)} of ${flowTape.count}): ${tape}`);
  }

  return lines.join("\n");
}

export type TideBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export function tideBias(tide: Record<string, unknown> | null): TideBias {
  if (!tide) return "NEUTRAL";
  const call = Number(tide.call_premium ?? tide.total_call_premium ?? 0);
  const put = Number(tide.put_premium ?? tide.total_put_premium ?? 0);
  const total = call + put;
  if (total <= 0) return "NEUTRAL";
  const callPct = (call / total) * 100;
  return callPct > 55 ? "BULLISH" : callPct < 45 ? "BEARISH" : "NEUTRAL";
}

function tideSummary(tide: Record<string, unknown> | null): string {
  if (!tide) return "Market tide unavailable.";
  const call = Number(tide.call_premium ?? tide.total_call_premium ?? 0);
  const put = Number(tide.put_premium ?? tide.total_put_premium ?? 0);
  const total = call + put;
  if (total <= 0) return "Market tide flat / no premium.";
  const callPct = (call / total) * 100;
  const bias = tideBias(tide);
  return `${bias} — calls ${callPct.toFixed(0)}% (${fmtPremium(call)}) vs puts ${fmtPremium(put)}`;
}

function formatMarketBreadth(ctx: MarketWideContext): string {
  const b = ctx.market_breadth;
  if (!b) return "Market breadth unavailable.";
  return [
    `${b.pct_advancing ?? "?"}% advancing`,
    `A/D ${b.advance_decline_ratio ?? "?"}`,
    `${b.pct_above_vwap ?? "?"}% above VWAP`,
    `closed strong ${b.closed_near_high} / weak ${b.closed_near_low}`,
    `sample ${b.sample_size}`,
  ].join(" · ");
}

function formatMag7GreekFlow(ctx: MarketWideContext): string {
  const g = ctx.mag7_greek_flow;
  if (!g) return "Mag7 greek flow unavailable.";
  return [
    g.headline,
    `net Δ ${Math.round(g.net_delta)} · net Γ ${Math.round(g.net_gamma)}`,
    `bias ${g.bias}`,
  ].join(" · ");
}

function formatMacroIndicators(ctx: MarketWideContext): string {
  if (ctx.macro_indicators.length === 0) return "Macro indicators unavailable.";
  return ctx.macro_indicators
    .slice(0, 4)
    .map((m) => {
      const val = m.latest_value != null ? m.latest_value.toFixed(2) : "—";
      const chg =
        m.change_pct != null ? ` (${m.change_pct >= 0 ? "+" : ""}${m.change_pct.toFixed(1)}%)` : "";
      return `${m.label} ${val}${chg}`;
    })
    .join(" · ");
}

function formatPredictionsConsensus(ctx: MarketWideContext): string {
  if (ctx.predictions_consensus.length === 0) return "UW predictions consensus unavailable.";
  return ctx.predictions_consensus
    .slice(0, 5)
    .map((s) => `${s.ticker} ${s.direction} ${s.confidence_pct}% — ${s.headline}`)
    .join(" · ");
}

function formatEtfTides(ctx: MarketWideContext): string {
  const entries = Object.entries(ctx.etf_tides);
  if (!entries.length) return "ETF tides unavailable.";
  return entries
    .map(([sym, tide]) => (tide ? `${sym}: ${tideSummary(tide)}` : `${sym}: n/a`))
    .join("\n");
}

function spxContext(ctx: MarketWideContext): string {
  const spx = ctx.spx_bars.at(-1);
  const prev = ctx.spx_bars.at(-2);
  const vix = ctx.vix_bars.at(-1);
  if (!spx) return "SPX data unavailable.";
  const chg = prev?.c ? ((spx.c - prev.c) / prev.c) * 100 : 0;
  const vixChg =
    vix && ctx.vix_bars.at(-2)?.c
      ? ((vix.c - ctx.vix_bars.at(-2)!.c) / ctx.vix_bars.at(-2)!.c) * 100
      : 0;
  return `SPX ${spx.c.toFixed(2)} (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%) · H ${spx.h.toFixed(0)} L ${spx.l.toFixed(0)} · VIX ${vix?.c?.toFixed(2) ?? "?"} (${vixChg >= 0 ? "+" : ""}${vixChg.toFixed(1)}%)`;
}

export function buildMarketRecap(ctx: MarketWideContext): {
  headline: string;
  summary: string;
  tide: string;
  spx_vix: string;
  sector_strength: string;
  sector_weakness: string;
  catalysts: string;
} {
  const leaders = [...ctx.sector_performance].sort((a, b) => b.change_pct - a.change_pct).slice(0, 3);
  const laggards = [...ctx.sector_performance].sort((a, b) => a.change_pct - b.change_pct).slice(0, 3);
  const tide = tideSummary(ctx.tide);
  const spx = spxContext(ctx);

  const macro = ctx.macro_events
    .slice(0, 4)
    .map((e) => {
      const ev = String(e.event ?? "").trim();
      if (!ev) return "";
      // events are pre-filtered upstream to tomorrow + high impact; surface the impact so
      // Claude can explicitly weight a next-session catalyst (e.g. "FOMC Decision (high)").
      const imp = String(e.impact ?? "").trim();
      return imp ? `${ev} (${imp})` : ev;
    })
    .filter(Boolean)
    .join("; ");
  const earnings = ctx.tomorrow_earnings
    .slice(0, 6)
    .map((e) => String(e.symbol ?? e.ticker ?? ""))
    .filter(Boolean)
    .join(", ");

  // After-hours / movers context from the free Benzinga channels — the edition is after-hours recon,
  // so surface the night's AH headlines alongside macro + earnings in the recap catalysts line.
  const afterHours = (ctx.after_hours_catalysts ?? [])
    .slice(0, 4)
    .map((c) => String(c.title ?? "").trim())
    .filter(Boolean)
    .map((t) => t.slice(0, 80))
    .join("; ");

  const catalysts = [
    macro && `Macro: ${macro}`,
    earnings && `Earnings: ${earnings}`,
    afterHours && `After-hours: ${afterHours}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const netImpact = ctx.top_net_impact
    .slice(0, 6)
    .map((r) => String(r.ticker ?? r.symbol ?? ""))
    .filter(Boolean)
    .join(", ");

  const headline = `Evening Playbook · ${ctx.tomorrow}`;
  const breadthLine = ctx.market_breadth
    ? `${ctx.market_breadth.pct_advancing ?? "?"}% advancing · A/D ${ctx.market_breadth.advance_decline_ratio ?? "?"} · ${ctx.market_breadth.pct_above_vwap ?? "?"}% above VWAP`
    : "";
  const predictionsLine =
    ctx.predictions_consensus.length > 0
      ? ctx.predictions_consensus
          .slice(0, 3)
          .map((s) => s.headline)
          .join("; ")
      : "";
  const mag7Line = ctx.mag7_greek_flow?.headline ?? "";
  const macroLine =
    ctx.macro_indicators.length > 0
      ? ctx.macro_indicators
          .slice(0, 2)
          .map((m) => `${m.label} ${m.latest_value ?? "—"}`)
          .join(" · ")
      : "";
  const summary = `${tide}. ${spx}.${ctx.spx_gap ? ` ${formatSpxGapContext(ctx.spx_gap)}.` : ""}${breadthLine ? ` Breadth: ${breadthLine}.` : ""}${mag7Line ? ` ${mag7Line}.` : ""}${macroLine ? ` Macro: ${macroLine}.` : ""} Leaders: ${leaders.map((s) => `${s.name} ${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}%`).join(", ") || "n/a"}.${netImpact ? ` Net impact: ${netImpact}.` : ""}${predictionsLine ? ` Predictions: ${predictionsLine}.` : ""}`;

  return {
    headline,
    summary,
    tide,
    spx_vix: spx,
    sector_strength: leaders.map((s) => `${s.name} ${s.change_pct.toFixed(2)}%`).join(" · ") || "n/a",
    sector_weakness: laggards.map((s) => `${s.name} ${s.change_pct.toFixed(2)}%`).join(" · ") || "n/a",
    catalysts: catalysts || "No major macro/earnings flagged.",
  };
}

export function formatTickerDossierText(dossier: TickerDossier, scored: ScoredCandidate): string {
  const lines: string[] = [];
  lines.push(`=== ${dossier.ticker} · Score ${scored.score}/100 (${scored.conviction}) · ${scored.direction.toUpperCase()} ===`);
  if (scored.regime_multiplier != null && scored.regime_multiplier !== 1) {
    lines.push(`Regime multiplier: ×${scored.regime_multiplier.toFixed(2)} (VIX IV rank + tide)`);
  }

  const totalPrem = dossier.flows.reduce((s, f) => s + Number(f.total_premium ?? f.premium ?? 0), 0);
  lines.push(`Flow today: ${fmtPremium(totalPrem)} across ${dossier.flows.length} alerts`);

  if (dossier.flow_streak.streak_days > 0) {
    lines.push(
      `Flow streak: ${dossier.flow_streak.streak_days}d · net 3d ${fmtPremium(dossier.flow_streak.net_3d)} · net 5d ${fmtPremium(dossier.flow_streak.net_5d)}`
    );
  }

  if (dossier.strike_stacks.length) {
    lines.push("Strike stacks:");
    for (const s of dossier.strike_stacks.slice(0, 4)) {
      lines.push(`  ${formatFlowStrikeStackLine(s)}`);
    }
  }

  if (dossier.dark_pool?.total_premium) {
    lines.push(
      `Dark pool: ${fmtPremium(dossier.dark_pool.total_premium)} · bias ${dossier.dark_pool.bias ?? "mixed"}`
    );
  }

  if (dossier.iv_rank != null) lines.push(`IV rank: ${dossier.iv_rank}`);
  if (dossier.iv_term.length) {
    lines.push(
      `IV term: ${dossier.iv_term
        .slice(0, 4)
        .map((p) => `${p.expiry} ${p.iv.toFixed(1)}%`)
        .join(" · ")}`
    );
  }
  if (dossier.realized_vol != null) lines.push(`Realized vol: ${dossier.realized_vol.toFixed(1)}%`);
  if (dossier.risk_reversal_skew != null) {
    lines.push(`Risk reversal skew: ${dossier.risk_reversal_skew >= 0 ? "+" : ""}${dossier.risk_reversal_skew.toFixed(2)}`);
  }

  const pos = dossier.positioning;
  if (pos.gex_king_strike != null) {
    lines.push(
      `GEX king $${pos.gex_king_strike} · ${pos.negative_gamma ? "negative γ" : "positive γ"} · regime ${pos.gamma_regime}${pos.gamma_flip != null ? ` · flip $${pos.gamma_flip}` : ""}`
    );
  }
  if (pos.net_vex != null) lines.push(`Net VEX: ${pos.net_vex >= 0 ? "+" : ""}${Math.round(pos.net_vex)}`);
  if (pos.max_pain != null) lines.push(`Max pain: $${pos.max_pain}`);
  if (pos.wall_summary !== "n/a") lines.push(`GEX walls: ${pos.wall_summary}`);

  if (dossier.flow_by_expiry.length) {
    const expLines = dossier.flow_by_expiry.slice(0, 4).map((r) => {
      const exp = String(r.expiry ?? r.expiration ?? "").slice(0, 10);
      const prem = Number(r.premium ?? r.total_premium ?? 0);
      return `${exp}: ${fmtPremium(prem)}`;
    });
    if (expLines.length) lines.push(`Flow by expiry: ${expLines.join(" · ")}`);
  }

  if (dossier.tech) {
    const t = dossier.tech;
    lines.push(`Technicals: ${t.summary}`);
    if (t.support_levels.length) lines.push(`Support: ${t.support_levels.slice(0, 4).join(", ")}`);
    if (t.resistance_levels.length) lines.push(`Resistance: ${t.resistance_levels.slice(0, 4).join(", ")}`);
    if (t.gap_zones.length) lines.push(`Gap zones: ${t.gap_zones.join("; ")}`);
    if (t.breakout_zones.length) lines.push(`Breakout zones: ${t.breakout_zones.join("; ")}`);
  }

  if (dossier.news_headlines.length) {
    lines.push("News:");
    for (const h of dossier.news_headlines.slice(0, 4)) lines.push(`  · ${h.slice(0, 140)}`);
  }
  // Catalysts — recent corporate/event items from the free Benzinga channels. This is the ONLY
  // catalyst line Claude may cite; the prompt rules pin catalyst citations to it.
  const catalystLine = formatCatalysts(dossier);
  if (catalystLine) lines.push(`Catalysts: ${catalystLine}`);
  if (dossier.polygon_sentiment.length) {
    lines.push(`Polygon sentiment: ${dossier.polygon_sentiment.slice(0, 2).join(" | ")}`);
  }
  if (dossier.analyst_summary) lines.push(`Analyst: ${dossier.analyst_summary}`);
  if (dossier.price_target) lines.push(dossier.price_target);
  if (dossier.congress_trades.length) {
    lines.push(`Congress trades (30d): ${dossier.congress_trades.length} recent filing(s)`);
  }
  if (dossier.congress_unusual.length) {
    lines.push(`Congress unusual: ${dossier.congress_unusual.length} flagged trade(s)`);
  }
  if (dossier.institutional_activity.length) {
    const top = dossier.institutional_activity[0];
    const name = String(top?.institution ?? top?.name ?? top?.holder ?? "Institution");
    const value = Number(top?.value ?? top?.market_value ?? top?.amount ?? 0);
    lines.push(
      value > 0
        ? `Institutional: ${name} · ${fmtPremium(value)} position`
        : `Institutional: ${dossier.institutional_activity.length} holder(s) tracked`
    );
  }
  if (dossier.predictions_signal) {
    lines.push(`Predictions: ${dossier.predictions_signal.headline}`);
  }
  if (dossier.screener_confirmed) {
    lines.push("Screener: confirmed by UW stock screener");
  }
  if (dossier.short_days_to_cover != null) {
    lines.push(`Short days-to-cover: ${dossier.short_days_to_cover.toFixed(1)}`);
  }

  if (dossier.sector) lines.push(`Sector: ${dossier.sector}`);

  // Fundamentals — widened real-time ratios + derived statement signals. These are the ONLY
  // company-financial figures Claude may cite; the prompt rules pin citations to this line.
  const fundLine = formatFundamentals(dossier);
  if (fundLine) lines.push(`Fundamentals: ${fundLine}`);

  const fundExtra =
    scored.fundamental_score != null && scored.fundamental_score !== 0
      ? ` · fundamentals ${scored.fundamental_score >= 0 ? "+" : ""}${scored.fundamental_score}`
      : "";
  const catExtra =
    scored.catalyst_score != null && scored.catalyst_score !== 0
      ? ` · catalysts ${scored.catalyst_score >= 0 ? "+" : ""}${scored.catalyst_score}`
      : "";
  lines.push(
    `Score breakdown: flow ${scored.flow_score}/38 · technical ${scored.tech_score}/28 · positioning ${scored.pos_score}/18 · news ${scored.news_score}/8 · smart money ${scored.smart_money_score}/8${fundExtra}${catExtra}`
  );

  return lines.join("\n");
}

/** Compact, comma-free-of-thousands fundamentals line: "P/E 29.7 · ROE 82% · rev +18% YoY · FCF+ · net cash". */
function formatFundamentals(dossier: TickerDossier): string {
  const r = dossier.fundamental_ratios;
  const s = dossier.fundamental_signals;
  if (!r && !s) return "";
  const parts: string[] = [];

  // Valuation.
  if (r?.pe_ratio != null) parts.push(`P/E ${r.pe_ratio.toFixed(1)}`);
  if (r?.price_to_sales != null) parts.push(`P/S ${r.price_to_sales.toFixed(1)}`);
  if (r?.ev_to_ebitda != null) parts.push(`EV/EBITDA ${r.ev_to_ebitda.toFixed(1)}`);

  // Profitability / returns. ROE may arrive as a fraction (0.82) or a percent (82); normalize to %.
  if (r?.roe != null) {
    const roePct = Math.abs(r.roe) > 1 ? r.roe : r.roe * 100;
    parts.push(`ROE ${roePct.toFixed(0)}%`);
  }
  if (s?.net_margin_pct != null) {
    const t =
      s.margin_trend === "expanding" ? "↑" : s.margin_trend === "contracting" ? "↓" : "";
    parts.push(`net margin ${s.net_margin_pct.toFixed(0)}%${t}`);
  }

  // Growth.
  if (s?.revenue_yoy_pct != null) {
    parts.push(`rev ${s.revenue_yoy_pct >= 0 ? "+" : ""}${s.revenue_yoy_pct.toFixed(0)}% YoY`);
  }
  if (s?.eps_trajectory && s.eps_trajectory !== "flat") {
    parts.push(`EPS ${s.eps_trajectory === "rising" ? "rising" : "falling"}`);
  }

  // Free cash flow.
  if (s?.fcf_positive != null) {
    const trend = s.fcf_trend === "rising" ? "↑" : s.fcf_trend === "falling" ? "↓" : "";
    parts.push(`FCF${s.fcf_positive ? "+" : "−"}${trend}`);
  }

  // Balance sheet.
  if (s?.net_cash_positive != null) {
    parts.push(s.net_cash_positive ? "net cash" : "net debt");
  } else if (r?.debt_to_equity != null) {
    parts.push(`D/E ${r.debt_to_equity.toFixed(1)}`);
  }

  // Capital return.
  if (s?.share_count_trend === "buyback") parts.push("buyback");
  else if (s?.share_count_trend === "dilution") parts.push("dilution");

  // Liquidity guard (only when stretched).
  if (r?.current_ratio != null && r.current_ratio < 1.2) {
    parts.push(`current ${r.current_ratio.toFixed(2)}`);
  }

  return parts.join(" · ");
}

/** Short human label for a catalyst type — drives the compact "Catalysts:" dossier line. */
function catalystLabel(type: string): string {
  switch (type) {
    case "binary":
      return "FDA/binary";
    case "m&a":
      return "M&A";
    case "guidance":
      return "guidance";
    case "insider":
      return "insider trade";
    case "buyback":
      return "buyback";
    case "offering":
      return "offering";
    case "short":
      return "short interest";
    case "ipo":
      return "IPO";
    default:
      return "catalyst";
  }
}

/**
 * Compact catalysts line: "FDA/binary: <title> · buyback · M&A". Leads with the typed label so a
 * binary stands out, then a trimmed headline for the freshest item. Empty ⇒ "".
 */
function formatCatalysts(dossier: TickerDossier): string {
  const cats = dossier.catalysts ?? [];
  if (!cats.length && !dossier.fda_events?.length) return "";
  // De-dupe by type so three FDA headlines collapse to one "FDA/binary" tag; keep the newest title.
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of cats.slice(0, 6)) {
    if (seen.has(c.type)) continue;
    seen.add(c.type);
    const title = c.title ? `: ${c.title.slice(0, 90)}` : "";
    parts.push(`${catalystLabel(c.type)}${title}`);
    if (parts.length >= 3) break;
  }
  // Append UW FDA structured events (drug name, date, indication) for richer context.
  if (dossier.fda_events?.length) {
    const fdaParts = dossier.fda_events.slice(0, 2).map((e) => {
      const r = e as Record<string, unknown>;
      const drug = String(r.drug_name ?? r.drug ?? r.name ?? "").trim();
      const date = String(r.date ?? r.event_date ?? r.pdufa_date ?? "").slice(0, 10);
      const indication = String(r.indication ?? r.disease ?? r.drug_indication ?? "").slice(0, 60);
      return [drug, date, indication].filter(Boolean).join(" / ");
    }).filter(Boolean);
    if (fdaParts.length) parts.push(`UW FDA: ${fdaParts.join(" | ")}`);
  }
  return parts.join(" · ");
}

export function buildClaudePrompt(params: {
  ctx: MarketWideContext;
  recap: ReturnType<typeof buildMarketRecap>;
  dossiers: TickerDossier[];
  ranked: ScoredCandidate[];
  chainTables?: Record<string, string>;
  huntMode?: HuntMode;
  maxDte?: number;
  engineState?: EngineState | null;
  spxDesk?: SpxDeskSummary | null;
  flowTape?: FlowTapeSummary | null;
  playOutcomes?: PlayOutcomeStats | null;
}): string {
  const { ctx, recap, dossiers, ranked, chainTables = {}, huntMode, maxDte, engineState, spxDesk, flowTape, playOutcomes } = params;
  const liveSpxSection = formatLiveSpxSection(spxDesk, flowTape);
  const trackRecordLine = formatTrackRecord(playOutcomes);
  const dossierMap = Object.fromEntries(dossiers.map((d) => [d.ticker, d]));

  const stockBlocks = ranked
    .map((s) => {
      const d = dossierMap[s.ticker];
      const chain = chainTables[s.ticker];
      const dossierText = d ? formatTickerDossierText(d, s) : "";
      return [chain, dossierText].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");

  const hotChains = ctx.hot_chains
    .slice(0, 10)
    .map((c) => `${c.ticker}: ${fmtPremium(Number(c.total_premium ?? 0))}`)
    .join(", ");

  const vixContext = [
    ctx.vix_iv_rank != null ? `VIX IV rank ${ctx.vix_iv_rank}` : null,
    ctx.vix_term.length
      ? `VIX term: ${ctx.vix_term
          .slice(0, 3)
          .map((v) => String((v as { expiry?: string }).expiry ?? ""))
          .filter(Boolean)
          .join(" → ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `You are the lead options strategist for BlackOut Trading. Generate exactly ${EDITION_SYNTHESIS_OVERSHOOT} next-session plays for ${ctx.tomorrow} (today was ${ctx.today}). The quality-review step will cut the weakest — produce ${EDITION_SYNTHESIS_OVERSHOOT} so 5 strong plays survive after review.
${huntMode && maxDte != null ? `\nHUNT MODE: ${huntDteGuidance(huntMode, maxDte)}\n` : ""}

RULES — CRITICAL:
- Use ONLY data provided below. Never invent premiums, strikes, flow, or levels.
- Output valid JSON array ONLY — no markdown, no prose outside JSON.
- Exactly ${EDITION_SYNTHESIS_OVERSHOOT} plays: individual STOCKS only. Do NOT include index/ETF plays (SPY, QQQ, IWM, etc.).
- Each play must align flow direction with technical structure.
- Entry, target, stop must reference actual support/resistance from dossiers.
- options_play must specify call/put, strike, expiry (0DTE/weekly), size 1-3 contracts, and estimated entry premium per share.
- ${PLAYBOOK_PREMIUM_CAP_LINE}
- In options_play include "entry prem ~$X.XX" so premium is explicit. Also set entry_premium numeric field.
- If the only contracts that fit the thesis cost more than $${MAX_OPTION_PREMIUM_PER_SHARE}/share ($${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()}/contract), do NOT force it — pick a cheaper strike/expiry or choose a different ticker.
- conviction: A+ if score≥70, A if ≥55, B if ≥40, else C.
- Skip earnings names unless A+ conviction.
- The actual option chain for each ticker is provided above its dossier (ATM ±5%, front two expiries).
- You MUST select a strike from the provided chain that has OI > 500 on the chosen side (call or put).
- entry_premium must match the chain's ask price for that strike and side (C_ASK for calls, P_ASK for puts).
- Do not invent strikes — use only strikes listed in the chain table.
- ANALYST PRICE TARGETS: cite a PT ONLY when the dossier has an explicit "Analyst PT $X" line for that ticker, and quote that exact figure. If a ticker has no "Analyst PT" line, do NOT mention any analyst/Street/"PT" target — it would be fabricated. The "target" field is ALWAYS a TECHNICAL level from the dossier S/R, never an analyst PT.
- FUNDAMENTALS: you may cite company-financial figures (P/E, ROE, revenue growth, margins, FCF, net cash/debt, buyback) ONLY from the ticker's "Fundamentals:" line — quote those exact values; never invent or infer fundamentals not on that line.
- CATALYSTS: you may reference corporate/event catalysts (FDA/binary, M&A, guidance, insider trades, buyback, offering, short interest, IPO) ONLY from the ticker's "Catalysts:" line. Do NOT invent or infer any catalyst not on that line. If a "Catalysts:" line flags an FDA/binary event ahead, treat a directional premium play into it as elevated risk (it is a coin-flip on a gap) and say so in risk_note.
- The "target" price and "stop" price MUST be an actual support/resistance level from the ticker's dossier (Support:/Resistance: lines). Do not invent price levels.
- Any total-flow $ figure you cite in key_signal must equal the dossier's "Flow today:" figure — do not invent or round it beyond recognition.

MARKET RECAP:
Tide: ${recap.tide}
SPX/VIX: ${recap.spx_vix}
SPX gap: ${formatSpxGapContext(ctx.spx_gap)}
Market breadth: ${formatMarketBreadth(ctx)}
Mag7 greek flow: ${formatMag7GreekFlow(ctx)}
Macro indicators: ${formatMacroIndicators(ctx)}
UW predictions: ${formatPredictionsConsensus(ctx)}
ETF tides:
${formatEtfTides(ctx)}
Sector strength: ${recap.sector_strength}
Sector weakness: ${recap.sector_weakness}
Catalysts: ${recap.catalysts}
LIVE ENGINE STATE:
${formatEngineState(engineState)}${trackRecordLine ? `\n${trackRecordLine}` : ""}
Hot chains: ${hotChains || "n/a"}
${vixContext ? `Vol regime: ${vixContext}` : ""}
${liveSpxSection ? `\nLIVE SPX / 0DTE + HELIX TAPE (real-time desk snapshot - anchor index-level bias and confirm/contradict single-name flow):\n${liveSpxSection}\n` : ""}
PLATFORM INTEL (cross-service — regime detector, flow anomalies, desk brief):
${formatPlatformIntelForPrompt(ctx.platform_intel)}
TOP STOCK DOSSIERS (ranked):
${stockBlocks || "No stock dossiers available."}

OUTPUT SCHEMA — JSON array of ${EDITION_SYNTHESIS_OVERSHOOT} objects:
{
  "ticker": "SYMBOL",
  "type": "stock",
  "direction": "LONG|SHORT",
  "conviction": "A+|A|B|C",
  "bias": "one sentence",
  "entry_condition": "specific trigger",
  "entry_range": "price range",
  "target": "price",
  "target_note": "level justification",
  "stop": "price",
  "stop_note": "justification",
  "risk_reward": "ratio",
  "options_play": "contract details incl. entry prem ~$X.XX",
  "entry_premium": 0.00,
  "key_signal": "2-3 sentence synthesis of flow+technicals+positioning",
  "risk_note": "invalidation",
  "score": 0-100
}`;
}
