import { formatFlowStrikeStackLine } from "@/lib/largo/flow-strike-stacks";
import {
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
  PLAYBOOK_PREMIUM_CAP_LINE,
} from "./constants";
import type { IndexDossier } from "./index-dossier";
import { formatIndexDossierBlock } from "./index-dossier";
import type { TickerDossier } from "./dossier";
import type { MarketWideContext } from "./market-wide";
import type { ScoredCandidate } from "./scorer";

function fmtPrem(prem: number): string {
  if (prem >= 1_000_000) return `$${(prem / 1_000_000).toFixed(1)}M`;
  if (prem >= 1_000) return `$${Math.round(prem / 1_000)}K`;
  return `$${Math.round(prem)}`;
}

function tideSummary(tide: Record<string, unknown> | null): string {
  if (!tide) return "Market tide unavailable.";
  const call = Number(tide.call_premium ?? tide.total_call_premium ?? 0);
  const put = Number(tide.put_premium ?? tide.total_put_premium ?? 0);
  const total = call + put;
  if (total <= 0) return "Market tide flat / no premium.";
  const callPct = (call / total) * 100;
  const bias = callPct > 55 ? "BULLISH" : callPct < 45 ? "BEARISH" : "NEUTRAL";
  return `${bias} — calls ${callPct.toFixed(0)}% (${fmtPrem(call)}) vs puts ${fmtPrem(put)}`;
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
    .map((e) => String(e.event ?? ""))
    .filter(Boolean)
    .join("; ");
  const earnings = ctx.tomorrow_earnings
    .slice(0, 6)
    .map((e) => String(e.symbol ?? e.ticker ?? ""))
    .filter(Boolean)
    .join(", ");

  const catalysts = [macro && `Macro: ${macro}`, earnings && `Earnings: ${earnings}`]
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
  const summary = `${tide}. ${spx}.${breadthLine ? ` Breadth: ${breadthLine}.` : ""}${mag7Line ? ` ${mag7Line}.` : ""}${macroLine ? ` Macro: ${macroLine}.` : ""} Leaders: ${leaders.map((s) => `${s.name} ${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}%`).join(", ") || "n/a"}.${netImpact ? ` Net impact: ${netImpact}.` : ""}${predictionsLine ? ` Predictions: ${predictionsLine}.` : ""}`;

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

  const totalPrem = dossier.flows.reduce((s, f) => s + Number(f.total_premium ?? f.premium ?? 0), 0);
  lines.push(`Flow today: ${fmtPrem(totalPrem)} across ${dossier.flows.length} alerts`);

  if (dossier.flow_streak.streak_days > 0) {
    lines.push(
      `Flow streak: ${dossier.flow_streak.streak_days}d · net 3d ${fmtPrem(dossier.flow_streak.net_3d)} · net 5d ${fmtPrem(dossier.flow_streak.net_5d)}`
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
      `Dark pool: ${fmtPrem(dossier.dark_pool.total_premium)} · bias ${dossier.dark_pool.bias ?? "mixed"}`
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
      return `${exp}: ${fmtPrem(prem)}`;
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
  if (dossier.polygon_sentiment.length) {
    lines.push(`Polygon sentiment: ${dossier.polygon_sentiment.slice(0, 2).join(" | ")}`);
  }
  if (dossier.analyst_summary) lines.push(`Analyst: ${dossier.analyst_summary}`);
  if (dossier.price_target) lines.push(dossier.price_target);
  if (dossier.congress_trades.length) {
    lines.push(`Congress trades: ${dossier.congress_trades.length} recent filing(s)`);
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
        ? `Institutional: ${name} · ${fmtPrem(value)} position`
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
  lines.push(
    `Score breakdown: flow ${scored.flow_score}/40 · technical ${scored.tech_score}/30 · positioning ${scored.pos_score}/20 · news ${scored.news_score}/10`
  );

  return lines.join("\n");
}

export function buildClaudePrompt(params: {
  ctx: MarketWideContext;
  recap: ReturnType<typeof buildMarketRecap>;
  dossiers: TickerDossier[];
  ranked: ScoredCandidate[];
  indexDossiers?: IndexDossier[];
}): string {
  const { ctx, recap, dossiers, ranked, indexDossiers = [] } = params;
  const dossierMap = Object.fromEntries(dossiers.map((d) => [d.ticker, d]));

  const stockBlocks = ranked
    .map((s) => {
      const d = dossierMap[s.ticker];
      return d ? formatTickerDossierText(d, s) : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const hotChains = ctx.hot_chains
    .slice(0, 10)
    .map((c) => `${c.ticker}: ${fmtPrem(Number(c.total_premium ?? 0))}`)
    .join(", ");

  const vixContext = [
    ctx.vix_iv_rank != null ? `VIX IV rank ${ctx.vix_iv_rank}%` : null,
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

  const indexBlock = formatIndexDossierBlock(indexDossiers);

  return `You are the lead options strategist for BlackOut Trading. Generate exactly 5 next-session plays for ${ctx.tomorrow} (today was ${ctx.today}).

RULES — CRITICAL:
- Use ONLY data provided below. Never invent premiums, strikes, flow, or levels.
- Output valid JSON array ONLY — no markdown, no prose outside JSON.
- Exactly 5 plays: 3 individual STOCKS + 2 INDEX/ETF (SPY, QQQ, IWM, XLF, XLE, XLK).
- Each play must align flow direction with technical structure.
- Entry, target, stop must reference actual support/resistance from dossiers.
- options_play must specify call/put, strike, expiry (0DTE/weekly), size 1-3 contracts, and estimated entry premium per share.
- ${PLAYBOOK_PREMIUM_CAP_LINE}
- In options_play include "entry prem ~$X.XX" so premium is explicit. Also set entry_premium numeric field.
- If the only contracts that fit the thesis cost more than $${MAX_OPTION_PREMIUM_PER_SHARE}/share ($${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()}/contract), do NOT force it — pick a cheaper strike/expiry or choose a different ticker.
- conviction: A+ if score≥70, A if ≥55, B if ≥40, else C.
- Skip earnings names unless A+ conviction.

MARKET RECAP:
Tide: ${recap.tide}
SPX/VIX: ${recap.spx_vix}
Sector strength: ${recap.sector_strength}
Sector weakness: ${recap.sector_weakness}
Catalysts: ${recap.catalysts}
Hot chains: ${hotChains || "n/a"}
${vixContext ? `Vol regime: ${vixContext}` : ""}

INDEX / ETF DOSSIERS:
${indexBlock}

TOP STOCK DOSSIERS (ranked):
${stockBlocks || "No stock dossiers available."}

OUTPUT SCHEMA — JSON array of 5 objects:
{
  "ticker": "SYMBOL",
  "type": "stock|index",
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
