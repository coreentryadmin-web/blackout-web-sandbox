import { anthropicText, COMMENTARY_MODEL } from "./anthropic";
import type { SpxDeskPayload } from "./spx-desk";
import { computeSpxConfluence } from "@/lib/spx-signals";
import {
  formatFlowStrikeStackLine,
  flowStackSignature,
} from "@/lib/largo/flow-strike-stacks";

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

  const prevStacks = flowStackSignature(prev.strike_stacks);
  const nextStacks = flowStackSignature(desk.strike_stacks);
  if (nextStacks && prevStacks !== nextStacks) {
    const top = desk.strike_stacks?.[0];
    if (top) {
      lines.push(`Strike stack shift: ${formatFlowStrikeStackLine(top)}`);
    } else {
      lines.push("SPX flow strike stacks updated");
    }
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

    confluence: computeSpxConfluence(desk),

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

    market_breadth: desk.market_breadth
      ? {
          advance_decline_ratio: desk.market_breadth.advance_decline_ratio,
          pct_advancing: desk.market_breadth.pct_advancing,
          pct_above_vwap: desk.market_breadth.pct_above_vwap,
          closed_near_high: desk.market_breadth.closed_near_high,
          closed_near_low: desk.market_breadth.closed_near_low,
          volume_leaders: desk.market_breadth.volume_leaders?.slice(0, 5),
          sample_size: desk.market_breadth.sample_size,
        }
      : null,

    sector_heat: desk.sector_heat?.slice(0, 11),

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

    greek_exposure_by_expiry: desk.greek_exposure
      ? {
          headline: desk.greek_exposure.headline,
          pinned_expiry: desk.greek_exposure.pinned_expiry,
          pinned_pct: desk.greek_exposure.pinned_pct,
          buckets: desk.greek_exposure.buckets,
        }
      : null,

    mag7_greek_flow: desk.mag7_greek_flow
      ? {
          headline: desk.mag7_greek_flow.headline,
          bias: desk.mag7_greek_flow.bias,
          net_delta: desk.mag7_greek_flow.net_delta,
          net_gamma: desk.mag7_greek_flow.net_gamma,
        }
      : null,

    macro_indicators: (desk.macro_indicators ?? []).map((m) => ({
      indicator: m.indicator,
      label: m.label,
      latest_value: m.latest_value,
      change_pct: m.change_pct,
      as_of: m.as_of,
    })),

    flow_by_expiry: (desk.flow_by_expiry ?? []).slice(0, 8).map((r) => ({
      expiry: String(r.expiry ?? r.expiration ?? "").slice(0, 10),
      call_premium: r.call_premium ?? r.calls,
      put_premium: r.put_premium ?? r.puts,
      net: r.net ?? r.net_premium,
    })),

    net_flow_by_expiry: (desk.net_flow_by_expiry ?? []).slice(0, 8).map((r) => ({
      expiry: String(r.expiry ?? r.expiration ?? r.dte ?? "").slice(0, 10),
      call_premium: r.call_premium ?? r.calls,
      put_premium: r.put_premium ?? r.puts,
      net: r.net ?? r.net_premium,
    })),

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
      alert_rule: f.alert_rule,
      trade_count: f.trade_count,
      has_sweep: f.has_sweep,
    })),

    strike_stacks: {
      description:
        "UW-verified only — do not describe stacks if this array is empty. Use summary and premiums[] verbatim.",
      stacks: (desk.strike_stacks ?? []).map((s) => ({
        strike: s.strike,
        option_type: s.option_type,
        expiry: s.expiry,
        alert_count: s.alert_count,
        total_premium: s.total_premium,
        premiums: s.premiums,
        trade_count: s.trade_count,
        repeated_hits: s.repeated_hits,
        same_strike_accumulation: s.same_strike_accumulation,
        alert_rules: s.alert_rules,
        kind: s.kind,
        summary: formatFlowStrikeStackLine(s),
      })),
    },

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
      watch: Array.isArray(parsed.watch) ? parsed.watch.map(String).slice(0, 6) : [],
      changed: Array.isArray(parsed.changed) ? parsed.changed.map(String).slice(0, 6) : [],
      as_of: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

const COMMENTARY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    body: { type: "string" },
    watch: { type: "array", items: { type: "string" } },
    changed: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "bias", "body", "watch", "changed"],
  additionalProperties: false,
} as const;

