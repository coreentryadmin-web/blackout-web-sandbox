// Night's Watch — grounded "desk narrative" for a position's hold/trim/sell read.
//
// TIER + GROUNDED + COST-BOUNDED:
//   - Claude writes the PROSE, but ONLY from the real signals position-detail.ts already
//     gathered (engine verdict + flows + technicals + GEX/walls + catalysts + confluence +
//     Greeks + P&L). The system prompt forbids inventing any number/level — every missing
//     field is passed as "n/a", never a placeholder figure. This is the "legit, not made up"
//     reasoning layer on top of the deterministic verdict.
//   - Cached per POSITION fingerprint (NOT per user) so 500 users opening the same contract's
//     detail cost ONE Claude call; bounded by a GLOBAL daily budget; capped at 300 output tokens.
//   - On-demand ONLY (built in the detail route, never on the fast value poll). Fails OPEN:
//     anthropic unconfigured / over budget / Redis down / any error → null, and the caller
//     falls back to the deterministic whatToDo. Never blocks, never throws.

import { anthropicConfigured, anthropicText, LARGO_MODEL } from "@/lib/providers/anthropic";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { sanitizeFeedText } from "@/lib/largo/sanitize-feed-text";
import { secondsUntilEtMidnight } from "@/lib/largo-budget";
import {
  narrativeBudgetKey,
  isOverNarrativeBudget,
  narrativeDailyBudget,
} from "@/lib/nights-watch/narrative-budget";
import type { PositionDetail } from "@/lib/nights-watch/position-detail";

const NARRATIVE_TTL_MS = 5 * 60 * 1000; // one Claude call per position cluster per 5-min window
const NARRATIVE_MAX_TOKENS = 300;

const NARRATIVE_SYSTEM_PROMPT = `You are BlackOut's options desk analyst writing a short, technically precise read on ONE of the user's option positions.
RULES:
- Ground EVERY statement ONLY in the SIGNALS provided below. NEVER invent or estimate a price, level, Greek, premium, percentage, or date that is not in the data. If a field shows "n/a", do not mention it.
- Do NOT compute or state the number of days between two dates yourself (you make arithmetic errors). Only cite day-counts that are explicitly provided (e.g. DTE, "in Nd"). State date relationships ONLY as given — e.g. say "before this expiry" / "after this expiry" when told, never your own day-gap like "four days after".
- Explain WHY the engine's call (hold / trim / sell / watch) is reasonable given the signals — reference the ACTUAL flow lean, dealer-gamma walls, trend, key levels, catalysts, and the position's P&L / DTE / Greeks that are provided.
- 3 to 5 tight sentences. Desk tone: direct, professional, no hype, no emoji, no markdown headers, no bullet points.
- Do NOT give personalized financial advice, position sizing, or guarantees — describe the setup and the engine's reasoning. No disclaimer (the UI adds one).`;

/** Format a number or "n/a" — never a fabricated 0 for missing data. */
function n(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? "n/a" : Number(v).toFixed(digits);
}

/** Build the grounding context from VERIFIED fields only; every null becomes "n/a". */
function buildContext(detail: PositionDetail): string {
  const p = detail.position;
  const v = p.valuation;
  const s = detail.sections;
  const lines: string[] = [];

  lines.push(
    `POSITION: ${p.ticker} ${p.strike}${p.option_type === "call" ? "C" : "P"} ${p.side} x${p.contracts}, expiry ${String(p.expiry).slice(0, 10)}, entry ${n(p.entry_premium)}.`
  );
  lines.push(
    `ENGINE VERDICT: ${p.verdict.action.toUpperCase()} (${p.verdict.confidence} confidence). Signals: ${p.verdict.reasons.join("; ") || "n/a"}.`
  );
  lines.push(
    `P&L: unrealized ${p.unrealized_pnl == null ? "n/a" : "$" + p.unrealized_pnl.toFixed(0)} (${n(p.pnl_pct, 1)}%). DTE ${p.dte}. Breakeven ${n(p.breakeven)}. Dist-to-strike ${n(p.distance_to_strike_pct, 1)}%. Valuation ${p.valuation_status}.`
  );
  lines.push(
    `GREEKS: mark ${n(v?.mark)}, delta ${n(v?.delta)}, gamma ${n(v?.gamma, 4)}, theta/day ${n(v?.theta)}, IV ${v?.iv == null ? "n/a" : (v.iv * 100).toFixed(0) + "%"}.`
  );
  if (s.positioning) {
    lines.push(
      `DEALER GAMMA: regime ${s.positioning.gammaRegime ?? "n/a"}, flip ${n(s.positioning.gammaFlip)}, max-pain ${n(s.positioning.maxPain)}, anchor ${n(s.positioning.kingStrike)}, walls ${s.positioning.walls.map((w) => `${w.kind} ${w.strike}`).join(", ") || "n/a"}.`
    );
  }
  if (s.flows) {
    lines.push(
      `OPTIONS FLOW (${s.flows.sinceHours}h): lean ${s.flows.lean}, calls $${(s.flows.callPremium / 1000).toFixed(0)}k vs puts $${(s.flows.putPremium / 1000).toFixed(0)}k over ${s.flows.count} prints. Top strikes: ${s.flows.topStrikes.slice(0, 3).map((t) => `${t.strike}${t.option_type} $${(t.premium / 1000).toFixed(0)}k`).join(", ") || "n/a"}.`
    );
  }
  if (s.technicals) {
    lines.push(
      `TECHNICALS: trend ${s.technicals.trend ?? "n/a"}, price ${n(s.technicals.price)}, RSI(d) ${n(s.technicals.rsi.daily, 0)}, ATR ${n(s.technicals.atr14)}, 20d range ${n(s.technicals.range_low_20d)}–${n(s.technicals.range_high_20d)}. Key levels: ${s.technicals.keyLevels.slice(0, 4).map((l) => `${l.kind} ${l.price}`).join(", ") || "n/a"}.`
    );
  }
  if (s.catalysts) {
    lines.push(
      `CATALYST: earnings ${s.catalysts.earningsDate ?? "n/a"}${s.catalysts.daysToEarnings != null ? ` (in ${s.catalysts.daysToEarnings}d)` : ""}${s.catalysts.beforeExpiry ? " — BEFORE this expiry" : ""}.`
    );
  }
  if (s.confluence) {
    lines.push(
      `SPX CONFLUENCE: ${s.confluence.action} grade ${s.confluence.grade} (score ${s.confluence.score}), ${s.confluence.agreeing} agree / ${s.confluence.conflicts} conflict. Entry ${n(s.confluence.entry)}, stop ${n(s.confluence.stop)}, target ${n(s.confluence.target)}.`
    );
  }
  if (s.dossier) {
    lines.push(`NIGHT HAWK DOSSIER present for this ticker (edition ${s.dossier.edition_for}).`);
  }
  lines.push(`DETERMINISTIC DIRECTIVE: ${detail.whatToDo.directive}`);

  return sanitizeFeedText(lines.join("\n"));
}

