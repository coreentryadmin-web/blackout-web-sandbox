import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayGateResult } from "@/features/spx/lib/spx-play-gates";
import type { PlayConfirmationResult } from "@/features/spx/lib/spx-play-confirmations";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import {
  gradeRank,
  playClaudeCachePriceStepPts,
  playClaudeCacheSec,
  playClaudeGateEnabled,
} from "@/features/spx/lib/spx-play-config";
import { dbConfigured, getMeta, setMeta, insertAlertAuditLog } from "@/lib/db";
import { findSimilarPrecedents } from "@/lib/bie/precedent-search";
import { bieEmbeddingsConfigured } from "@/lib/bie/embeddings";
import {
  buildPrecedentSearchQuery,
  parsePrecedentDirection,
  parsePrecedentOutcome,
  PRECEDENT_SEARCH_K,
  MIN_TOTAL_PRECEDENTS,
  type PrecedentHit,
} from "@/features/spx/lib/spx-signals-shadow-precedents";

/** Same floor as spx-signals-shadow-precedents MIN_USABLE_FOR_TIERED_WEIGHT (not exported). */
const MIN_USABLE_PRECEDENTS = 2;

export type ClaudePlayVerdict = {
  verdict: "APPROVE_BUY" | "VETO";
  direction: "long" | "short" | null;
  headline: string;
  thesis: string;
  approved: boolean;
  /** bie = Voyage precedent search; mechanical = deterministic gate; cache = prior tick */
  source: "bie" | "mechanical" | "cache";
  direction_mismatch?: boolean;
};

const CACHE_KEY = "spx_bie_play_cache";
const memoryCache = new Map<string, { at: number; verdict: ClaudePlayVerdict }>();

function cacheKey(
  desk: SpxDeskPayload,
  c: SpxConfluence,
  confirmations: PlayConfirmationResult
): string {
  const step = Math.max(0.5, playClaudeCachePriceStepPts());
  const bucketedPrice = Math.round(desk.price / step) * step;
  return `${c.direction}|${c.grade}|${Math.round(c.score)}|${confirmations.passed ? 1 : 0}|${bucketedPrice.toFixed(1)}`;
}

function bieSearchAvailable(): boolean {
  return dbConfigured() && bieEmbeddingsConfigured();
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

/** Price levels on the desk card — used only by tests / future grounding helpers. */
export function knownPlayLevels(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  technicals: PlayTechnicals
): number[] {
  const levels = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n != null && Number.isFinite(n) && n > 0) levels.add(Number(n));
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
  for (const l of desk.levels ?? []) add(l.value);
  for (const w of desk.gex_walls ?? []) add(w.strike);
  add(confluence.levels?.entry);
  add(confluence.levels?.stop);
  add(confluence.levels?.target);
  add(technicals.m3_close);
  add(technicals.m5_close);
  add(technicals.m5_ema20);
  return Array.from(levels);
}

