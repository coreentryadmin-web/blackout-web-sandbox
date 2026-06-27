import { runLargoTool } from "@/lib/largo/run-tool";
import type { LargoQuestionIntent } from "@/lib/largo/question-intent";
import { summarizeGreekExposureByExpiry } from "@/lib/greek-exposure-summary";
import {
  computeFlowStrikeStacks,
  formatFlowStrikeStackLine,
  type FlowStrikeStack,
} from "@/lib/largo/flow-strike-stacks";
import { sanitizeFeedText } from "@/lib/largo/sanitize-feed-text";
import { getGexPositioning } from "@/lib/providers/gex-positioning";

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
  | "open_plays"
  | "nighthawk"
  | "flow_tape"
  | "greek_flow"
  | "breadth"
  | "group_greek_flow"
  | "macro_indicators"
  | "gex_regime";

export type LargoLiveFeed = Partial<Record<FeedKey, unknown>>;

async function safeTool(
  name: string,
  input: Record<string, unknown> = {},
  userId?: string
): Promise<unknown> {
  try {
    return await runLargoTool(name, input, userId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "tool_failed" };
  }
}

/** Parallel capture of live API data — fed to Claude before it writes. */
export async function captureLargoLiveFeed(
  intent: LargoQuestionIntent,
  userId?: string
): Promise<LargoLiveFeed> {
  // Thread userId so SPX desk tools key the per-user desk cache correctly —
  // without it the live feed shared one default cache bucket across users (LARGO-1).
  const tool = (name: string, input: Record<string, unknown> = {}) => safeTool(name, input, userId);

  const scopeTicker = intent.tickerHint ?? (intent.needsSpxDesk ? "SPX" : null);
  const analysisTicker = scopeTicker ?? "SPX";

  const jobs: Array<{ key: FeedKey; promise: Promise<unknown> }> = [
    { key: "market", promise: tool("get_market_context") },
  ];

  if (intent.needsNews) {
    jobs.push({ key: "calendar", promise: tool("get_economic_calendar", { days_ahead: 10 }) });
  }

  if (intent.needsSpxDesk || scopeTicker === "SPX") {
    jobs.push({ key: "spx_structure", promise: tool("get_spx_structure") });
    // Inject live GEX dealer regime directly (cache-reader — zero extra upstream calls).
    // getGexPositioning is not a Largo tool; call it directly so Largo gets the same
    // structured regime the Heatmaps UI shows: gamma_posture, vanna_posture, walls, flip,
    // shift_summary. This satisfies cross-tool access (audit P0) and partially fixes #73.
    jobs.push({
      key: "gex_regime",
      promise: getGexPositioning("SPX").catch((e) => ({
        error: e instanceof Error ? e.message : "failed",
      })),
    });
  }

  if (scopeTicker) {
    jobs.push(
      { key: "technicals", promise: tool("get_technicals", { ticker: analysisTicker }) },
      { key: "flow", promise: tool("get_options_flow", { ticker: analysisTicker }) },
      { key: "dark_pool", promise: tool("get_dark_pool", { ticker: analysisTicker }) },
      { key: "vol", promise: tool("get_volatility_regime", { ticker: analysisTicker }) }
    );
  }

  if (intent.needsFlow) {
    jobs.push(
      { key: "flow_tape", promise: tool("get_flow_tape", { limit: 40 }) },
      { key: "greek_flow", promise: tool("get_greek_flow", { ticker: analysisTicker }) }
    );
  }

  if (intent.needsNews && scopeTicker) {
    jobs.push({ key: "news", promise: tool("get_news", { ticker: analysisTicker }) });
  }

  if (intent.needsPlayState || intent.needsSpxDesk) {
    jobs.push(
      { key: "play", promise: tool("get_spx_play") },
      { key: "open_plays", promise: tool("get_open_plays") }
    );
  }

  if (intent.needsSpxDesk) {
    jobs.push(
      { key: "breadth", promise: tool("get_market_breadth") },
      { key: "group_greek_flow", promise: tool("get_group_greek_flow", { group: "mag7" }) },
      { key: "macro_indicators", promise: tool("get_macro_indicator", { indicator: "CPI" }) }
    );
  }

  if (intent.needsFlow || intent.needsNews) {
    jobs.push({ key: "nighthawk", promise: tool("get_nighthawk_edition") });
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
  if (!o) return sanitizeFeedText(item);
  return sanitizeFeedText(o.title ?? o.headline ?? o.name ?? "").slice(0, 140);
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
        spx.nope != null ? `NOPE ${spx.nope}` : null,
        spx.tide_bias ? `tide ${spx.tide_bias}` : null,
        spx.regime ? `regime ${spx.regime}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
    const internals = [
      spx.tick != null ? `TICK ${spx.tick}` : null,
      spx.trin != null ? `TRIN ${spx.trin}` : null,
      spx.add != null ? `ADD ${spx.add}` : null,
    ].filter(Boolean);
    if (internals.length) {
      lines.push("Internals: " + internals.join(" · "));
    }
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
    // Macro calendar from the desk snapshot (already fetched via get_spx_structure at zero
    // extra cost) so Largo proactively knows FOMC/CPI/NFP on EVERY SPX-desk question —
    // previously macro only appeared on news-intent questions, leaving plain desk Q's blind.
    const deskMacro = asArr(spx.macro_events).slice(0, 6);
    if (deskMacro.length) {
      const macroLine = deskMacro
        .map((m) => {
          const o = asObj(m);
          if (!o) return "";
          const ev = String(o.event ?? "").trim();
          if (!ev) return "";
          const imp = String(o.impact ?? "").trim();
          const t = String(o.time ?? "").trim();
          return `${ev}${imp ? ` [${imp}]` : ""}${t ? ` ${t} ET` : ""}`;
        })
        .filter(Boolean)
        .join(" · ");
      if (macroLine) lines.push("Macro calendar: " + macroLine);
    }
    lines.push("");
  }

  // GEX dealer regime — from getGexPositioning (same cache as Heatmaps, zero extra API calls).
  // Gives Largo named regime context on every SPX desk question. Placed outside the spx block
  // so it renders even when spx_structure is stale/missing (e.g. after-hours).
  const gexReg = asObj(feed.gex_regime);
  if (gexReg && !gexReg.error) {
    lines.push("### GEX dealer regime (Polygon/Massive matrix)");
    const regimeLine = [
      gexReg.gamma_posture ? `Dealer gamma: ${gexReg.gamma_posture}` : null,
      gexReg.gamma_regime_read ? String(gexReg.gamma_regime_read) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (regimeLine) lines.push(regimeLine);
    if (gexReg.vanna_posture || gexReg.vanna_regime_read) {
      const vannaLine = [
        gexReg.vanna_posture ? `Dealer vanna: ${gexReg.vanna_posture}` : null,
        gexReg.vanna_regime_read ? String(gexReg.vanna_regime_read) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (vannaLine) lines.push(vannaLine);
    }
    if (gexReg.flip != null) lines.push(`Gamma flip: ${gexReg.flip}`);
    if (gexReg.call_wall != null) lines.push(`Call wall: ${gexReg.call_wall}`);
    if (gexReg.put_wall != null) lines.push(`Put wall: ${gexReg.put_wall}`);
    if (gexReg.spot != null) lines.push(`SPX spot (matrix): ${gexReg.spot}`);
    const nw = asObj(gexReg.nearest_wall);
    if (nw) {
      lines.push(`Nearest wall: ${nw.strike} (${nw.kind}, ${nw.distance_pts} pts away)`);
    }
    if (gexReg.distance_to_flip_pct != null) {
      lines.push(`Distance to flip: ${gexReg.distance_to_flip_pct}%`);
    }
    if (gexReg.shift_summary) {
      lines.push(`Intraday gamma shift: ${gexReg.shift_summary}`);
    }
    const intra = asObj(gexReg.gex_intraday_adjusted);
    if (intra && !intra.error) {
      lines.push(
        `0DTE intraday-adjusted flip: ${intra.adjusted_flip ?? "—"} · net GEX adj: ${intra.adjusted_net_gex ?? "—"}`
      );
    }
    lines.push("");
  }

  const greek = asObj(feed.greek_flow);
  if (greek && !greek.error) {
    lines.push("### Dealer greek flow (SPX)");
    const byExp = asArr(greek.greek_exposure_by_expiry);
    const summary = summarizeGreekExposureByExpiry(
      byExp.filter((r) => r && typeof r === "object") as Record<string, unknown>[]
    );
    if (summary) {
      lines.push(summary.headline);
      lines.push(
        summary.buckets
          .slice(0, 5)
          .map((b) => `${b.dte_label}: ${b.pct_of_total}%`)
          .join(" · ")
      );
    }
    lines.push("");
  }

  const breadth = asObj(feed.breadth);
  if (breadth && !breadth.error) {
    const fm = asObj(breadth.full_market);
    if (fm) {
      lines.push("### Market breadth");
      lines.push(
        [
          fm.pct_advancing != null ? `${fm.pct_advancing}% advancing` : null,
          fm.advance_decline_ratio != null ? `A/D ${fm.advance_decline_ratio}` : null,
          fm.pct_above_vwap != null ? `${fm.pct_above_vwap}% above VWAP` : null,
          fm.closed_near_high != null ? `closed-strong ${fm.closed_near_high}` : null,
          fm.closed_near_low != null ? `closed-weak ${fm.closed_near_low}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      );
      lines.push("");
    }
  }

  const groupGreek = asObj(feed.group_greek_flow);
  if (groupGreek && !groupGreek.error) {
    const summary = asObj(groupGreek.summary);
    if (summary?.headline) {
      lines.push("### Mag7 dealer greek flow");
      lines.push(String(summary.headline));
      lines.push("");
    }
  }

  const macro = asObj(feed.macro_indicators);
  if (macro && !macro.error && macro.latest_value != null) {
    const changePct = Number(macro.change_pct);
    const changeSuffix =
      Number.isFinite(changePct) ? ` (${changePct > 0 ? "+" : ""}${changePct}% vs prior)` : "";
    lines.push("### Macro indicator");
    lines.push(`${macro.label ?? macro.indicator}: ${macro.latest_value}${changeSuffix}`);
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
        lines.push(`- ${headline(o)}${o.teaser ? ` — ${sanitizeFeedText(o.teaser).slice(0, 120)}` : ""}`);
      }
      lines.push("");
    }
  }

  const cal = asObj(feed.calendar);
  if (cal && !cal.error) {
    const staticEv = asArr(cal.static_schedule).slice(0, 6);
    if (staticEv.length) {
      lines.push("### Catalysts / calendar");
      for (const e of staticEv) {
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
    // Limit data BEFORE stringifying to avoid mid-value JSON truncation
    const volSafe: Record<string, unknown> = {
      ticker: vol.ticker,
      vix: vol.vix,
      iv_rank: vol.iv_rank,
      source: vol.source,
      vix_term_desk: vol.vix_term_desk,
    };
    lines.push(JSON.stringify(volSafe));
    lines.push("");
  }

  const play = asObj(feed.play);
  if (play && !play.error) {
    lines.push("### SPX play engine");
    // Whitelist the key facts BEFORE stringifying so the model never sees a
    // mid-structure-truncated JSON blob (prior code sliced raw JSON at 600 chars).
    const levels = asObj(play.levels);
    const gates = asObj(play.gates);
    const open = asObj(play.open_play);
    const playSafe: Record<string, unknown> = {
      available: play.available,
      phase: play.phase,
      action: play.action,
      direction: play.direction,
      grade: play.grade,
      score: play.score,
      confidence: play.confidence,
      headline: typeof play.headline === "string" ? sanitizeFeedText(play.headline) : play.headline,
      thesis: typeof play.thesis === "string" ? sanitizeFeedText(play.thesis) : play.thesis,
    };
    if (levels) {
      playSafe.levels = {
        entry: levels.entry,
        stop: levels.stop,
        target: levels.target,
        invalidation: levels.invalidation,
      };
    }
    if (gates) {
      playSafe.gates = {
        passed: gates.passed,
        blocks: asArr(gates.blocks).slice(0, 6),
        warnings: asArr(gates.warnings).slice(0, 6),
        entry_mode: gates.entry_mode,
        play_idea: gates.play_idea,
      };
    }
    if (open) {
      playSafe.open_play = {
        id: open.id,
        direction: open.direction,
        entry_price: open.entry_price,
        stop: open.stop,
        target: open.target,
        grade: open.grade,
        opened_at: open.opened_at,
        mfe_pts: open.mfe_pts,
        trim_done: open.trim_done,
        option_label: open.option_label,
      };
    }
    lines.push(JSON.stringify(playSafe));
    lines.push("");
  }

  const market = asObj(feed.market);
  const indices = asObj(market?.indices);
  if (indices) {
    // Project each snapshot into a compact line instead of slicing the raw
    // index map mid-JSON (the map holds many symbols and slice(0,400) cut it off).
    const indexLines = Object.entries(indices)
      .map(([sym, raw]) => {
        const q = asObj(raw);
        if (!q || q.price == null) return "";
        const chg = q.change_pct != null ? ` (${q.change_pct}%)` : "";
        return `${sym} ${q.price}${chg}`;
      })
      .filter(Boolean)
      .slice(0, 16);
    if (indexLines.length) {
      lines.push("### Market indices");
      lines.push(indexLines.join(" | "));
      lines.push("");
    }
  }

  const hawk = asObj(feed.nighthawk);
  if (hawk && !hawk.error && hawk.available) {
    lines.push("### Night Hawk playbook");
    lines.push(
      [
        hawk.edition_for ? `Edition for ${hawk.edition_for}` : null,
        hawk.recap_headline ? sanitizeFeedText(hawk.recap_headline) : null,
        hawk.play_count != null ? `${hawk.play_count} plays` : null,
        Array.isArray(hawk.plays)
          ? hawk.plays
              .slice(0, 5)
              .map((p) => {
                const o = asObj(p);
                if (!o) return "";
                return `${o.ticker ?? "?"} ${o.direction ?? ""} · ${o.options_play ?? o.thesis ?? ""}`.trim();
              })
              .filter(Boolean)
              .join("; ")
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
    lines.push("");
  }

  const tape = asObj(feed.flow_tape);
  if (tape && !tape.error && tape.count) {
    lines.push("### HELIX tape (Postgres)");
    lines.push(`Alerts: ${tape.count} · Total prem $${Number(tape.total_premium ?? 0).toLocaleString()}`);
    const tops = asArr(tape.top_tickers).slice(0, 6);
    if (tops.length) {
      lines.push(
        tops
          .map((t) => {
            const o = asObj(t);
            if (!o) return "";
            return `${o.ticker} $${Number(o.premium ?? 0).toLocaleString()} (${o.count} prints)`;
          })
          .filter(Boolean)
          .join(" · ")
      );
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
