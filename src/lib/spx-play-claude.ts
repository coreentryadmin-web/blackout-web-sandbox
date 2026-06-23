import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import type { SpxConfluence } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayGateResult } from "@/lib/spx-play-gates";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import { todayEt } from "@/lib/et-date";
import {
  gradeRank,
  playClaudeCachePriceStepPts,
  playClaudeCacheSec,
  playClaudeDailyMaxCalls,
  playClaudeGateEnabled,
} from "@/lib/spx-play-config";
import { dbConfigured, getMeta, setMeta } from "@/lib/db";

export type ClaudePlayVerdict = {
  verdict: "APPROVE_BUY" | "VETO";
  direction: "long" | "short" | null;
  headline: string;
  thesis: string;
  approved: boolean;
  source: "claude" | "mechanical" | "cache";
  /** true when Claude's direction differs from confluence.direction. */
  direction_mismatch?: boolean;
};

const CACHE_KEY = "spx_claude_play_cache";
const BUDGET_KEY = "spx_claude_play_daily_budget";
const memoryCache = new Map<string, { at: number; verdict: ClaudePlayVerdict }>();

type ClaudeDailyBudget = { date: string; calls: number };
let memoryBudget: ClaudeDailyBudget | null = null;

function cacheKey(desk: SpxDeskPayload, c: SpxConfluence): string {
  const step = Math.max(0.5, playClaudeCachePriceStepPts());
  const bucketedPrice = Math.round(desk.price / step) * step;
  return `${c.direction}|${c.grade}|${Math.round(c.score)}|${bucketedPrice.toFixed(1)}`;
}

async function readDailyBudget(): Promise<ClaudeDailyBudget> {
  const today = todayEt();
  if (memoryBudget?.date === today) return memoryBudget;

  if (dbConfigured()) {
    const raw = await getMeta(BUDGET_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ClaudeDailyBudget;
        if (parsed.date === today) {
          memoryBudget = { date: today, calls: parsed.calls ?? 0 };
          return memoryBudget;
        }
      } catch {
        /* fresh day */
      }
    }
  }

  memoryBudget = { date: today, calls: 0 };
  return memoryBudget;
}

async function incrementDailyBudget(): Promise<void> {
  const budget = await readDailyBudget();
  const next = { date: budget.date, calls: budget.calls + 1 };
  memoryBudget = next;
  if (dbConfigured()) {
    await setMeta(BUDGET_KEY, JSON.stringify(next));
  }
}

async function claudeBudgetExceeded(): Promise<boolean> {
  const budget = await readDailyBudget();
  return budget.calls >= playClaudeDailyMaxCalls();
}

async function readCache(key: string): Promise<ClaudePlayVerdict | null> {
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.at <= playClaudeCacheSec() * 1000) {
    return { ...mem.verdict, source: "cache" };
  }
  if (!dbConfigured()) return null;
  const raw = await getMeta(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as
      | { version?: number; slots?: Record<string, { at: number; verdict: ClaudePlayVerdict }> }
      | { key: string; at: number; verdict: ClaudePlayVerdict };
    const slot =
      "slots" in parsed && parsed.slots?.[key]
        ? parsed.slots[key]
        : "key" in parsed && parsed.key === key
          ? { at: parsed.at, verdict: parsed.verdict }
          : null;
    if (!slot || Date.now() - slot.at > playClaudeCacheSec() * 1000) return null;
    memoryCache.set(key, slot);
    return { ...slot.verdict, source: "cache" };
  } catch {
    return null;
  }
}

async function writeCache(key: string, verdict: ClaudePlayVerdict): Promise<void> {
  const slot = { at: Date.now(), verdict };
  memoryCache.set(key, slot);
  if (!dbConfigured()) return;

  const raw = await getMeta(CACHE_KEY);
  const slots: Record<string, { at: number; verdict: ClaudePlayVerdict }> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as
        | { version?: number; slots?: Record<string, { at: number; verdict: ClaudePlayVerdict }> }
        | { key: string; at: number; verdict: ClaudePlayVerdict };
      if ("slots" in parsed && parsed.slots) Object.assign(slots, parsed.slots);
      else if ("key" in parsed) slots[parsed.key] = { at: parsed.at, verdict: parsed.verdict };
    } catch {
      /* fresh store */
    }
  }
  slots[key] = slot;
  const keys = Object.keys(slots);
  if (keys.length > 24) {
    keys.sort((a, b) => slots[a].at - slots[b].at);
    for (const staleKey of keys.slice(0, keys.length - 24)) delete slots[staleKey];
  }
  await setMeta(CACHE_KEY, JSON.stringify({ version: 2, slots }));
}

