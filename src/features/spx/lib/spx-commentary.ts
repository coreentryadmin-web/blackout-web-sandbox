import type { SpxDeskPayload } from "./spx-desk";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import { composeSpxDeskBrief } from "@/lib/bie/spx-desk-brief";
import { knownIntelNumbers } from "@/lib/bie/spx-desk-intel";
import type { SpxBriefIntelPrefetch, SpxBriefIntelPrev } from "@/lib/bie/load-spx-brief-intel";
import { heatmapToIntelSlice } from "@/features/spx/lib/spx-odte-intel-feed";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { IntelHeatmapSlice } from "@/features/spx/lib/spx-odte-intel-feed";
import { spxSessionPhase } from "@/features/spx/lib/spx-session-phase";
import { bieEmbeddingsConfigured } from "@/lib/bie/embeddings";
import { findSimilarPrecedents } from "@/lib/bie/precedent-search";
import {
  buildPrecedentSearchQuery,
  MIN_TOTAL_PRECEDENTS,
  parsePrecedentOutcome,
  PRECEDENT_SEARCH_K,
} from "@/features/spx/lib/spx-signals-shadow-precedents";
import {
  formatFlowStrikeStackLine,
  flowStackSignature,
} from "@/lib/largo/flow-strike-stacks";
import { fmtPremium } from "@/lib/fmt-money";
import {
  augmentKnownCommentaryNumbers,
  checkCommentaryGrounded,
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

/** SPX strike / index level — excludes flow premiums and other large dollar magnitudes. */
function isCommentaryStrikeLevel(n: number): boolean {
  return n >= 1000 && n <= 20_000;
}

/** Every number the Live Desk AI prompt can legitimately cite — price levels, metrics,
 *  formatted-string magnitudes, and common derived forms (rounded, pt distance, pct as whole). */
export function knownCommentaryNumbers(
  desk: SpxDeskPayload,
  ctx: Record<string, unknown>
): number[] {
  const raw = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    raw.add(Number(n));
  };

  add(desk.price);
  add(desk.vwap);
  add(desk.hod);
  add(desk.lod);
  add(desk.pdh);
  add(desk.pdl);
  add(desk.gamma_flip);
  add(desk.gex_king);
  add(desk.max_pain);
  add(desk.ema20);
  add(desk.ema50);
  add(desk.ema200);
  add(desk.sma50);
  add(desk.sma200);
  add(desk.vix);
  add(desk.uw_iv_rank);
  add(desk.vix_change_pct);
  add(desk.spx_change_pct);
  add(desk.tick);
  add(desk.trin);
  add(desk.add);
  add(desk.nope);
  add(desk.nope_net_delta);
  add(desk.gex_net);
  add(desk.flow_0dte_call_premium);
  add(desk.flow_0dte_put_premium);
  add(desk.flow_0dte_net);
  add(desk.tide_call_premium);
  add(desk.tide_put_premium);
  add(desk.tide_net);

  for (const l of desk.levels ?? []) add(l.value);
  for (const w of desk.gex_walls ?? []) add(w.strike);
  for (const s of desk.strike_stacks ?? []) {
    add(s.strike);
    add(s.total_premium);
  }
  for (const f of desk.spx_flows ?? []) {
    add(f.strike);
    add(f.premium);
  }

  const confluence = ctx.confluence as { score?: number; levels?: { entry?: number; stop?: number; target?: number } } | undefined;
  add(confluence?.score);
  add(confluence?.levels?.entry);
  add(confluence?.levels?.stop);
  add(confluence?.levels?.target);

  const breadth = ctx.market_breadth as Record<string, number | null | undefined> | undefined;
  if (breadth) {
    for (const v of Object.values(breadth)) add(typeof v === "number" ? v : null);
  }

  for (const n of collectKnownNumbers(ctx)) add(n);

  const price = desk.price;
  if (price != null && Number.isFinite(price)) {
    // Snapshot strike levels only — never iterate a Set while mutating it, and never
    // treat flow premiums (millions) as "levels" for distance derivation (Set overflow).
    for (const lvl of Array.from(raw).filter(isCommentaryStrikeLevel)) {
      const dist = lvl - price;
      add(dist);
      add(Math.abs(dist));
      add(Math.round(dist));
      add(Math.round(Math.abs(dist)));
      add(parseFloat(Math.abs(dist).toFixed(1)));
    }
  }

  return augmentKnownCommentaryNumbers(Array.from(raw));
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

export type SpxCommentaryIntelCache = {
  positioning: GexPositioning | null;
  heatmapSlice: IntelHeatmapSlice | null;
  nighthawk: import("@/features/nighthawk/lib/types").NightHawkEdition | null;
};

export async function generateSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null,
  cross?: {
    openPlay?: import("@/features/spx/lib/spx-play-store").OpenPlayRow | null;
    lotto?: import("@/features/spx/lib/spx-lotto-store").LottoRecord | null;
    powerHour?: import("@/features/spx/lib/spx-power-hour-store").PowerHourRecord | null;
    outcomes?: import("@/features/spx/lib/spx-play-outcomes").PlayOutcomeStats | null;
    /** Prior 5-min window intel for matrix + material-edge diffs. */
    intelPrev?: SpxBriefIntelPrev | null;
    nighthawk?: import("@/features/nighthawk/lib/types").NightHawkEdition | null;
    prevNighthawk?: import("@/features/nighthawk/lib/types").NightHawkEdition | null;
    /** Pre-fetched matrix rows — skips duplicate provider calls on commentary cold path. */
    intelPrefetch?: SpxBriefIntelPrefetch;
    playbookShadow?: {
      mode?: "shadow" | "live";
      primary_playbook_id: string | null;
      primary_name: string | null;
      primary_direction?: "long" | "short" | "neutral" | null;
      fired_count: number;
    } | null;
  }
): Promise<{ commentary: SpxCommentaryResult; intelCache: SpxCommentaryIntelCache } | null> {
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
    console.warn("[spx-commentary] skipping BIE brief:", dataCheck.reason);
    return null;
  }

  const confluence = computeSpxConfluence(desk);
  if (!confluence) {
    console.warn("[spx-commentary] skipping BIE brief: no confluence");
    return null;
  }

  const sessionPhase = spxSessionPhase(desk.as_of);

  const intelPrev: SpxBriefIntelPrev = {
    desk: (previous as SpxDeskPayload | null) ?? cross?.intelPrev?.desk ?? null,
    positioning: cross?.intelPrev?.positioning ?? null,
    heatmapSlice: cross?.intelPrev?.heatmapSlice ?? null,
    prevNighthawk: cross?.prevNighthawk ?? cross?.intelPrev?.prevNighthawk ?? null,
    nighthawk: cross?.nighthawk ?? cross?.intelPrev?.nighthawk ?? null,
  };

  const { loadSpxBriefIntel } = await import("../../../lib/bie/load-spx-brief-intel");

  const precedentPromise = (async (): Promise<string | null> => {
    if (!bieEmbeddingsConfigured() || !dbConfigured()) return null;
    const budgetMs = 1_500;
    try {
      const query = buildPrecedentSearchQuery(
        desk,
        confluence.direction,
        confluence.grade,
        confluence.score
      );
      const hits = await Promise.race([
        findSimilarPrecedents(query, PRECEDENT_SEARCH_K),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("precedent_timeout")), budgetMs)
        ),
      ]);
      if (hits.length < MIN_TOTAL_PRECEDENTS) return null;
      const targets = hits.filter((h) => parsePrecedentOutcome(h.chunk) === "target").length;
      const stops = hits.filter((h) => parsePrecedentOutcome(h.chunk) === "stop").length;
      const targetRate = Math.round((targets / hits.length) * 100);
      return `${hits.length} similar setups — {{${targetRate}}}% hit target ({{${targets}}}T/{{${stops}}}S, BIE corpus)`;
    } catch {
      return null;
    }
  })();

  const [intel, precedentDetail] = await Promise.all([
    loadSpxBriefIntel(
      desk,
      intelPrev,
      cross?.nighthawk ?? cross?.intelPrev?.nighthawk ?? null,
      cross?.prevNighthawk ?? cross?.intelPrev?.prevNighthawk ?? null,
      cross?.intelPrefetch
    ),
    precedentPromise,
  ]);

  const parsed = composeSpxDeskBrief(desk, confluence, delta, sessionPhase, {
    openPlay: op && op.status === "open" ? op : null,
    lotto: lp && lp.phase !== "NONE" && lp.phase !== "INVALID" ? lp : null,
    powerHour: ph && ph.phase !== "NONE" ? ph : null,
    outcomes: oc && oc.total_closed > 0 ? oc : null,
    precedentDetail,
    intel,
    playbookShadow: cross?.playbookShadow ?? null,
  });

  const known = [
    ...knownCommentaryNumbers(desk, ctxRec),
    ...knownIntelNumbers(intel),
  ];
  const grounding = checkCommentaryGrounded(`${parsed.headline}\n${parsed.body}`, known);
  if (!grounding.grounded) {
    console.warn(
      `[spx-commentary] ungrounded value ${grounding.ungroundedValue} in BIE desk brief — discarding (never cached).`
    );
    logUngroundedCommentary(desk, ctx, parsed, grounding);
    return null;
  }
  return {
    commentary: parsed,
    intelCache: {
      positioning: intel.positioning,
      heatmapSlice: heatmapToIntelSlice(intel.heatmap),
      nighthawk: intel.nighthawk ?? null,
    },
  };
}
