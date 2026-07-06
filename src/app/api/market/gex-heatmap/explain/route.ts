import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import type {
  GexHeatmap,
  GexHeatmapOverlays,
} from "@/lib/providers/polygon-options-gex";
import { anthropicText, anthropicConfigured } from "@/lib/providers/anthropic";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { gexContextBlock, gexContextLine } from "@/lib/providers/gex-positioning";
import { requireAnyToolApi } from "@/lib/tool-access-server";
import { checkNumbersGrounded } from "@/lib/grounding-guard";
import { fmtPremium } from "@/lib/fmt-money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Largo desk-read narrative for the GEX heatmap.
 *
 * COST CONTROL: the narrative is cached PER TICKER (in-memory + Redis, ~180s) so the
 * route is a true cache-reader — only the FIRST request after expiry calls Claude. At
 * 500 concurrent users that collapses to ~one Claude call per ticker per 3 min. Mirrors
 * the overlay-cache pattern in the sibling /api/market/gex-heatmap route.
 */
const EXPLAIN_TTL_MS = 180_000; // ~3 min
const EXPLAIN_TTL_SEC = Math.ceil(EXPLAIN_TTL_MS / 1000);

type ExplainEntry = { at: number; narrative: string; asof: string };
const explainMem = new Map<string, ExplainEntry>();

/** Largo = BlackOut's options-desk analyst. Market-STRUCTURE analysis, NOT advice. */
const SYSTEM = [
  "You are Largo, BlackOut's options desk analyst. Read dealer positioning for a single ticker",
  "and explain, in 3 to 5 concrete sentences, what it means for that ticker RIGHT NOW:",
  "the gamma regime (long vs short), the key levels to watch (call/put walls, gamma flip,",
  "max pain), and what would change the read (a flip cross, a wall melting, etc.).",
  "Ground EVERY statement ONLY in the data provided — never invent levels or numbers.",
  "This is market-structure analysis, NOT financial advice: give NO buy/sell directives,",
  "no price targets, no position sizing. Plain desk language, no preamble, no disclaimers,",
  "no bullet lists — just the read.",
].join(" ");

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Build a CONCISE context string from the cached heatmap (+ optional overlays) for the
 * prompt. Only includes what's actually present — never fabricates. Kept short so the
 * call stays cheap and the model stays grounded.
 *
 * The CORE GEX/VEX context is now sourced from the canonical shared helper
 * `gexContextBlock(ticker)` (lib/providers/gex-positioning) — the single source of
 * truth every tool/service/AI surface reads — so this route can't drift from what
 * users see. This route then APPENDS its route-local overlay context (HELIX flow +
 * dark-pool) that the shared helper intentionally does not carry.
 */
async function buildContext(
  ticker: string,
  hm: GexHeatmap,
  overlays: GexHeatmapOverlays | null
): Promise<string> {
  // Canonical core GEX/VEX block (Ticker/Spot/regime read/flip+posture+distance/walls+
  // max-pain/net gamma+vanna/intraday shift). Reads the SAME shared matrix cache `hm`
  // came from. Falls back to the local render only if the helper returns null (cold).
  const core = await gexContextBlock(ticker).catch(() => null);
  const lines: string[] = [];
  if (core) {
    lines.push(core);
  } else {
    // Defensive fallback (helper returned null on a matrix we already validated as
    // non-empty): keep the route honest with the minimal header + regime read.
    lines.push(`Ticker: ${ticker}`);
    lines.push(
      `Spot: ${fmtNum(hm.spot)} (${hm.change_pct >= 0 ? "+" : ""}${hm.change_pct.toFixed(2)}% on the day)`
    );
    lines.push(`GEX regime read: ${hm.gex.regime.read}`);
  }

  // Top ~3 flow strikes by |net premium| (HELIX overlay), when present.
  const flow = overlays?.flow_by_strike;
  if (flow && Object.keys(flow).length) {
    const top = Object.entries(flow)
      .map(([strike, f]) => ({ strike, net: f.net_prem }))
      .filter((r) => Number.isFinite(r.net) && r.net !== 0)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 3);
    if (top.length) {
      lines.push(
        `Top flow strikes (net premium): ${top
          .map((r) => `${r.strike} ${r.net >= 0 ? "bullish" : "bearish"} ${fmtPremium(r.net)}`)
          .join(", ")}`
      );
    }
  }

  // Top dark-pool levels by notional, when present.
  const dp = overlays?.dark_pool_levels;
  if (dp && dp.length) {
    lines.push(
      `Top dark-pool levels: ${dp
        .slice(0, 3)
        .map((l) => `${fmtNum(l.price)} (${fmtPremium(l.notional)})`)
        .join(", ")}`
    );
  }

  return lines.join("\n");
}

