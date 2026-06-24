import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import type {
  GexHeatmap,
  GexHeatmapOverlays,
} from "@/lib/providers/polygon-options-gex";
import { anthropicText, anthropicConfigured } from "@/lib/providers/anthropic";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { gexContextBlock } from "@/lib/providers/gex-positioning";
import { requireToolApi } from "@/lib/tool-access-server";

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

/** Compact signed dollar magnitude, e.g. "$38.2M" / "-$4.1K". */
function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

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
          .map((r) => `${r.strike} ${r.net >= 0 ? "bullish" : "bearish"} ${fmtMoney(r.net)}`)
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
        .map((l) => `${fmtNum(l.price)} (${fmtMoney(l.notional)})`)
        .join(", ")}`
    );
  }

  return lines.join("\n");
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
  const locked = await requireToolApi("heatmap");
  if (locked) return locked;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

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

    const narrative = await anthropicText(prompt, 600, SYSTEM);
    if (!narrative || !narrative.trim()) {
      // Model returned nothing usable — graceful, never fabricated.
      return NextResponse.json(
        { available: false, reason: "failed", ticker },
        { status: 200, headers: noStore }
      );
    }

    const asof = heatmap.asof ?? new Date().toISOString();
    const entry: ExplainEntry = { at: now, narrative: narrative.trim(), asof };

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