function sectionHasData(section: unknown): boolean {
  if (section == null) return false;
  if (typeof section !== "object") return false;
  const obj = section as Record<string, unknown>;
  return Object.values(obj).some((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
}

function validateDeskData(ctx: Record<string, unknown>): { ok: true } | { ok: false; reason: string } {
  const priceAction = ctx.price_action as Record<string, unknown> | undefined;
  const dealerGex = ctx.dealer_gex as Record<string, unknown> | undefined;

  const hasPrice =
    priceAction != null &&
    priceAction.price != null &&
    Number.isFinite(Number(priceAction.price)) &&
    Number(priceAction.price) > 0;

  const hasGex =
    dealerGex != null &&
    (dealerGex.gex_king != null ||
      dealerGex.gamma_flip != null ||
      dealerGex.gex_net != null ||
      dealerGex.max_pain != null);

  if (!hasPrice) return { ok: false, reason: "missing_price_action" };
  if (!hasGex) return { ok: false, reason: "missing_dealer_gex" };

  const sections = [
    "price_action",
    "dealer_gex",
    "flow_0dte",
    "market_tide",
    "volatility",
    "support_resistance_levels",
  ];
  const populated = sections.filter((key) => sectionHasData(ctx[key])).length;
  if (populated < 2) {
    return { ok: false, reason: "insufficient_desk_sections" };
  }

  return { ok: true };
}

export async function generateSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null
): Promise<SpxCommentaryResult | null> {
  const delta = computeDelta(desk, previous);
  const ctx = deskContext(desk);

  const dataCheck = validateDeskData(ctx);
  if (dataCheck.ok === false) {
    console.warn("[spx-commentary] skipping Claude call:", dataCheck.reason);
    return null;
  }

  // Determine session phase from as_of timestamp for time-context in the prompt
  const asOfMs = desk.as_of ? new Date(desk.as_of).getTime() : Date.now();
  const etHour = new Date(new Date(asOfMs).toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  const etMin  = new Date(new Date(asOfMs).toLocaleString("en-US", { timeZone: "America/New_York" })).getMinutes();
  const etMins = etHour * 60 + etMin;
  const sessionPhase =
    etMins < 570  ? "pre-market"           // before 9:30
    : etMins < 600  ? "opening-range"      // 9:30–10:00
    : etMins < 660  ? "mid-morning"        // 10:00–11:00
    : etMins < 780  ? "midday-grind"       // 11:00–13:00
    : etMins < 870  ? "afternoon"          // 13:00–14:30
    : etMins < 930  ? "power-hour"         // 14:30–15:30
    :                 "final-30";          // 15:30–16:00

  const prompt = `You are the head trader on BlackOut SPX-Sniper — a real-money 0DTE SPX desk with 25+ years on the screen. Write the LIVE DESK AI read for traders watching right now. Be RUTHLESS: maximum signal, zero filler, no hype, no disclaimers, no hedging ("could/might/monitor closely"). A pro must read the whole thing in ~15 seconds and instantly know the read, the levels, the trade, and what kills it. Say less with more signal.

SESSION PHASE: ${sessionPhase} (ET). Tailor the call to the phase:
- opening-range: vol highest, don't chase, wait for the range break + confirmation
- mid-morning: best setups — VWAP reclaim/reject + GEX-wall reaction
- midday-grind: low vol, theta bleeds — lighter size or no trade
- afternoon/power-hour: momentum + squeeze risk at the gamma flip
- final-30: no new 0DTE unless already in

ACCURACY: every number/strike/premium comes from the JSON below or WHAT CHANGED. Never invent. Skip anything null/empty. SPX prices to .00; premiums like ${fmtPrem(1_500_000)}.

DATA AVAILABLE (use only what is populated): confluence (grade A+/A/B/C/D, action, factors); price_action (price, change_pct, above_vwap, vwap, hod/lod, pdh/pdl); moving_averages; support_resistance_levels (nearest_support/resistance); dealer_gex (gex_net, gamma_flip, above_gamma_flip, gex_king, max_pain, gamma_regime); gex_walls_0dte (strikes + net_gex); flow_0dte (call/put/net premium); spx_option_flows (sweeps/blocks); live_tape; strike_stacks; dark_pool (bias, pcr, prints); market_tide; nope; volatility (VIX, IV rank, term); internals (TICK/TRIN/ADD); market_breadth; macro_calendar_today; news_headlines; mega_cap_stocks; net_premium_velocity.

CURRENT DESK SNAPSHOT (JSON):
${JSON.stringify(ctx)}

WHAT CHANGED SINCE LAST DESK READ:
${delta.map((d) => `- ${d}`).join("\n")}

WHITE-EMPHASIS MARKUP — IMPORTANT: wrap EVERY number (price, point distance, %, grade like B+, strike, premium $, net_gex, PCR/NOPE, VIX, IV rank, event time) AND every verbatim news headline / ticker move in double braces {{...}}. Everything else (the read, verbs, labels) stays UNWRAPPED. Example: "SHORT · {{B+}} · {{6011}} ({{-4}} vs VWAP), below γflip — neg-γ". Never wrap desk verbs or section labels.

Respond with ONLY valid JSON (no markdown fences, no trailing commas):
{
  "headline": "READ — the thesis in one breath, <=22 words. Lead with the bias verb (LONG / SHORT / FADE / CHOP / NO-EDGE) from confluence.action, then {{grade}}, then {{price}} {{change_pct}} anchored to {{signed pts vs VWAP}} and {{gamma_flip}}, closed with the regime word (pos-γ = pinned/dips-bought, neg-γ = trend/fuel/accelerant). Grade C/D => NO-EDGE + why in 3 words. This IS the headline — numbers in {{}}.",
  "bias": "bullish" | "bearish" | "neutral",
  "body": "Newline-separated labeled lines, ONE line per label, <=26 words each, numbers/news in {{}}. ORDER: include 'Δ SINCE LAST' FIRST only if something material moved; then ALWAYS 'LEVELS', 'SETUP', 'NEXT 3M', 'FLIPS IT'; then 'FLOW' and 'NEWS' ONLY if they carry real signal (omit the whole line otherwise). Each line starts with its UPPERCASE label followed by TWO spaces.\\nΔ SINCE LAST  max 2 items that MOVED vs last read, lead with any sign flip as {{prev->now}} (e.g. 'GEX {{pos->neg}}', 'lost VWAP {{6017->6011}}', 'grade {{C+->B+}}'). Omit the line entirely if nothing material moved — never write filler like 'tape quiet'.\\nLEVELS  nearest resistance above + nearest support below with SIGNED {{pt distance}}; PREFER and tag the level that coincides with a GEX wall ({{strike}} {{net_gex}}); add {{pin}}=gex_king/max_pain only if it sits between spot and a level. e.g. 'LEVELS  R {{6018}} ({{+7}}) · {{6031}} ({{+20}}, call wall) · S {{6004}} ({{-7}}, γwall {{-2.1B}}) · pin {{6005}}'\\nSETUP  gated by confluence.grade. Grade >=A: Direction / Trigger ({{level}}+confirm) / Stop {{level}} / Target {{level}} / strike note from IV rank ({{>50}} -> debit spread, {{<30}} -> naked ok) / Edge (top 2 confluence.factors). Grade B: conditional 'If {{X}} then …'. Grade C/D or midday-grind: 'No clean setup — flat until {{condition}}.'\\nNEXT 3M  what to expect until the next read (~3 min) from gamma_regime + position vs walls + net_premium_velocity + internals + tide. Pos-γ near a wall: pin/fade toward {{gex_king/max_pain}}. Neg-γ below flip: expansion/trend — name the {{air-pocket}} path. State the behavior AND the path with target {{strikes}}.\\nFLIPS IT  the ONE reading that voids the thesis (your stop): γflip cross / VWAP reclaim-loss / structure break. EXACTLY one, with a {{number}}. e.g. 'FLIPS IT  Reclaim {{6015}} (VWAP+γflip) -> short dead, flat'\\nFLOW  the single strongest of: 0DTE skew {{%}} net {{$}}, a {{sweep}} ({{strike}} {{$}}), a building stack (summary verbatim), hard dark-pool {{bias/pcr}}, or {{NOPE}} extreme — say if it confirms or fades the read. Omit if routine.\\nNEWS  one crisp MATERIAL catalyst only: SPX-relevant headline (Trump/Fed/geopolitics/regime, quoted verbatim inside {{}}), an imminent macro event before next read with {{time}}, a big {{VIX}} move, or a mega-cap {{ticker move}} dragging the index. Omit if nothing material.",
  "watch": [],
  "changed": []
}

Hard rules:
- bias (bullish/bearish/neutral) drives the badge and must be justified by confluence grade, flow_0dte skew, OR price vs VWAP+γflip — not by feel. Map the headline verb: LONG=bullish, SHORT=bearish, FADE/CHOP/NO-EDGE=neutral.
- Null/empty section -> skip. strike_stacks empty -> no stack language anywhere.
- watch and changed MUST be empty arrays — everything lives in headline + body (the SETUP + FLIPS IT lines replace the old watch list).
- Every number and every verbatim headline wrapped in {{...}}; desk verbs/labels stay outside. No prose paragraphs.
- Total output is short: 1 headline + 4 always-on body lines + up to 3 conditional lines. If in doubt, cut it.`;

  const raw = await anthropicText(prompt, 1300, undefined, {
    model: COMMENTARY_MODEL,
    output_config: {
      format: {
        type: "json_schema",
        schema: COMMENTARY_OUTPUT_SCHEMA,
      },
    },
    // 3000 structured tokens brushes past the client's 20s default → "Request timed
    // out" → Live Desk AI stuck. Give it 45s and a single retry (3-min cached, so the
    // extra latency is invisible to users — it just needs to complete once).
    timeoutMs: 45_000,
    maxRetries: 1,
  });
  if (!raw) return null;

  const parsed = parseCommentaryJson(raw);
  // changed[] and watch[] stay empty by design — the Δ SINCE LAST line lives in body,
  // and SETUP + FLIPS IT replace the old watch list. Keeps the rail crisp.
  if (parsed) return parsed;

  return {
    headline: "Desk update",
    bias: "neutral",
    body: raw.slice(0, 800),
    watch: [],
    changed: delta,
    as_of: new Date().toISOString(),
  };
}
