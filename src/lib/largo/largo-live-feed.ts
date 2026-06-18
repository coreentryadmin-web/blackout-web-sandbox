import { runLargoTool } from "@/lib/largo/run-tool";
import type { LargoQuestionIntent } from "@/lib/largo/question-intent";
import {
  computeFlowStrikeStacks,
  formatFlowStrikeStackLine,
  type FlowStrikeStack,
} from "@/lib/largo/flow-strike-stacks";

type FeedKey =
  | "market"
  | "calendar"
  | "spx_structure"
  | "technicals"
  | "news"
  | "flow"
  | "dark_pool"
  | "vol"
  | "play"
  | "open_plays";

export type LargoLiveFeed = Partial<Record<FeedKey, unknown>>;

async function safeTool(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  try {
    return await runLargoTool(name, input);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "tool_failed" };
  }
}

/** Parallel capture of live API data — fed to Claude before it writes. */
export async function captureLargoLiveFeed(intent: LargoQuestionIntent): Promise<LargoLiveFeed> {
  const ticker = intent.tickerHint ?? "SPX";

  const jobs: Array<{ key: FeedKey; promise: Promise<unknown> }> = [
    { key: "market", promise: safeTool("get_market_context") },
    { key: "calendar", promise: safeTool("get_economic_calendar", { days_ahead: 10 }) },
    { key: "spx_structure", promise: safeTool("get_spx_structure") },
    { key: "technicals", promise: safeTool("get_technicals", { ticker }) },
    { key: "news", promise: safeTool("get_news", { ticker }) },
    { key: "flow", promise: safeTool("get_options_flow", { ticker }) },
    { key: "dark_pool", promise: safeTool("get_dark_pool", { ticker }) },
    { key: "vol", promise: safeTool("get_volatility_regime", { ticker }) },
  ];

  if (intent.needsPlayState || intent.needsSpxDesk || ticker === "SPX") {
    jobs.push(
      { key: "play", promise: safeTool("get_spx_play") },
      { key: "open_plays", promise: safeTool("get_open_plays") }
    );
  }

  const settled = await Promise.all(jobs.map(async (j) => ({ key: j.key, data: await j.promise })));
  const feed: LargoLiveFeed = {};
  for (const row of settled) feed[row.key] = row.data;
  return feed;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function headline(item: unknown): string {
  const o = asObj(item);
  if (!o) return String(item ?? "");
  return String(o.title ?? o.headline ?? o.name ?? "").slice(0, 140);
}

function flowLine(item: unknown): string {
  const o = asObj(item);
  if (!o) return "";
  const side = String(o.option_type ?? o.side ?? o.put_call ?? "").toUpperCase();
  const strike = o.strike ?? o.strike_price ?? "";
  const prem = o.premium ?? o.total_premium ?? o.size ?? "";
  const sym = o.ticker ?? o.symbol ?? "";
  const exp = o.expiry ? String(o.expiry).slice(0, 10) : "";
  const rule = o.alert_rule ? String(o.alert_rule) : "";
  const trades = o.trade_count != null ? `×${o.trade_count}` : "";
  return [sym, side, strike ? `@${strike}` : "", exp, prem ? `$${prem}` : "", rule || null, trades || null]
    .filter(Boolean)
    .join(" ");
}

function parseStrikeStacks(raw: unknown): FlowStrikeStack[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => s && typeof s === "object") as FlowStrikeStack[];
}

function appendStrikeStacks(lines: string[], stacks: FlowStrikeStack[]) {
  if (!stacks.length) return;
  lines.push("**Strike stacks / Repeated Hits (UW-verified — cite exactly in Flow; do not invent):**");
  for (const s of stacks.slice(0, 8)) {
    lines.push(`- ${formatFlowStrikeStackLine(s)}`);
  }
}

