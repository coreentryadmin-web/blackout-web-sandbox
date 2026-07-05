import { anthropicText, COMMENTARY_MODEL } from "./anthropic";
import type { SpxDeskPayload } from "./spx-desk";
import { computeSpxConfluence } from "@/lib/spx-signals";
import {
  formatFlowStrikeStackLine,
  flowStackSignature,
} from "@/lib/largo/flow-strike-stacks";
import { fmtPremium } from "@/lib/fmt-money";
import {
  checkNumbersGrounded,
  collectKnownNumbers,
  type GroundingCheckResult,
} from "@/lib/grounding-guard";
import { dbConfigured, insertAlertAuditLog } from "@/lib/db";

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
    lines.push(`GEX anchor moved: ${fmt(prev.gex_king)} → ${fmt(desk.gex_king)}`);
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
      `New tape: ${latest.kind === "flow" ? "flow" : "dark pool"} ${latest.label} · ${fmtPremium(latest.premium)}`
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

    data_freshness: {
      feed_stalled: desk.feed_stalled ?? false,
      gex_stale: desk.gex_stale ?? false,
      gex_age_ms: desk.gex_age_ms ?? null,
    },

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
        net_gex: fmtPremium(w.net_gex),
        distance_from_price: price != null ? w.strike - price : null,
      })),
      resistance_nodes: gexResistance.map((w) => ({
        strike: w.strike,
        net_gex: fmtPremium(w.net_gex),
        distance_from_price: price != null ? w.strike - price : null,
      })),
      all_walls: gexWalls.map((w) => ({ ...w, net_gex: fmtPremium(w.net_gex) })),
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

/** Best-effort audit-log write for a Live Desk AI generation that failed the post-generation
 *  grounding check — mirrors spx-play-claude.ts's logPlayVerdict(), the sibling AI-narration
 *  surface that already writes every verdict (pass or fail) to alert_audit_log. Before this,
 *  a hallucinated read here was discarded with only an ephemeral console.warn — no durable
 *  trace existed to answer "how often does this happen." Fire-and-forget: an audit-log
 *  failure must never block or alter the (already-decided) discard-and-502 behavior. */
function logUngroundedCommentary(
  desk: SpxDeskPayload,
  ctx: Record<string, unknown>,
  parsed: SpxCommentaryResult,
  grounding: GroundingCheckResult
): void {
  if (!dbConfigured()) return;
  const confluence = ctx.confluence as { score?: number; grade?: string } | null | undefined;
  insertAlertAuditLog({
    alert_type: "spx_commentary_ungrounded",
    source_table: "spx_commentary",
    source_key: { price: desk.price, as_of: desk.as_of },
    ticker: "SPX",
    direction: parsed.bias,
    confidence_score: confluence?.score ?? null,
    confidence_label: confluence?.grade ?? null,
    trigger_reason: `Ungrounded value ${grounding.ungroundedValue} in generated commentary`,
    decision_trace: [
      { check: "numbers_grounded", passed: false, value: grounding.ungroundedValue },
    ],
    // Enough of the desk snapshot to reconstruct what the model was looking at without
    // duplicating the whole (deeply-nested) ctx object into every rejected row.
    input_snapshot: {
      price: desk.price,
      vwap: desk.vwap,
      gamma_flip: desk.gamma_flip,
      gex_king: desk.gex_king,
      max_pain: desk.max_pain,
    },
    // The raw generated text before discard — never served, so this is the only place it's
    // preserved at all.
    final_output: { headline: parsed.headline, body: parsed.body, bias: parsed.bias },
  }).catch((err) => {
    console.error("[spx-commentary] audit-log write failed (non-blocking):", err);
  });
}