// Atomic INCR+EXPIRE in one round-trip (mirrors recordLargoBudgetUsage) so a crash between the
// two can't leave a counter without a TTL.
const BUDGET_INCR_LUA =
  "local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return c";

type GateRedis = {
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
} | null;

/**
 * Grounded Claude desk narrative for one position, or null (caller falls back to the
 * deterministic whatToDo). On-demand only; per-position cached; globally budgeted; fail-open.
 */
// Per-instance in-flight dedup: a burst of detail-opens on the SAME position generates ONE
// Claude call (the Redis shared cache handles cross-instance + subsequent windows).
const NARRATIVE_INFLIGHT = new Map<string, Promise<string | null>>();

export async function buildPositionNarrative(detail: PositionDetail): Promise<string | null> {
  if (!anthropicConfigured()) return null;

  const p = detail.position;
  // Per-POSITION fingerprint (NOT per-user): same contract + same engine call + same P&L BAND
  // (5% bands, so minor ticks don't churn the cache) + same DTE → one shared Claude call
  // cluster-wide for the window. pnl_pct is null only at entry=0 → folds into the "na" band.
  const pnlBand = p.pnl_pct == null ? "na" : Math.round(p.pnl_pct / 5) * 5;
  const tkr = String(p.ticker).trim().toUpperCase();
  const cacheKey = `nw:narrative:${tkr}:${p.strike}${p.option_type === "call" ? "C" : "P"}:${p.side}:${p.verdict.action}:${pnlBand}:${p.dte}`;

  // Shared cache (Redis-backed, cross-instance). We cache ONLY non-null below, so a transient
  // anthropic failure never pins the deterministic fallback for the full TTL.
  try {
    const cached = await sharedCacheGet<string>(cacheKey);
    if (cached) return cached;
  } catch {
    /* cache read miss/error → generate */
  }

  const existing = NARRATIVE_INFLIGHT.get(cacheKey);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    const redis = (await getUwCacheRedis()) as unknown as GateRedis;

    // Global daily budget gate — fail-open on Redis null/error (logged for observability).
    if (redis) {
      try {
        const raw = await redis.get(narrativeBudgetKey());
        if (isOverNarrativeBudget(Number(raw ?? 0), narrativeDailyBudget())) {
          console.warn("[nights-watch] narrative over daily budget — using deterministic fallback");
          return null;
        }
      } catch (err) {
        console.warn("[nights-watch] narrative budget read failed (fail-open):", err);
      }
    }

    const text = await anthropicText(
      buildContext(detail),
      NARRATIVE_MAX_TOKENS,
      NARRATIVE_SYSTEM_PROMPT,
      { model: LARGO_MODEL, temperature: 0.3, maxRetries: 1, timeoutMs: 20_000 }
    );
    const out = text?.trim();
    if (!out) return null; // not cached → next open retries

    // Cache the success + record one generation against the global daily budget (best-effort).
    try {
      await sharedCacheSet(cacheKey, out, Math.round(NARRATIVE_TTL_MS / 1000));
    } catch {
      /* non-fatal */
    }
    if (redis) {
      try {
        await redis.eval(BUDGET_INCR_LUA, 1, narrativeBudgetKey(), secondsUntilEtMidnight());
      } catch {
        /* non-fatal — under-counting one generation is acceptable */
      }
    }
    return out;
  })();

  NARRATIVE_INFLIGHT.set(cacheKey, job);
  try {
    return await job;
  } catch {
    return null;
  } finally {
    NARRATIVE_INFLIGHT.delete(cacheKey);
  }
}
