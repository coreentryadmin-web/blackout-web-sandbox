import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import type { SpxConfluence } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayGateResult } from "@/lib/spx-play-gates";
import { playClaudeCacheSec, playClaudeGateEnabled } from "@/lib/spx-play-config";
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
  gates: PlayGateResult
): ClaudePlayVerdict {
  const approved = gates.passed && c.direction != null;
  return {
    verdict: approved ? "APPROVE_BUY" : "HOLD_WATCH",
    direction: c.direction,
    headline: approved
      ? `${c.grade} ${c.direction === "long" ? "CALL" : "PUT"} — mechanical pass`
      : "Gates not cleared — stay flat",
    thesis: approved
      ? `Score ${c.score} with ${c.agreeing} agreeing factors (${gates.entry_mode} size).`
      : gates.blocks[0] ?? "Waiting for cleaner confluence.",
    approved,
    source: "mechanical",
  };
}

export async function evaluateClaudePlayApproval(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  gates: PlayGateResult
): Promise<ClaudePlayVerdict> {
  if (!gates.passed || !confluence.direction) {
    return mechanicalVerdict(confluence, gates);
  }

  const key = cacheKey(desk, confluence);
  const cached = await readCache(key);
  if (cached) return cached;

  if (!playClaudeGateEnabled() || !anthropicConfigured()) {
    const mech = mechanicalVerdict(confluence, gates);
    mech.approved = gates.passed;
    mech.verdict = gates.passed ? "APPROVE_BUY" : "HOLD_WATCH";
    await writeCache(key, mech);
    return mech;
  }

  const prompt = `You are the SPX 0DTE play arbiter for BlackOut Ops. Approve or veto a BUY ticket.

RULES:
- APPROVE_BUY only when confluence, gates, and structure align for a high-quality 0DTE index options play.
- VETO when data conflicts, late session risk, or headline risk dominates.
- One open play at a time — be selective.

DESK SNAPSHOT:
${JSON.stringify({
  price: desk.price,
  vwap: desk.vwap,
  regime: desk.regime,
  gamma_flip: desk.gamma_flip,
  gamma_regime: desk.gamma_regime,
  gex_walls: desk.gex_walls?.slice(0, 6),
  flow_0dte_net: desk.flow_0dte_net,
  tide_bias: desk.tide_bias,
  dark_pool_bias: desk.dark_pool?.bias,
  vix: desk.vix,
  tick: desk.tick,
  macro: desk.macro_events?.slice(0, 2),
})}

CONFLUENCE:
${JSON.stringify({
  score: confluence.score,
  grade: confluence.grade,
  direction: confluence.direction,
  conflicts: confluence.conflicts,
  agreeing: confluence.agreeing,
  factors: confluence.factors.slice(0, 8),
  levels: confluence.levels,
})}

GATES:
${JSON.stringify(gates)}

Respond ONLY valid JSON:
{
  "verdict": "APPROVE_BUY" | "HOLD_WATCH" | "VETO",
  "direction": "long" | "short" | null,
  "headline": "max 12 words punchy",
  "thesis": "2 sentences max"
}`;

  const raw = await anthropicText(prompt, 400);
  if (!raw) {
    const mech = mechanicalVerdict(confluence, gates);
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
      verdict,
      direction,
      headline: String(parsed.headline ?? "Play review"),
      thesis: String(parsed.thesis ?? ""),
      approved: verdict === "APPROVE_BUY",
      source: "claude",
    };
    await writeCache(key, result);
    return result;
  } catch {
    const mech = mechanicalVerdict(confluence, gates);
    await writeCache(key, mech);
    return mech;
  }
}