function mechanicalVerdict(
  c: SpxConfluence,
  gates: PlayGateResult,
  confirmations: PlayConfirmationResult,
  note?: string
): ClaudePlayVerdict {
  const strict =
    gates.passed &&
    c.direction != null &&
    gradeRank(c.grade) >= 2 &&
    confirmations.passed;
  const baseThesis = strict
    ? `${confirmations.passed_count}/${confirmations.total} confirmations · score ${c.score}.`
    : gates.blocks[0] ?? "Waiting for A/A+ confluence with full confirmations.";
  return {
    verdict: strict ? "APPROVE_BUY" : "VETO",
    direction: c.direction,
    headline: strict
      ? `${c.grade} ${c.direction === "long" ? "CALL" : "PUT"} — all checks passed`
      : "Quality bar not met — stay flat",
    thesis: note ? `${baseThesis} ${note}` : baseThesis,
    approved: strict,
    source: "mechanical",
  };
}

export async function evaluateClaudePlayApproval(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  gates: PlayGateResult,
  confirmations: PlayConfirmationResult,
  technicals: PlayTechnicals,
  options?: { forceClaude?: boolean }
): Promise<ClaudePlayVerdict> {
  if (!gates.passed || !confluence.direction) {
    return mechanicalVerdict(confluence, gates, confirmations);
  }

  const key = cacheKey(desk, confluence);
  const cached = await readCache(key);
  if (cached) return cached;

  const forceClaude = options?.forceClaude === true;

  if (!anthropicConfigured()) {
    if (forceClaude || playClaudeGateEnabled()) {
      return {
        verdict: "VETO",
        direction: confluence.direction,
        headline: "Claude gate blocked — API not configured",
        thesis: "SPX_CLAUDE_GATE requires Anthropic — entry blocked (fail-closed).",
        approved: false,
        source: "mechanical",
      };
    }
    const mech = mechanicalVerdict(confluence, gates, confirmations);
    await writeCache(key, mech);
    return mech;
  }

  if (!playClaudeGateEnabled() && !forceClaude) {
    const mech = mechanicalVerdict(confluence, gates, confirmations);
    await writeCache(key, mech);
    return mech;
  }

  if (await claudeBudgetExceeded()) {
    if (playClaudeGateEnabled() || forceClaude) {
      return {
        verdict: "VETO",
        direction: confluence.direction,
        headline: "Claude daily cap — entry blocked",
        thesis: `Daily Claude budget (${playClaudeDailyMaxCalls()}) reached. Fail-closed while gate is enabled.`,
        approved: false,
        source: "mechanical",
      };
    }
    const mech = mechanicalVerdict(
      confluence,
      gates,
      confirmations,
      `(Claude daily cap ${playClaudeDailyMaxCalls()} reached — mechanical fallback)`
    );
    await writeCache(key, mech);
    return mech;
  }

  const supports = (desk.levels ?? []).filter((l) => l.kind === "support").slice(0, 4);
  const resistances = (desk.levels ?? []).filter((l) => l.kind === "resistance").slice(0, 4);

  const prompt = `You are the SPX 0DTE quality arbiter for BlackOut Ops. We want FEW, HIGH-QUALITY plays — veto aggressively.

APPROVE_BUY only if ALL are true:
- Grade A or A+ confluence
- 3m AND 5m timeframe align with direction
- Clear support/resistance or breakout context
- Flow, tide, and news do NOT oppose the trade
- Risk/reward to stop and target is sensible for 0DTE

Default to VETO when anything is mixed.

PRICE & STRUCTURE:
${JSON.stringify({
  price: desk.price,
  vwap: desk.vwap,
  above_vwap: desk.above_vwap,
  hod: desk.hod,
  lod: desk.lod,
  pdh: desk.pdh,
  pdl: desk.pdl,
  regime: desk.regime,
  nearest_support: supports,
  nearest_resistance: resistances,
})}

DEALER / GEX:
${JSON.stringify({
  gamma_flip: desk.gamma_flip,
  gamma_regime: desk.gamma_regime,
  gex_king: desk.gex_king,
  max_pain: desk.max_pain,
  gex_walls: desk.gex_walls?.slice(0, 8),
})}

FLOW & TAPE:
${JSON.stringify({
  flow_0dte_net: desk.flow_0dte_net,
  tide_bias: desk.tide_bias,
  dark_pool: desk.dark_pool?.bias,
  spx_flows: desk.spx_flows?.slice(0, 6),
  live_tape: desk.unified_tape?.slice(0, 6),
  nope: desk.nope,
})}

MULTI-TIMEFRAME (Polygon 1m bars):
${JSON.stringify({
  m3_close: technicals.m3_close,
  m5_close: technicals.m5_close,
  m5_ema20: technicals.m5_ema20,
  m5_rsi: technicals.m5_rsi,
  m5_trend: technicals.m5_trend,
  breakout: technicals.breakout,
  mtf: technicals.mtf,
})}

NEWS & MACRO:
${JSON.stringify({
  headlines: desk.news_headlines?.slice(0, 5),
  macro: desk.macro_events?.slice(0, 3),
  vix: desk.vix,
  iv_rank: desk.uw_iv_rank,
})}

CONFLUENCE:
${JSON.stringify({
  score: confluence.score,
  grade: confluence.grade,
  direction: confluence.direction,
  conflicts: confluence.conflicts,
  agreeing: confluence.agreeing,
  factors: confluence.factors.slice(0, 12),
  levels: confluence.levels,
})}

CONFIRMATION CHECKLIST (${confirmations.passed_count}/${confirmations.total}):
${JSON.stringify(confirmations.checks)}

Respond ONLY valid JSON (verdict must be exactly "APPROVE_BUY" or "VETO"):
{
  "verdict": "APPROVE_BUY" | "VETO",
  "direction": "long" | "short" | null,
  "headline": "max 12 words — specific level or catalyst",
  "thesis": "2 sentences — cite MTF + S/R + flow + news"
}`;

  const raw = await anthropicText(prompt, 500);
  if (!raw) {
    if (playClaudeGateEnabled() || forceClaude) {
      return {
        verdict: "VETO",
        direction: confluence.direction,
        headline: "Claude unavailable — entry blocked",
        thesis: "Anthropic API did not respond. Fail-closed while SPX_CLAUDE_GATE is enabled.",
        approved: false,
        source: "mechanical",
      };
    }
    const mech = mechanicalVerdict(confluence, gates, confirmations);
    await writeCache(key, mech);
    return mech;
  }

  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    // Only charge the daily budget after a successful JSON parse — a malformed
    // response should not consume budget.
    await incrementDailyBudget();
    const verdict = String(parsed.verdict ?? "VETO") as ClaudePlayVerdict["verdict"];
    const direction =
      parsed.direction === "long" || parsed.direction === "short"
        ? parsed.direction
        : confluence.direction;
    const confluenceDirection = confluence.direction;
    const direction_mismatch =
      parsed.direction != null &&
      confluenceDirection != null &&
      parsed.direction !== confluenceDirection
        ? true
        : undefined;
    const result: ClaudePlayVerdict = {
      verdict: verdict === "APPROVE_BUY" ? "APPROVE_BUY" : "VETO",
      direction,
      headline: String(parsed.headline ?? "Play review"),
      thesis: String(parsed.thesis ?? ""),
      approved: verdict === "APPROVE_BUY",
      source: "claude",
      ...(direction_mismatch !== undefined && { direction_mismatch }),
    };
    await writeCache(key, result);
    return result;
  } catch {
    const mech = mechanicalVerdict(confluence, gates, confirmations);
    await writeCache(key, mech);
    return mech;
  }
}