function poolLine(item: unknown): string {
  const o = asObj(item);
  if (!o) return "";
  const px = o.price ?? o.avg_price ?? o.p ?? "";
  const sz = o.size ?? o.volume ?? o.shares ?? "";
  const ts = o.executed_at ?? o.timestamp ?? o.time ?? "";
  return [px ? `@${px}` : "", sz ? `${sz} sh` : "", ts ? String(ts).slice(0, 16) : ""].filter(Boolean).join(" · ");
}

/** Compact, human-readable block for the system prompt — Claude rephrases, never dumps verbatim. */
export function formatLargoLiveFeed(feed: LargoLiveFeed, ticker: string): string {
  const lines: string[] = [
    "## Live feed (auto-captured — authoritative source for this turn)",
    "Use ONLY figures from this block or tools you call now. Do not invent stacks, premiums, levels, or trader intent. Strike stacks below are UW-verified.",
    "",
  ];

  const spx = asObj(feed.spx_structure);
  if (spx && !spx.error) {
    lines.push("### SPX / 0DTE desk");
    lines.push(
      [
        spx.price != null ? `SPX ${spx.price}` : null,
        spx.change_pct != null ? `${spx.change_pct}%` : null,
        spx.vix != null ? `VIX ${spx.vix}` : null,
        spx.vwap != null ? `VWAP ${spx.vwap}` : null,
        spx.gex_net != null ? `GEX net ${spx.gex_net}` : null,
        spx.gamma_flip != null ? `γ flip ${spx.gamma_flip}` : null,
        spx.max_pain != null ? `max pain ${spx.max_pain}` : null,
        spx.flow_0dte_net != null ? `0DTE prem net ${spx.flow_0dte_net}` : null,
        spx.tide_bias ? `tide ${spx.tide_bias}` : null,
        spx.regime ? `regime ${spx.regime}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
    const walls = asArr(spx.gex_walls).slice(0, 6);
    if (walls.length) {
      lines.push(
        "GEX walls: " +
          walls
            .map((w) => {
              const o = asObj(w);
              return o ? `${o.strike ?? o.level} (${o.role ?? o.type ?? "wall"})` : "";
            })
            .filter(Boolean)
            .join(", ")
      );
    }
    const tape = asArr(spx.unified_tape).slice(0, 8);
    if (tape.length) {
      lines.push("Tape: " + tape.map(flowLine).filter(Boolean).join(" | "));
    }
    const spxFlows = asArr(spx.spx_flows).slice(0, 12);
    if (spxFlows.length) {
      lines.push("SPX flow: " + spxFlows.map(flowLine).filter(Boolean).join(" | "));
    }
    const spxStacks = parseStrikeStacks(spx.strike_stacks);
    if (spxStacks.length) {
      appendStrikeStacks(lines, spxStacks);
    } else if (spxFlows.length) {
      const derived = computeFlowStrikeStacks(spxFlows);
      appendStrikeStacks(lines, derived);
    }
    const dp = asObj(spx.dark_pool);
    const dpPrints = asArr(dp?.prints ?? dp?.trades ?? dp?.recent).slice(0, 5);
    if (dpPrints.length) {
      lines.push("Dark pool: " + dpPrints.map(poolLine).filter(Boolean).join(" | "));
    }
    const deskNews = asArr(spx.news_headlines).slice(0, 5);
    if (deskNews.length) {
      lines.push("Desk headlines: " + deskNews.map(headline).filter(Boolean).join(" · "));
    }
    lines.push("");
  }

  const tech = asObj(feed.technicals);
  if (tech && !tech.error) {
    lines.push(`### Chart / technicals (${ticker})`);
    lines.push(
      [
        tech.price != null ? `price ${tech.price}` : null,
        tech.trend_stack ? `trend ${tech.trend_stack}` : null,
        tech.atr14 != null ? `ATR ${tech.atr14}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
    const emas = asObj(tech.emas);
    if (emas) {
      lines.push(`EMAs: 20=${emas.ema20} 50=${emas.ema50} 200=${emas.ema200}`);
    }
    const weekly = asObj(tech.weekly);
    const monthly = asObj(tech.monthly);
    if (weekly) {
      lines.push(`Weekly: hi ${weekly.high} lo ${weekly.low} · res ${weekly.resistance} sup ${weekly.support}`);
    }
    if (monthly) {
      lines.push(`Monthly: hi ${monthly.high} lo ${monthly.low} · res ${monthly.resistance} sup ${monthly.support}`);
    }
    const tf = asObj(tech.timeframes);
    const daily = asObj(tf?.daily);
    if (daily) {
      lines.push(`Daily S/R: support ${daily.support} resistance ${daily.resistance} · RSI ${daily.rsi14}`);
    }
    lines.push("");
  }

  const flow = asObj(feed.flow);
  if (flow && !flow.error) {
    lines.push(`### Options flow (${ticker})`);
    if (flow.bias) lines.push(`Bias: ${flow.bias}`);
    const o0 = asObj(flow.intraday_0dte);
    if (o0) {
      lines.push(`0DTE: calls ${o0.call_premium ?? o0.calls} puts ${o0.put_premium ?? o0.puts} net ${o0.net}`);
    }
    const alerts = asArr(flow.flow_alerts ?? flow.unified_tape).slice(0, 15);
    if (alerts.length) {
      lines.push("Recent prints: " + alerts.map(flowLine).filter(Boolean).join(" | "));
    }
    const ap = asObj(flow.alert_premium);
    if (ap) {
      lines.push(
        `Alert premium: calls ${ap.calls ?? "—"} puts ${ap.puts ?? "—"} net ${ap.net ?? "—"}`
      );
    }
    const stacks = parseStrikeStacks(flow.strike_stacks);
    if (stacks.length) {
      appendStrikeStacks(lines, stacks);
    } else if (alerts.length) {
      const recent = asArr(flow.flow_recent);
      appendStrikeStacks(lines, computeFlowStrikeStacks([...alerts, ...recent]));
    }
    lines.push("");
  }

  const pool = asObj(feed.dark_pool);
  if (pool && !pool.error) {
    const prints = asArr(pool.prints ?? pool.trades ?? pool.recent ?? pool.data).slice(0, 8);
    if (prints.length) {
      lines.push(`### Dark pool (${ticker})`);
      lines.push(prints.map(poolLine).filter(Boolean).join(" | "));
      lines.push("");
    }
  }

  const news = asObj(feed.news);
  if (news && !news.error) {
    const articles = asArr(news.articles).slice(0, 8);
    if (articles.length) {
      lines.push(`### News (${ticker})`);
      for (const a of articles) {
        const o = asObj(a);
        if (!o) continue;
        lines.push(`- ${headline(o)}${o.teaser ? ` — ${String(o.teaser).slice(0, 120)}` : ""}`);
      }
      lines.push("");
    }
  }

  const cal = asObj(feed.calendar);
  if (cal && !cal.error) {
    const staticEv = asArr(cal.static_schedule).slice(0, 6);
    const fh = asArr(cal.finnhub).slice(0, 6);
    if (staticEv.length || fh.length) {
      lines.push("### Catalysts / calendar");
      for (const e of [...staticEv, ...fh]) {
        const o = asObj(e);
        if (!o) continue;
        lines.push(`- ${o.time ?? o.date ?? ""} ${o.event ?? o.name ?? ""} (${o.impact ?? "macro"})`);
      }
      lines.push("");
    }
  }

  const vol = asObj(feed.vol);
  if (vol && !vol.error) {
    lines.push("### Vol regime");
    lines.push(JSON.stringify(vol).slice(0, 480));
    lines.push("");
  }

  const play = asObj(feed.play);
  if (play && !play.error) {
    lines.push("### SPX play engine");
    lines.push(JSON.stringify(play).slice(0, 600));
    lines.push("");
  }

  const market = asObj(feed.market);
  if (market?.indices) {
    lines.push("### Market indices");
    lines.push(JSON.stringify(market.indices).slice(0, 400));
    lines.push("");
  }

  return lines.join("\n").trim();
}
