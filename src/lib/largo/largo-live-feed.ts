import { runLargoTool } from "@/lib/largo/run-tool";
import type { LargoQuestionIntent } from "@/lib/largo/question-intent";
import { summarizeGreekExposureByExpiry } from "@/lib/greek-exposure-summary";
import {
  computeFlowStrikeStacks,
  formatFlowStrikeStackLine,
  type FlowStrikeStack,
} from "@/lib/largo/flow-strike-stacks";
import { sanitizeFeedText } from "@/lib/largo/sanitize-feed-text";
import { roundFloats } from "@/lib/round-floats";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { getActiveTradingHalts, isTradingHaltChannelStale, tideStore } from "@/lib/ws/uw-socket";
import { getLargoSpxLiveDesk } from "@/lib/largo/spx-desk-cache";
import { computeSpxConfluence } from "@/lib/spx-signals";
import { loadLottoRecord } from "@/lib/spx-lotto-store";

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
  | "gex_regime"
  | "halts"
  | "tide"
  | "net_flow"
  | "my_positions"
  | "spx_confluence"
  | "lotto_live"
  | "power_hour"
  | "zerodte_plays";

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
    // Ambient desk awareness: the 0DTE Command board's own plays, on EVERY turn —
    // Largo should never be surprised by a play the platform itself published.
    // Cheap (single ledger read; statuses pre-latched by the cron).
    {
      key: "zerodte_plays",
      promise: import("@/lib/zerodte/scan")
        .then((m) => m.zeroDtePlaysFeed())
        .catch((e) => ({ error: e instanceof Error ? e.message : "failed" })),
    },
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

  // Always include the Night Hawk edition when one exists — one Redis/Postgres read, marginal cost.
  // Previously only injected on needsFlow || needsNews intent; now always present so Largo always
  // has the evening playbook context (play count, top tickers, recap) without an explicit tool call.
  // get_nighthawk_edition reads the shared Postgres cache and returns { available: false, plays: [] }
  // when no edition exists — safe to call unconditionally.
  jobs.push({ key: "nighthawk", promise: tool("get_nighthawk_edition") });

  // Always pre-fetch open positions so Largo knows what the user holds without needing
  // an explicit tool call (P0 cross-tool access — my_positions always injected).
  if (userId) {
    jobs.push({ key: "my_positions", promise: tool("get_my_positions", { status: "open" }) });
  }

  const settled = await Promise.all(jobs.map(async (j) => ({ key: j.key, data: await j.promise })));
  const feed: LargoLiveFeed = {};
  for (const row of settled) feed[row.key] = row.data;
  // Trading halt state is synchronous (in-process store) — no async job needed.
  const activeHalts = getActiveTradingHalts();
  feed.halts = {
    active_halts: activeHalts.map((h) => ({ symbol: h.symbol, halt_type: h.halt_type, reason: h.reason })),
    channel_stale: isTradingHaltChannelStale(),
    has_active: activeHalts.length > 0,
  };

  // Tide — full tideStore shape (call_premium, put_premium, net, bias) from the UW WS.
  // Synchronous in-process read — zero API cost, same pattern as the halts store above.
  feed.tide = {
    call_premium: tideStore.call_premium,
    put_premium: tideStore.put_premium,
    net: tideStore.net,
    bias: tideStore.bias,
    updated_at: tideStore.updatedAt || null,
  };

  // Net-flow — reuse the spx_structure desk snapshot's net_flow_by_expiry when present,
  // so Largo sees the per-expiry 0DTE net-flow breakdown without an extra upstream call.
  const spxSnap = feed.spx_structure as Record<string, unknown> | null | undefined;
  if (spxSnap && Array.isArray(spxSnap.net_flow_by_expiry)) {
    feed.net_flow = spxSnap.net_flow_by_expiry;
  }

  // Pre-populate spx_confluence — same logic as get_spx_confluence tool but without the
  // tool-call round-trip. Cache-reader: getLargoSpxLiveDesk is already called for spx_structure
  // above; calling it again hits the in-process per-user bundle cache (0 upstream cost).
  // Falls back to a shared "_anon" cache slot when no userId — ensures confluence is ALWAYS
  // pre-populated for SPX desk questions regardless of auth state.
  if (intent.needsSpxDesk || scopeTicker === "SPX") {
    try {
      const desk = await getLargoSpxLiveDesk(userId ?? "_anon");
      const confluence = computeSpxConfluence(desk);
      feed.spx_confluence = confluence ?? { error: "No confluence — SPX desk not live yet." };
    } catch {
      feed.spx_confluence = { error: "spx_confluence unavailable" };
    }
  }

  // Pre-populate lotto_live — synchronous Postgres/Redis read, negligible cost.
  // Always inject when the SPX desk is in scope so Largo has lotto context for desk questions.
  if (intent.needsSpxDesk || scopeTicker === "SPX") {
    try {
      const rec = await loadLottoRecord();
      feed.lotto_live = rec ?? { available: false, note: "No live lotto record for today yet." };
    } catch {
      feed.lotto_live = { available: false, note: "lotto unavailable" };
    }
  }

  // Power hour — inject when within the last 60 minutes of RTH (3:00–4:00pm ET).
  // Pure clock computation — zero upstream cost.
  {
    const nowEt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hours = nowEt.getHours();
    const minutes = nowEt.getMinutes();
    const minuteOfDay = hours * 60 + minutes;
    const POWER_HOUR_START = 15 * 60; // 15:00 ET = 900
    const POWER_HOUR_END = 16 * 60;   // 16:00 ET = 960
    if (minuteOfDay >= POWER_HOUR_START && minuteOfDay < POWER_HOUR_END) {
      feed.power_hour = {
        active: true,
        minutes_remaining: POWER_HOUR_END - minuteOfDay,
      };
    }
  }

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
export function formatLargoLiveFeed(rawFeed: LargoLiveFeed, ticker: string): string {
  // Round once up front: this builder interpolates dozens of numeric fields verbatim
  // (price, ATR, EMAs, weekly/monthly levels, RSI, premiums), and money-math float
  // noise like ema20=7428.676040091288 was being injected into the model context
  // character-for-character — wasted tokens and a nonsense precision signal to the
  // model. Same shared helper the API responses use; integers/strings untouched.
  const feed = roundFloats(rawFeed);
  const lines: string[] = [
    "## Live feed (auto-captured — authoritative source for this turn)",
    "Use ONLY figures from this block or tools you call now. Do not invent stacks, premiums, levels, or trader intent. Strike stacks below are UW-verified.",
    "",
  ];

  // Trading halts — rendered first so Claude sees halt context before any level discussion.
  const halts = asObj(feed.halts);
  if (halts) {
    const haltList = asArr(halts.active_halts);
    if (halts.has_active && haltList.length > 0) {
      lines.push("### TRADING HALTS ACTIVE");
      for (const h of haltList) {
        const o = asObj(h);
        if (!o) continue;
        lines.push(
          `- ${o.symbol} halted (${o.halt_type ?? "unknown type"})${o.reason ? ` — ${o.reason}` : ""}`
        );
      }
      lines.push("NOTE: Entries are blocked on all halted symbols. Do not suggest trades on these tickers.");
      lines.push("");
    } else if (halts.channel_stale) {
      lines.push("### Halt feed status");
      lines.push("WARNING: The trading-halt monitoring channel is degraded/offline. This does NOT block entries by itself -- the engine fails open, it does not fail closed. If the user asks about entering a position, tell them the halt feed can't be freshly confirmed right now and to manually verify no active halt exists before entering.");
      lines.push("");
    }
  }

  // 0DTE Command plays — the desk's OWN live plays; cite them as ours, not as market data.
  const zd = asObj(feed.zerodte_plays);
  if (zd && zd.available === true) {
    const plays = asArr(zd.plays);
    if (plays.length > 0) {
      lines.push("### 0DTE Command plays (OUR live board — /grid)");
      for (const pRaw of plays.slice(0, 8)) {
        const o = asObj(pRaw);
        if (!o) continue;
        lines.push(
          `- ${o.ticker} ${o.contract} — ${o.status}` +
            (o.entry_premium != null ? ` @ ${o.entry_premium}` : "") +
            (o.last_mark != null ? ` (mark ${o.last_mark})` : "") +
            (o.result ? ` — result: ${o.result}` : "")
        );
      }
      lines.push("If the user asks about any of these names, anchor on OUR play state first (get_zerodte_plays for full detail).");
      lines.push("");
    }
  }

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
    // DEX / CHARM extended regime fields (sourced from getGexPositioning).
    if (gexReg.dex_posture || gexReg.dex_regime_read) {
      const dexLine = [
        gexReg.dex_posture ? `Dealer delta posture: ${gexReg.dex_posture}` : null,
        gexReg.dex_regime_read ? String(gexReg.dex_regime_read) : null,
      ].filter(Boolean).join(" · ");
      if (dexLine) lines.push(dexLine);
    }
    if (gexReg.charm_posture) lines.push(`Charm posture: ${gexReg.charm_posture}`);
    if (gexReg.charm_regime_read) lines.push(`Charm/pinning read: ${gexReg.charm_regime_read}`);
    // Pivot price levels sourced from the GEX matrix.
    // delta_zero = DEX zero-crossing (where net dealer delta flips sign) — proxy for the mean-revert anchor.
    // charm_zero = CHARM zero-crossing (delta-decay flip level).
    // vanna_flip = VEX zero-crossing (vanna-amplification trigger level).
    // These are not direct fields on GexPositioning but can be approximated from the
    // nearest_wall/flip when the posture sign changes. For now surface what's available:
    if (gexReg.net_dex != null && gexReg.spot != null && gexReg.flip != null) {
      // Approximate delta_zero as the flip level when dex_posture flips around it.
      lines.push(`Delta zero (approx): ${gexReg.flip} (gamma flip is the primary mean-revert anchor)`);
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

  // Market tide — standalone top-level key (call_premium, put_premium, net, bias).
  // Bias drives HELIX flow direction context; cite if present and non-zero.
  const tide = asObj(feed.tide);
  if (tide && (tide.net !== 0 || tide.bias)) {
    lines.push("### Market tide (UW WS)");
    lines.push(
      [
        tide.call_premium != null ? `calls $${Number(tide.call_premium).toLocaleString()}` : null,
        tide.put_premium != null ? `puts $${Number(tide.put_premium).toLocaleString()}` : null,
        tide.net != null ? `net $${Number(tide.net).toLocaleString()}` : null,
        tide.bias ? `bias ${tide.bias}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
    lines.push("");
  }

  // Open positions — always pre-fetched and injected so Largo knows what the user holds
  // without requiring an explicit tool call (P0 cross-tool access requirement).
  const myPos = asObj(feed.my_positions);
  if (myPos && !myPos.error) {
    const posArr = asArr(myPos.positions ?? myPos.data).filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
    const openPos = posArr.filter((p) => (p.status ?? "open") === "open");
    if (openPos.length > 0) {
      lines.push("### My open positions (auto-injected)");
      for (const p of openPos.slice(0, 10)) {
        const ticker = p.ticker ?? p.symbol ?? "?";
        const side = p.side ?? p.direction ?? "";
        const strike = p.strike ?? "";
        const expiry = p.expiry ? String(p.expiry).slice(0, 10) : "";
        const plPct = p.pnl_pct != null ? `P&L ${Number(p.pnl_pct).toFixed(1)}%` : "";
        const nwVerdict = p.nw_verdict ?? p.verdict ?? "";
        lines.push(
          `- ${ticker} ${side}${strike ? ` $${strike}` : ""}${expiry ? ` exp ${expiry}` : ""}${plPct ? ` · ${plPct}` : ""}${nwVerdict ? ` · verdict: ${nwVerdict}` : ""}`
        );
      }
      lines.push("");
    }
  }

  // Net-flow by expiry — top-level key reused from desk snapshot; shows 0DTE vs weekly splits.
  const netFlow = asArr(feed.net_flow).slice(0, 8);
  if (netFlow.length) {
    lines.push("### Net flow by expiry");
    lines.push(
      netFlow
        .map((r) => {
          const o = asObj(r);
          if (!o) return "";
          const exp = String(o.expiry ?? o.dte ?? "").slice(0, 10);
          const net = o.net_premium ?? o.net ?? "";
          return exp && net !== "" ? `${exp}: $${Number(net).toLocaleString()}` : "";
        })
        .filter(Boolean)
        .join(" · ")
    );
    lines.push("");
  }

  return lines.join("\n").trim();
}
