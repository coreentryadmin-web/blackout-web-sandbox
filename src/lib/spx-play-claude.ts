import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import type { SpxConfluence } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayGateResult } from "@/lib/spx-play-gates";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import { gradeRank, playClaudeCacheSec, playClaudeGateEnabled } from "@/lib/spx-play-config";
import { dbConfigured, getMeta, setMeta } from "@/lib/db";

export type ClaudePlayVerdict = {
  verdict: "APPROVE_BUY" | "HOLD_WATCH" | "VETO";
  direction: "long" | "short" | null;
  headline: string;
  thesis: string;
  approved: boolean;
  source: "claude" | "mechanical" | "cache";
};

const CACHE_KEY = "spx_claude_play_cache";
const memoryCache = new Map<string, { at: number; verdict: ClaudePlayVerdict }>();

function cacheKey(desk: SpxDeskPayload, c: SpxConfluence): string {
  return `${c.direction}|${c.grade}|${Math.round(c.score)}|${desk.price.toFixed(1)}`;
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
    const parsed = JSON.parse(raw) as { key: string; at: number; verdict: ClaudePlayVerdict };
    if (parsed.key !== key) return null;
    if (Date.now() - parsed.at > playClaudeCacheSec() * 1000) return null;
    return { ...parsed.verdict, source: "cache" };
  } catch {
    return null;
  }
}

async function writeCache(key: string, verdict: ClaudePlayVerdict): Promise<void> {
  memoryCache.set(key, { at: Date.now(), verdict });
  if (!dbConfigured()) return;
  await setMeta(CACHE_KEY, JSON.stringify({ key, at: Date.now(), verdict }));
}

function mechanicalVerdict(
  c: SpxConfluence,
  gates: PlayGateResult,
  confirmations: PlayConfirmationResult
): ClaudePlayVerdict {
  const strict =
    gates.passed &&
    c.direction != null &&
    gradeRank(c.grade) >= 2 &&
    confirmations.passed;
  return {
    verdict: strict ? "APPROVE_BUY" : "VETO",
    direction: c.direction,
    headline: strict
      ? `${c.grade} ${c.direction === "long" ? "CALL" : "PUT"} — all checks passed`
      : "Quality bar not met — stay flat",
    thesis: strict
      ? `${confirmations.passed_count}/${confirmations.total} confirmations · score ${c.score}.`
      : gates.blocks[0] ?? "Waiting for A/A+ confluence with full confirmations.",
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
    if (forceClaude) {
      return {
        verdict: "VETO",
        direction: confluence.direction,
        headline: "Promote blocked — Claude required",
        thesis: "Telemetry requires Claude approval for WATCH→ENTRY, but Anthropic is not configured.",
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

Respond ONLY valid JSON:
{
  "verdict": "APPROVE_BUY" | "VETO",
  "direction": "long" | "short" | null,
  "headline": "max 12 words — specific level or catalyst",
  "thesis": "2 sentences — cite MTF + S/R + flow + news"
}`;

  const raw = await anthropicText(prompt, 500);
  if (!raw) {
    const mech = mechanicalVerdict(confluence, gates, confirmations);
    await writeCache(key, mech);
    return mech;
  }

  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const verdict = String(parsed.verdict ?? "VETO") as ClaudePlayVerdict["verdict"];
    const direction =
      parsed.direction === "long" || parsed.direction === "short"
        ? parsed.direction
        : confluence.direction;
    const result: ClaudePlayVerdict = {
      verdict: verdict === "APPROVE_BUY" ? "APPROVE_BUY" : "VETO",
      direction,
      headline: String(parsed.headline ?? "Play review"),
      thesis: String(parsed.thesis ?? ""),
      approved: verdict === "APPROVE_BUY",
      source: "claude",
    };
    await writeCache(key, result);
    return result;
  } catch {
    const mech = mechanicalVerdict(confluence, gates, confirmations);
    await writeCache(key, mech);
    return mech;
  }
}