/**
 * The set of PRICE LEVELS the narrative is allowed to cite — every strike on the matrix axis plus
 * the named levels (flip / call wall / put wall / max pain / DEX & CHARM zero-levels / spot) and any
 * dark-pool overlay price levels. These are the ONLY numbers a grounded desk read should name as a
 * price. Built fresh from the SAME cached matrix the prompt was built from — never fabricated.
 */
function knownPriceLevels(hm: GexHeatmap, overlays: GexHeatmapOverlays | null): number[] {
  const levels = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n != null && Number.isFinite(n) && n > 0) levels.add(Number(n));
  };
  for (const s of hm.strikes) add(s);
  add(hm.spot);
  add(hm.max_pain);
  add(hm.gex?.flip);
  add(hm.gex?.call_wall);
  add(hm.gex?.put_wall);
  add(hm.vex?.flip);
  add(hm.vex?.pos_wall);
  add(hm.vex?.neg_wall);
  add(hm.dex?.zero_level);
  add(hm.charm?.zero_level);
  for (const lvl of overlays?.dark_pool_levels ?? []) add(lvl.price);
  return Array.from(levels);
}

/**
 * Cheap post-generation FABRICATION GUARD: extract every number in the prose that READS LIKE a
 * price level and confirm it matches a known level within tolerance. The model is told to ground
 * every level in the data, but that's only a prompt instruction — this verifies it. Returns true
 * when the prose is grounded (or names no price levels at all), false when ANY cited price level is
 * absent from the matrix → the caller falls back to the deterministic gexContextLine.
 *
 * Conservative by design — we only judge numbers that look like bare price levels and IGNORE:
 *   • percentages ("0.42%"), which are day-change / distance figures, not levels;
 *   • money magnitudes ("$688M", "$1.2B"), the net GEX/VEX figures;
 *   • small integers <10 (sentence counts, "3 to 5 sentences", "0DTE");
 * so we don't false-positive on legitimate non-level numbers. Tolerance scales with price so a
 * "745" read against a 745.0 strike passes, but a hallucinated "812" on a 730–760 chain fails.
 */
function narrativeLevelsAreGrounded(
  narrative: string,
  hm: GexHeatmap,
  overlays: GexHeatmapOverlays | null
): boolean {
  const known = knownPriceLevels(hm, overlays);
  const result = checkNumbersGrounded(narrative, known);
  if (!result.grounded) {
    // hm.underlying traces back to the user-supplied `ticker` query param (only
    // .toUpperCase()'d, no character filtering) — strip CR/LF before it reaches a log
    // line so a crafted ticker can't forge extra log entries (CodeQL log-injection).
    const safeTicker = hm.underlying.replace(/[\r\n]/g, "");
    console.warn(
      `[market/gex-heatmap/explain] ungrounded level ${result.ungroundedValue} in narrative for ${safeTicker} — falling back to deterministic read.`
    );
  }
  return result.grounded;
}