export async function generateSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null,
  cross?: {
    openPlay?: import("@/lib/spx-play-store").OpenPlayRow | null;
    lotto?: import("@/lib/spx-lotto-store").LottoRecord | null;
    powerHour?: import("@/lib/spx-power-hour-store").PowerHourRecord | null;
    outcomes?: import("@/lib/spx-play-outcomes").PlayOutcomeStats | null;
  }
): Promise<SpxCommentaryResult | null> {
  const delta = computeDelta(desk, previous);
  const ctx = deskContext(desk);
  const ctxRec = ctx as Record<string, unknown>;

  // Cross-tool access: surface the platform's OWN engine state (open play + lotto +
  // power-hour) and recent track record so the desk AI aligns with the rest of the
  // platform (never contradicts a live position) and can calibrate conviction. These are
  // CONTEXT only — the prompt still renders crisply, surfacing them only when material.
  const op = cross?.openPlay;
  if (op && op.status === "open") {
    ctxRec.live_spx_play = {
      direction: op.direction,
      entry: op.entry_price,
      stop: op.stop,
      target: op.target,
      grade: op.grade,
      mfe_pts: op.mfe_pts,
      trim_done: op.trim_done,
      opened_at: op.opened_at,
    };
  }
  const lp = cross?.lotto;
  if (lp && lp.phase !== "NONE" && lp.phase !== "INVALID") {
    ctxRec.lotto_play = {
      phase: lp.phase,
      direction: lp.direction,
      strike: lp.strike,
      contract: lp.contract_label,
      entry: lp.entry_price,
      target: lp.target_price,
    };
  }
  const ph = cross?.powerHour;
  if (ph && ph.phase !== "NONE") {
    ctxRec.power_hour_play = {
      phase: ph.phase,
      direction: ph.direction,
      strike: ph.strike,
      entry: ph.entry_price,
      target: ph.target_price,
      stop: ph.stop_price,
    };
  }
  const oc = cross?.outcomes;
  if (oc && oc.total_closed > 0) {
    ctxRec.recent_play_outcomes = {
      win_rate: oc.overall.win_rate,
      wins: oc.overall.wins,
      losses: oc.overall.losses,
      total_closed: oc.total_closed,
      days_of_data: oc.days_of_data,
    };
  }

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

  const prompt = `You are the head trader AND head educator on BlackOut SPX-Sniper — a real-money 0DTE SPX desk. MOST READERS ARE NEW TO OPTIONS. Write the LIVE DESK AI read so a beginner finishes it knowing WHAT is happening, WHY (the dealer mechanic behind it), HOW to trade it, and HOW NOT to blow up — while a 25yr pro still reads the whole thing in ~20 seconds. Teaching, not a textbook. No hype, no disclaimers ("not advice"), no hedging ("could/might/monitor closely").

SESSION PHASE: ${sessionPhase} (ET). Tailor the call to the phase:
- opening-range: vol highest, don't chase, wait for the range break + confirmation
- mid-morning: best setups — VWAP reclaim/reject + GEX-wall reaction
- midday-grind: low vol, theta bleeds — lighter size or no trade
- afternoon/power-hour: momentum + squeeze risk at the gamma flip
- final-30: no new 0DTE unless already in

ACCURACY: every number/strike/premium comes from the JSON below or WHAT CHANGED. Never invent. Skip anything null/empty. SPX prices to .00; premiums like ${fmtPremium(1_500_000)}.

DATA AVAILABLE (use only what is populated): data_freshness (feed_stalled, gex_stale, gex_age_ms); confluence (grade A+/A/B/C/D, action, factors); price_action (price, change_pct, above_vwap, vwap, hod/lod, pdh/pdl); moving_averages; support_resistance_levels (nearest_support/resistance); dealer_gex (gex_net, gamma_flip, above_gamma_flip, gex_king, max_pain, gamma_regime); gex_walls_0dte (strikes + net_gex); flow_0dte (call/put/net premium); spx_option_flows (sweeps/blocks); live_tape; strike_stacks; dark_pool (bias, pcr, prints); market_tide; nope; volatility (VIX, IV rank, term); internals (TICK/TRIN/ADD); market_breadth; macro_calendar_today; news_headlines; mega_cap_stocks; net_premium_velocity.

CURRENT DESK SNAPSHOT (JSON):
${JSON.stringify(ctx)}

WHAT CHANGED SINCE LAST DESK READ:
${delta.map((d) => `- ${d}`).join("\n")}

TEACH INSIDE THE LINE, NEVER AROUND IT — every line states the fact AND teaches the mechanic in the SAME breath; the decode rides along as a 2-3 word clause, it never gets its own sentence or line:
1. DECODE jargon inline (2-3 words, in parens) the FIRST time a term appears per read, then use it bare: γflip (dealer trend line), VWAP (session avg price), put-skew (more put than call bets), theta (time-decay), pin (price magnet), GEX wall (dealer defense), neg-γ (dealers amplify moves), pos-γ (dealers fade/pin), debit spread (capped-risk pair), IV rank (how pricey options are), max pain (strike most options expire worthless). Don't re-decode the same term twice in one read.
2. ANSWER THE SILENT "SO WHAT?" — never a number without its consequence in 3-5 words. NOT "VIX {{14}}" but "VIX {{14}} (calm — small moves)". NOT "R {{6025}}" but "R {{6025}} (call wall — caps upside)".
3. PLAIN VERBS over slang: "dealers buy dips" not "positive dealer gamma hedging flow".
4. The gloss is a CLAUSE, not a sentence; if it won't fit, cut a lower-signal word — never add a line.
5. NUMBERS ALWAYS in {{...}} (incl. glossed thresholds like IV rank, VIX); teaching words/labels stay OUTSIDE braces; verbatim news headlines go INSIDE {{...}}.
DON'T: glossary lines, disclaimers, lecturing ("the gamma flip is a level where..."), or explaining a term not used this read. Teach by LABELING the mechanic, not by lecturing about it.

Respond with ONLY valid JSON (no markdown fences, no trailing commas):
{
  "headline": "READ — the thesis in one breath, <=24 words. Bias verb (LONG / SHORT / FADE / CHOP / NO-EDGE) from confluence.action, then {{grade}} glossed once '(several signals agree)', then {{price}} {{change_pct}} anchored to {{signed pts vs VWAP}} and {{gamma_flip}}, closed with the regime word tagged once — 'neg-γ (trend fuel)' or 'pos-γ (dips bought)'. Grade C/D => NO-EDGE + why in 3 words. This IS the headline — numbers in {{}}.",
  "bias": "bullish" | "bearish" | "neutral",
  "body": "Newline-separated labeled lines, ONE line per label, tight (~one breath, <=32 words), numbers/news in {{}}, each line starting with its UPPERCASE label + TWO spaces. ORDER EXACTLY: WHY, then 'Δ SINCE LAST' (only if something moved), LEVELS, SETUP, RISK, NEXT 5M, FLIPS IT, then FLOW and NEWS (only if real signal). ALWAYS include WHY, LEVELS, SETUP, RISK, NEXT 5M, FLIPS IT.\\nWHY  the dealer-hedging mechanic CAUSING the bias (the lesson that repeats every session). Name the 2 strongest confluence.factors + translate the gamma mechanic, tied to ONE level already shown. neg-γ: 'below γflip dealers sell dips (fuel), so drops feed themselves toward {{level}}.' pos-γ: 'above γflip dealers buy dips (cushion), pullbacks bought back to {{pin}}.' Explain the FORCE, never restate the SETUP trigger. e.g. 'WHY  Below VWAP (session avg) + put-skew {{1.4}} (more put bets) agree; below γflip dealers sell dips, so drops feed themselves toward {{6004}}.'\\nΔ SINCE LAST  max 2 items that MOVED vs last read, lead with any sign flip carrying its meaning: 'GEX {{pos->neg}} (cushion -> fuel)', 'lost VWAP {{6017->6011}}', 'grade {{C+->B+}} (sellers took control)'. Omit entirely if nothing material moved — no filler.\\nLEVELS  nearest resistance above + support below with SIGNED {{pt distance}}; tag each level's role in 2-3 words the first time — 'call wall (caps upside)', 'γwall (dealer support)', 'pin (price magnet)', 'PDH (prior-day high)'. Mark the GEX-wall level ({{strike}} {{net_gex}}) — net_gex is ALREADY $-formatted (e.g. -$3.6M); quote it VERBATIM, never change its unit or invent a magnitude; add {{pin}}=gex_king/max_pain only if between spot and a level. e.g. 'LEVELS  R {{6018}} (+{{7}}, γflip) · {{6031}} (+{{20}}, call wall — caps upside) · S {{6004}} (-{{7}}, γwall {{-$2.1M}} — dealer support) · pin {{6005}}'\\nSETUP  the trade in plain parts, gated by confluence.grade. Grade >=A: Direction / Trigger ({{level}} + the confirm as cause+effect, e.g. 'reject {{6017}} = sellers still own it') / Stop {{level}} / Target {{level}} / Edge (top 2 confluence.factors). Grade B: conditional 'If {{X}} then …'. Grade C/D or midday-grind: 'No clean setup — signals split, forcing it bleeds accounts; flat until {{condition}}.' Put NO sizing/IV here — that lives in RISK.\\nRISK  the blow-up guardrail, SIZE then STRUCTURE. SIZE by grade: A/A+ up to {{1}} unit, B {{half}}, C/D {{0}} (don't force it); cut more if VIX>{{20}} or phase is opening-range/final-30. STRUCTURE by IV rank: {{>50}} (options pricey) -> debit spread (capped-risk pair) so theta/IV-crush can't gut you; {{<30}} (cheap) -> a single long call/put is fine; ALWAYS 'max loss = the {{$X}} you pay, nothing more.' Add a SIT-OUT clause ONLY when hostile (grade C/D, midday chop, final-30, VIX spike with no clean level, or a macro event within ~{{15m}}): one reason + the single thing that re-opens it. e.g. 'RISK  Size {{half}} — B not A; IV rank {{62}} (options pricey) -> debit put spread, max loss = the {{$1.40}} you pay; exit AT the FLIPS level, never add to a loser — theta (time-decay) accelerates into close.'\\nNEXT 5M  behavior in plain terms FIRST, then the path, for the next ~5 min from gamma_regime + net_premium_velocity + internals + tide. pos-γ near a wall: 'expect a pin (price stuck) / fade toward {{gex_king|max_pain}}'. neg-γ below flip: 'expect expansion (fast trend) into the {{level}} air-pocket (no-support gap) if {{level}} cracks; weak TICK confirms sellers.'\\nFLIPS IT  the ONE reading that voids the thesis = YOUR STOP (say the word 'stop'). EXACTLY one, with a {{number}} + the consequence. e.g. 'FLIPS IT  Reclaim {{6017}} (VWAP+γflip back) = thesis dead, this is your stop — go flat.'\\nFLOW  single strongest of: 0DTE skew {{%}} net {{$}}, a {{sweep}} ({{strike}} {{$}}), a building stack (summary verbatim), hard dark-pool {{bias/pcr}}, or {{NOPE}} extreme — add one clause on why it matters to DIRECTION ('confirms the short, not a fade'). Omit if routine.\\nNEWS  one crisp MATERIAL catalyst only: SPX-relevant headline (Trump/Fed/geopolitics/regime, quoted verbatim inside {{}}), an imminent macro event before next read with {{time}} + why it matters ('vol can spike, be flat before'), a big {{VIX}} move, or a mega-cap {{ticker move}} dragging the index. Omit if nothing material.",
  "watch": [],
  "changed": []
}

Hard rules:
- bias (bullish/bearish/neutral) drives the badge; justify by confluence grade, flow skew, OR price vs VWAP+γflip. Map headline verb: LONG=bullish, SHORT=bearish, FADE/CHOP/NO-EDGE=neutral.
- Null/empty section -> skip. strike_stacks empty -> no stack language.
- watch and changed MUST be empty arrays — everything lives in headline + body.
- Every number + every verbatim headline wrapped in {{...}}; teaching words/labels stay outside. No prose paragraphs, one line per label.
- live_spx_play / lotto_play / power_hour_play (if present) are the platform's OWN live positions — your READ + SETUP MUST ALIGN with them, or explicitly flag the conflict (e.g. "engine still long X — countertrend"). NEVER hand the trader the opposite side of an open desk position without calling out that it contradicts the live engine.
- recent_play_outcomes (if present) is the desk's own realized win-rate — you MAY use it to calibrate conviction ("desk's been hot/cold lately"), but never fabricate numbers or over-promise.
- When data_freshness.gex_stale or data_freshness.feed_stalled is true, dealer GEX levels are STALE or the index feed is FROZEN — say so plainly in RISK (do not cite walls/flip as live); prefer NO-EDGE or lighter size until structure refreshes.
- ALWAYS show WHY, LEVELS, SETUP, RISK, NEXT 5M, FLIPS IT. Δ/FLOW/NEWS only when they carry signal. Still ~a 20-second read.`;

  const raw = await anthropicText(prompt, 1550, undefined, {
    model: COMMENTARY_MODEL,
    // temperature:0 — output_config json_schema extraction; deterministic output avoids
    // nondeterminism + wasted retries on schema-constrained output (was silently default 0.3).
    temperature: 0,
    output_config: {
      format: {
        type: "json_schema",
        schema: COMMENTARY_OUTPUT_SCHEMA,
      },
    },
    // A large structured generation can brush past the client's 20s default → "Request
    // timed out" → Live Desk AI stuck. Give it 45s and a single retry (server-cached, so
    // the extra latency is invisible to users — it just needs to complete once,
    // then every session reads the server cache for the rest of the 5-min window).
    timeoutMs: 45_000,
    maxRetries: 1,
  });
  if (!raw) return null;

  const parsed = parseCommentaryJson(raw);
  // changed[] and watch[] stay empty by design — the Δ SINCE LAST line lives in body,
  // and SETUP + FLIPS IT replace the old watch list. Keeps the rail crisp.
  if (parsed) {
    // FABRICATION GUARD: this flagship "Live Desk AI" read is cluster-cached and served to
    // every connected user with no prior check that its cited numbers are real, unlike the
    // sibling gex-heatmap/explain route. Ground the headline + body against every number
    // actually present in the SAME ctx JSON the prompt was built from (walked recursively —
    // ctx is too large/nested to hand-enumerate every legitimate field without risking a
    // missed one and a false-positive block). Returning null here (not a fallback narrative)
    // means the route's serverCache treats this exactly like a generation failure: nothing is
    // cached, the caller gets a retryable 502.
    const known = collectKnownNumbers(ctx);
    const grounding = checkNumbersGrounded(`${parsed.headline}\n${parsed.body}`, known);
    if (!grounding.grounded) {
      console.warn(
        `[spx-commentary] ungrounded value ${grounding.ungroundedValue} in generated commentary — discarding (never cached).`
      );
      // Durable trace of the discard (see logUngroundedCommentary's doc comment) — this used
      // to be silently thrown away with nothing but the console.warn above, unlike the
      // sibling spx-play-claude.ts, which has logged every verdict (pass or fail) since
      // task #78. Fire-and-forget: never awaited, never blocks this return.
      logUngroundedCommentary(desk, ctx, parsed, grounding);
      return null;
    }
    return parsed;
  }

  // JSON parse failure — same contract as ungrounded output: never cache, never serve raw
  // model text (audit C2: raw fallback bypassed the fabrication guard).
  console.warn("[spx-commentary] JSON parse failed — discarding (never cached).");
  return null;
}