function logPlayVerdict(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  verdict: ClaudePlayVerdict,
  note?: string
): void {
  if (!dbConfigured()) return;
  insertAlertAuditLog({
    alert_type: "spx_bie_play",
    source_table: "spx_bie_play_verdict",
    source_key: { price: desk.price, direction: confluence.direction, at: desk.as_of },
    ticker: "SPX",
    direction: verdict.direction,
    confidence_score: confluence.score,
    confidence_label: confluence.grade,
    trigger_reason: note ?? verdict.headline,
    decision_trace: [{ check: "bie_verdict", passed: verdict.approved, value: verdict.verdict }],
    input_snapshot: null,
    final_output: { verdict: verdict.verdict, confidence: confluence.score, thesis: verdict.thesis },
  }).catch((err) => {
    console.error("[spx-play-bie] audit-log write failed (non-blocking):", err);
  });
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

function tallyPrecedentHits(
  precedents: PrecedentHit[],
  confluenceDirection: "long" | "short"
): { total: number; forCount: number; againstCount: number; usable: number } {
  const confluenceBullish = confluenceDirection === "long";
  let forCount = 0;
  let againstCount = 0;
  for (const p of precedents) {
    const dir = parsePrecedentDirection(p.chunk);
    if (dir === "neutral") continue;
    const sameDirection = (dir === "bullish") === confluenceBullish;
    if (!sameDirection) continue;
    const outcome = parsePrecedentOutcome(p.chunk);
    if (outcome === "target") forCount += 1;
    else if (outcome === "stop") againstCount += 1;
  }
  return {
    total: precedents.length,
    forCount,
    againstCount,
    usable: forCount + againstCount,
  };
}

function failClosedVerdict(
  c: SpxConfluence,
  headline: string,
  thesis: string,
  desk?: SpxDeskPayload
): ClaudePlayVerdict {
  const verdict: ClaudePlayVerdict = {
    verdict: "VETO",
    direction: c.direction,
    headline,
    thesis,
    approved: false,
    source: "mechanical",
  };
  if (desk) {
    logPlayVerdict(desk, c, verdict, `fail-closed: ${headline}`);
  }
  return verdict;
}

/**
 * Trade-alert approval for the right-rail play card — uses BIE precedent search
 * (Voyage embeddings + cosine match) instead of Anthropic.
 */
export async function evaluateClaudePlayApproval(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  gates: PlayGateResult,
  confirmations: PlayConfirmationResult,
  technicals: PlayTechnicals,
  options?: { forceClaude?: boolean }
): Promise<ClaudePlayVerdict> {
  void technicals;
  void options?.forceClaude;
  if (!gates.passed || !confluence.direction) {
    return mechanicalVerdict(confluence, gates, confirmations);
  }

  const key = cacheKey(desk, confluence, confirmations);
  const cached = await readCache(key);
  if (cached) return cached;

  const requireBie = playClaudeGateEnabled();
  const mech = mechanicalVerdict(confluence, gates, confirmations);

  if (!bieSearchAvailable()) {
    if (requireBie) {
      return failClosedVerdict(
        confluence,
        "BIE gate blocked — Voyage/DB not configured",
        "SPX_CLAUDE_GATE requires BIE precedent search (VOYAGE_API_KEY + DATABASE_URL).",
        desk
      );
    }
    logPlayVerdict(desk, confluence, mech, "bie-unavailable mechanical fallback");
    await writeCache(key, mech);
    return mech;
  }

  const query = buildPrecedentSearchQuery(
    desk,
    confluence.direction,
    confluence.grade,
    confluence.score
  );

  let hits: PrecedentHit[] = [];
  try {
    const chunks = await findSimilarPrecedents(query, PRECEDENT_SEARCH_K);
    hits = chunks.map((c) => ({ chunk: c.chunk, similarity: c.similarity }));
  } catch (err) {
    console.warn("[spx-play-bie] precedent search failed:", err);
    if (requireBie) {
      return failClosedVerdict(
        confluence,
        "BIE search failed — entry blocked",
        "Voyage precedent search errored. Fail-closed while SPX_CLAUDE_GATE is enabled.",
        desk
      );
    }
    logPlayVerdict(desk, confluence, mech, "bie-search-error mechanical fallback");
    await writeCache(key, mech);
    return mech;
  }

  const tally = tallyPrecedentHits(hits, confluence.direction);

  if (tally.total < MIN_TOTAL_PRECEDENTS) {
    const note = `BIE: only ${tally.total}/${MIN_TOTAL_PRECEDENTS} similar precedents — corpus still thin.`;
    if (requireBie) {
      return failClosedVerdict(confluence, "BIE corpus too thin — entry blocked", note, desk);
    }
    const fallback = mechanicalVerdict(confluence, gates, confirmations, note);
    logPlayVerdict(desk, confluence, fallback, "bie-corpus-thin mechanical fallback");
    await writeCache(key, fallback);
    return fallback;
  }

  if (tally.usable < MIN_USABLE_PRECEDENTS) {
    const note = `BIE: ${tally.total} precedents returned but none cleanly resolved target/stop for this direction.`;
    if (requireBie) {
      return failClosedVerdict(confluence, "BIE precedents inconclusive — entry blocked", note, desk);
    }
    const fallback = mechanicalVerdict(confluence, gates, confirmations, note);
    logPlayVerdict(desk, confluence, fallback, "bie-inconclusive mechanical fallback");
    await writeCache(key, fallback);
    return fallback;
  }

  const net = tally.forCount - tally.againstCount;
  const dirLabel = confluence.direction === "long" ? "CALL" : "PUT";

  if (net < 0) {
    const result: ClaudePlayVerdict = {
      verdict: "VETO",
      direction: confluence.direction,
      headline: `BIE veto — ${tally.againstCount}/${tally.usable} similar setups stopped`,
      thesis: `Voyage precedent search: ${tally.forCount} hit target vs ${tally.againstCount} stopped on same-direction SPX setups (${tally.total} total matches).`,
      approved: false,
      source: "bie",
    };
    logPlayVerdict(desk, confluence, result);
    await writeCache(key, result);
    return result;
  }

  if (!mech.approved) {
    logPlayVerdict(desk, confluence, mech, "mechanical bar not met");
    await writeCache(key, mech);
    return mech;
  }

  if (net === 0) {
    const neutral = mechanicalVerdict(
      confluence,
      gates,
      confirmations,
      "BIE precedents split evenly — mechanical bar only."
    );
    logPlayVerdict(desk, confluence, neutral, "bie-split mechanical only");
    await writeCache(key, neutral);
    return neutral;
  }

  const result: ClaudePlayVerdict = {
    verdict: "APPROVE_BUY",
    direction: confluence.direction,
    headline: `${confluence.grade} ${dirLabel} — BIE ${tally.forCount}/${tally.usable} precedents hit target`,
    thesis: `Voyage precedent match: ${tally.forCount}/${tally.usable} similar ${confluence.direction} setups resolved target (${tally.againstCount} stopped). ${confirmations.passed_count}/${confirmations.total} confirmations · score ${confluence.score}.`,
    approved: true,
    source: "bie",
  };
  logPlayVerdict(desk, confluence, result);
  await writeCache(key, result);
  return result;
}
