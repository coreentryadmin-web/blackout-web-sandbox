import { anthropicText } from "./anthropic";
import type { SpxDeskPayload } from "./spx-desk";
import { computeSpxTradeSignal } from "@/lib/spx-signals";

export type SpxCommentaryResult = {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  watch: string[];
  changed: string[];
  as_of: string;
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPrem(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function computeDelta(
  desk: SpxDeskPayload,
  prev?: Partial<SpxDeskPayload> | null
): string[] {
  if (!prev?.price) return ["Initial desk snapshot — establishing baseline."];

  const lines: string[] = [];
  const dp = desk.price - prev.price;
  if (Math.abs(dp) >= 0.5) {
    lines.push(`SPX ${dp >= 0 ? "+" : ""}${dp.toFixed(2)} pts (${fmt(prev.price)} → ${fmt(desk.price)})`);
  }

  if (prev.vwap != null && desk.vwap != null) {
    const wasAbove = prev.price >= prev.vwap;
    const nowAbove = desk.price >= desk.vwap;
    if (wasAbove !== nowAbove) {
      lines.push(nowAbove ? "Crossed above VWAP" : "Lost VWAP — now below session average");
    }
  }

  if (prev.regime && desk.regime && prev.regime !== desk.regime) {
    lines.push(`Regime shift: ${prev.regime} → ${desk.regime}`);
  }

  if (prev.gex_king != null && desk.gex_king != null && prev.gex_king !== desk.gex_king) {
    lines.push(`GEX king moved: ${fmt(prev.gex_king)} → ${fmt(desk.gex_king)}`);
  }

  if (prev.gamma_flip != null && desk.gamma_flip != null && prev.gamma_flip !== desk.gamma_flip) {
    lines.push(`γ flip level: ${fmt(prev.gamma_flip)} → ${fmt(desk.gamma_flip)}`);
  }

  if (prev.tide_bias && desk.tide_bias && prev.tide_bias !== desk.tide_bias) {
    lines.push(`Market tide: ${prev.tide_bias} → ${desk.tide_bias}`);
  }

  if (prev.dark_pool?.bias && desk.dark_pool?.bias && prev.dark_pool.bias !== desk.dark_pool.bias) {
    lines.push(`Dark pool bias: ${prev.dark_pool.bias} → ${desk.dark_pool.bias}`);
  }

  if (prev.hod != null && desk.hod != null && desk.hod > prev.hod + 0.25) {
    lines.push(`New session HOD: ${fmt(desk.hod)}`);
  }
  if (prev.lod != null && desk.lod != null && desk.lod < prev.lod - 0.25) {
    lines.push(`New session LOD: ${fmt(desk.lod)}`);
  }

  const prevTape = prev.unified_tape ?? [];
  const nextTape = desk.unified_tape ?? [];
  if (nextTape.length > prevTape.length && nextTape[0]) {
    const latest = nextTape[0];
    lines.push(
      `New tape: ${latest.kind === "flow" ? "flow" : "dark pool"} ${latest.label} · ${fmtPrem(latest.premium)}`
    );
  }

  const prevWalls = (prev.gex_walls ?? []).map((w) => w.strike).join(",");
  const nextWalls = (desk.gex_walls ?? []).map((w) => w.strike).join(",");
  if (prevWalls && nextWalls && prevWalls !== nextWalls) {
    lines.push("0DTE GEX wall nodes shifted");
  }

  const prevNews = new Set((prev.news_headlines ?? []).map((n) => n.title));
  const freshHeadline = (desk.news_headlines ?? []).find((n) => n.title && !prevNews.has(n.title));
  if (freshHeadline) {
    lines.push(`New headline: ${freshHeadline.title.slice(0, 80)}`);
  }

  if (lines.length === 0) {
    lines.push("Tape quiet — levels holding, monitoring for structure breaks.");
  }

  return lines;
}

/** Full desk intel for Claude — mirrors everything on the SPX dashboard. */
function deskContext(desk: SpxDeskPayload): Record<string, unknown> {
  const netPrem = desk.net_prem_ticks ?? [];
  const lastNetPrem = netPrem.length ? netPrem[netPrem.length - 1]?.net : null;
  const price = desk.price;
  const levels = desk.levels ?? [];
  const supports = levels.filter((l) => l.kind === "support");
  const resistances = levels.filter((l) => l.kind === "resistance");
  const gexWalls = desk.gex_walls ?? [];
  const gexSupport = gexWalls.filter((w) => w.kind === "support");
  const gexResistance = gexWalls.filter((w) => w.kind === "resistance");

  return {
    as_of: desk.as_of,
    source: desk.source,

    trade_signal: computeSpxTradeSignal(desk),

    price_action: {
      price,
      change_pct: desk.spx_change_pct,
      above_vwap: desk.above_vwap,
      lod: desk.lod,
      hod: desk.hod,
      vwap: desk.vwap,
      pdh: desk.pdh,
      pdl: desk.pdl,
      regime: desk.regime,
    },

    moving_averages: {
      ema20: desk.ema20,
      ema50: desk.ema50,
      ema200: desk.ema200,
      sma50: desk.sma50,
      sma200: desk.sma200,
      price_vs_ema20: price != null && desk.ema20 != null ? price - desk.ema20 : null,
      price_vs_ema50: price != null && desk.ema50 != null ? price - desk.ema50 : null,
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
    },

    gex_walls_0dte: {
      support_nodes: gexSupport.map((w) => ({
        strike: w.strike,
        net_gex: w.net_gex,
        distance_from_price: price != null ? w.strike - price : null,
      })),
      resistance_nodes: gexResistance.map((w) => ({
        strike: w.strike,
        net_gex: w.net_gex,
        distance_from_price: price != null ? w.strike - price : null,
      })),
      all_walls: gexWalls,
    },

    support_resistance_levels: {
      nearest_support: supports.slice(0, 5),
      nearest_resistance: resistances.slice(0, 5),
      full_ladder: levels,
    },

    flow_0dte: {
      call_premium: desk.flow_0dte_call_premium,
      put_premium: desk.flow_0dte_put_premium,
      net: desk.flow_0dte_net,
      pcr:
        desk.flow_0dte_call_premium && desk.flow_0dte_call_premium > 0
          ? (desk.flow_0dte_put_premium ?? 0) / desk.flow_0dte_call_premium
          : null,
    },

    market_tide: {
      bias: desk.tide_bias,
      call_premium: desk.tide_call_premium,
      put_premium: desk.tide_put_premium,
      net: desk.tide_net,
    },

    nope: {
      nope: desk.nope,
      net_delta: desk.nope_net_delta,
    },

    dark_pool: desk.dark_pool
      ? {
          bias: desk.dark_pool.bias,
          total_premium: desk.dark_pool.total_premium,
          call_premium: desk.dark_pool.call_premium,
          put_premium: desk.dark_pool.put_premium,
          pcr: desk.dark_pool.pcr,
          prints: desk.dark_pool.prints.map((p) => ({
            time: p.executed_at,
            strike: p.strike,
            premium: p.premium,
            side: p.side,
          })),
        }
      : null,

    spx_option_flows: (desk.spx_flows ?? []).map((f) => ({
      type: f.option_type,
      strike: f.strike,
      expiry: f.expiry,
      premium: f.premium,
      direction: f.direction,
      time: f.alerted_at,
    })),

    live_tape: {
      description: "Unified flow + dark pool tape (same as Live Tape panel)",
      items: (desk.unified_tape ?? []).map((t) => ({
        kind: t.kind,
        time: t.time,
        label: t.label,
        premium: t.premium,
        detail: t.detail,
      })),
    },

    oi_changes: desk.oi_changes,

    net_premium_velocity: {
      spy_last_tick: lastNetPrem,
      recent_ticks: netPrem.slice(-12).map((t) => ({ time: t.time, net: t.net })),
    },

    mega_cap_stocks: {
      leaders: [...(desk.leader_stocks ?? [])].sort((a, b) => b.change_pct - a.change_pct),
      laggards: [...(desk.leader_stocks ?? [])].sort((a, b) => a.change_pct - b.change_pct),
    },

    macro_calendar_today: desk.macro_events,

    news_headlines: (desk.news_headlines ?? []).map((n) => ({
      title: n.title,
      tickers: n.tickers,
      published: n.published,
    })),
  };
}

function parseCommentaryJson(raw: string): SpxCommentaryResult | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const bias = String(parsed.bias ?? "neutral").toLowerCase();
    const validBias =
      bias === "bullish" || bias === "bearish" ? bias : ("neutral" as const);

    return {
      headline: String(parsed.headline ?? "Desk update"),
      bias: validBias,
      body: String(parsed.body ?? ""),
      watch: Array.isArray(parsed.watch) ? parsed.watch.map(String).slice(0, 5) : [],
      changed: Array.isArray(parsed.changed) ? parsed.changed.map(String).slice(0, 6) : [],
      as_of: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function generateSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null
): Promise<SpxCommentaryResult | null> {
  const delta = computeDelta(desk, previous);
  const ctx = deskContext(desk);

  const prompt = `You are the lead mentor for BlackOut SPX-Sniper — a 0DTE SPX index options desk. Write a live desk commentary update for members watching the dashboard.

You receive the COMPLETE desk snapshot as JSON — every panel on the dashboard is represented. You MUST synthesize across ALL non-empty sections below. Do not ignore data that is present.

DASHBOARD SECTIONS IN THE JSON (use each when populated):
0. trade_signal — rule-based 0DTE confluence (BUY_CALL / BUY_PUT / HOLD / WAIT, score, confidence, entry/stop/target). Align commentary with this when present; explain agreement or conflict.
1. price_action + moving_averages — SPX vs VWAP, HOD/LOD, PDH/PDL, EMAs/SMAs, regime
2. support_resistance_levels — full ladder with distance_pct (support/resistance/neutral levels)
3. dealer_gex + gex_walls_0dte — net GEX, GEX king, max pain, γ flip, gamma regime, AND each 0DTE GEX wall node (support vs resistance strikes + net_gex)
4. dark_pool — institutional prints, bias, PCR
5. live_tape — unified flow + dark pool tape (same as Live Tape panel); cite recent large prints
6. spx_option_flows — raw SPX option sweeps
7. flow_0dte — intraday 0DTE call/put premium skew
8. market_tide + nope — broad flow bias and NOPE
9. volatility — VIX, IV rank, vix_term, iv_term_structure
10. internals — TICK, TRIN, ADD
11. net_premium_velocity — SPY net prem tick velocity
12. oi_changes — strike OI shifts
13. mega_cap_stocks — AAPL/NVDA/MSFT/GOOG/TSLA/META day %
14. macro_calendar_today — today's macro events
15. news_headlines — Benzinga catalysts (reference only if provided)

CURRENT DESK (JSON):
${JSON.stringify(ctx)}

WHAT CHANGED SINCE LAST UPDATE:
${delta.map((d) => `- ${d}`).join("\n")}

Respond with ONLY valid JSON (no markdown fences):
{
  "headline": "One punchy line — max 14 words",
  "bias": "bullish" | "bearish" | "neutral",
  "body": "8-12 short bullet lines separated by \\n. REQUIRED coverage when data exists: (a) price vs VWAP + nearest support/resistance from support_resistance_levels, (b) dealer/GEX king/γ flip/gamma_regime, (c) gex_walls_0dte support & resistance nodes with strikes, (d) dark_pool bias + notable prints, (e) live_tape recent flow/DP, (f) 0DTE flow skew, (g) VIX/IV context, (h) mega-cap leadership, (i) OI changes or net prem velocity if notable, (j) headline catalyst from news if any, (k) what changed, (l) next 15-30 min playbook. Mentor voice — direct, no hype, no disclaimers.",
  "watch": ["specific strike/level 1", "specific strike/level 2", "specific strike/level 3"],
  "changed": ["what shifted 1", "what shifted 2"]
}

Rules:
- SPX index prices only for levels. Round to .00.
- Cite real numbers from the JSON — premiums as ${fmtPrem(1_500_000)} style when large.
- If a section is null/empty, skip it — do not invent data.
- When gex_walls_0dte or support_resistance_levels exist, you MUST reference specific strikes.
- When live_tape has items, reference at least one recent tape line.
- When news_headlines exist, mention the most relevant headline if it affects SPX.
- Max 280 words in body.`;

  const raw = await anthropicText(prompt, 1800);
  if (!raw) return null;

  const parsed = parseCommentaryJson(raw);
  if (parsed) {
    if (!parsed.changed.length) parsed.changed = delta.slice(0, 4);
    return parsed;
  }

  return {
    headline: "Desk update",
    bias: "neutral",
    body: raw.slice(0, 800),
    watch: [],
    changed: delta,
    as_of: new Date().toISOString(),
  };
}