/**
 * GET /api/market/gex-heatmap/explain?ticker=SPY
 *
 * Returns a Largo desk-read narrative of the cached dealer positioning for `ticker`.
 * Premium Clerk session OR cron secret, matching the sibling heatmap route. Cached per
 * ticker (~180s) so 500 users → one Claude call per ticker per ~3 min. Never fabricates,
 * never throws to the client.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireAnyToolApi(["spx", "heatmap"]);
  if (locked) return locked;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: noStore });
  }

  // 1. Never fabricate when AI is unconfigured.
  if (!anthropicConfigured()) {
    return NextResponse.json(
      { available: false, reason: "ai-unconfigured" },
      { status: 200, headers: noStore }
    );
  }

  const cacheKey = `gex-explain:${ticker}`;
  const now = Date.now();

  // 2a. In-memory cache (co-located requests skip Redis + Claude).
  const mem = explainMem.get(ticker);
  if (mem && now - mem.at < EXPLAIN_TTL_MS) {
    return NextResponse.json(
      { available: true, narrative: mem.narrative, asof: mem.asof, ticker },
      { status: 200, headers: noStore }
    );
  }

  // 2b. Redis cache (cross-replica) — one Claude call per ticker per TTL cluster-wide.
  try {
    const hit = await sharedCacheGet<ExplainEntry>(cacheKey);
    if (hit && now - hit.at < EXPLAIN_TTL_MS) {
      explainMem.set(ticker, hit);
      return NextResponse.json(
        { available: true, narrative: hit.narrative, asof: hit.asof, ticker },
        { status: 200, headers: noStore }
      );
    }
  } catch {
    /* redis optional — fall through to compute */
  }

  // 3. Cache miss → read the cached heatmap (+ optional overlay cache) and call Claude.
  try {
    const heatmap = await fetchGexHeatmap(ticker);
    if (!heatmap || heatmap.strikes.length === 0) {
      // No positioning to read — never fabricate a narrative.
      return NextResponse.json(
        { available: false, reason: "no-data", ticker },
        { status: 200, headers: noStore }
      );
    }

    // Best-effort: reuse the sibling route's overlay cache if it's warm (no upstream hit).
    let overlays: GexHeatmapOverlays | null = null;
    try {
      const ov = await sharedCacheGet<{ at: number; overlays: GexHeatmapOverlays }>(
        `gex-overlay:${ticker}`
      );
      if (ov && now - ov.at < EXPLAIN_TTL_MS) overlays = ov.overlays;
    } catch {
      /* overlays are optional context */
    }

    const context = await buildContext(ticker, heatmap, overlays);
    const prompt =
      `Dealer positioning snapshot for ${ticker}:\n\n${context}\n\n` +
      `Give the desk read now (3-5 sentences, market-structure analysis only).`;

    const narrative = await anthropicText(prompt, 600, SYSTEM, { timeoutMs: 25_000, maxRetries: 1 });
    if (!narrative || !narrative.trim()) {
      // Model returned nothing usable — graceful, never fabricated.
      return NextResponse.json(
        { available: false, reason: "failed", ticker },
        { status: 200, headers: noStore }
      );
    }

    // FABRICATION GUARD (#12): the SYSTEM prompt tells the model to ground every level in the data,
    // but a prompt is not a contract. Cheaply verify that any price level the prose NAMES actually
    // exists on the matrix; if any cited level is hallucinated, discard the narrative and serve the
    // deterministic, provably-grounded one-liner instead of shipping a fabricated number to a paying
    // desk. The deterministic line is itself built ONLY from the matrix, so it's always safe.
    let finalNarrative = narrative.trim();
    if (!narrativeLevelsAreGrounded(finalNarrative, heatmap, overlays)) {
      const deterministic = await gexContextLine(ticker).catch(() => null);
      if (deterministic && deterministic.trim()) {
        finalNarrative = deterministic.trim();
      } else {
        // No safe fallback available → never ship the ungrounded read.
        return NextResponse.json(
          { available: false, reason: "ungrounded", ticker },
          { status: 200, headers: noStore }
        );
      }
    }

    const asof = heatmap.asof ?? new Date().toISOString();
    const entry: ExplainEntry = { at: now, narrative: finalNarrative, asof };

    // Cache for everyone: bound the in-memory map, write Redis best-effort.
    if (explainMem.size > 200) explainMem.clear();
    explainMem.set(ticker, entry);
    void sharedCacheSet(cacheKey, entry, EXPLAIN_TTL_SEC).catch(() => {});

    return NextResponse.json(
      { available: true, narrative: entry.narrative, asof, ticker },
      { status: 200, headers: noStore }
    );
  } catch (error) {
    console.error("[market/gex-heatmap/explain]", error);
    // Never throw to the client.
    return NextResponse.json(
      { available: false, reason: "failed", ticker },
      { status: 200, headers: noStore }
    );
  }
}
