import "server-only";

import { runLargoTool } from "@/lib/largo/run-tool";
import { pickLargoStatusLine } from "@/lib/bie/largo-status";
import type { BieComposed } from "@/lib/bie/composers-shared";
import type { BieRoute } from "@/lib/bie/router";
import { readPolygon, readUw } from "@/lib/bie/provider-read";
import { callInternalApiRead } from "@/lib/bie/internal-api";

const fmt = (n: unknown, d = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

import { needsLiveEnrichment } from "@/lib/bie/live-data-enrich-detect";
export { needsLiveEnrichment, questionWantsVectorPulse } from "@/lib/bie/live-data-enrich-detect";

type EnrichOpts = {
  question?: string;
  onStatus?: (message: string) => void;
  userId?: string;
};

const TOOLS_BY_INTENT: Partial<Record<string, string[]>> = {
  technical_read: ["get_technicals"],
  wall_dynamics_read: ["get_gex", "get_positioning"],
  thermal_read: ["get_gex"],
  helix_read: ["get_flow_tape"],
  flow_tape: ["get_flow_tape"],
  spx_structure: ["get_spx_structure"],
  market_context: ["get_market_context"],
  play_suggest_read: ["get_spx_play"],
  ticker_advice: ["get_quote", "get_technicals"],
  vector_read: ["get_gex"],
  vector_pulse_read: ["get_gex", "get_positioning"],
  spx_desk_read: ["get_spx_structure"],
  ticker_compare: ["get_quote"],
};

function toolTicker(route: BieRoute): string {
  return (route.ticker ?? "SPX").replace(/^SPXW$/i, "SPX");
}

function toolInput(name: string, route: BieRoute): Record<string, unknown> {
  const ticker = toolTicker(route);
  if (name === "get_flow_tape" || name === "get_options_flow") {
    return { ticker, limit: 8 };
  }
  if (name === "get_spx_play" || name === "get_spx_structure" || name === "get_market_context") {
    return {};
  }
  return { ticker };
}

function snippetFromTool(name: string, data: unknown, ticker: string): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  if (name === "get_technicals") {
    const price = d.price as number | undefined;
    if (!price) return null;
    return [
      `**Live technicals (${ticker})**`,
      `- Spot **${fmt(price, 2)}** (${fmt(d.change_pct, 2)}%) · trend **${d.trend ?? "—"}**`,
      `- RSI **${fmt(d.rsi14, 1)}** · ATR **${fmt(d.atr14, 2)}** · EMA20 **${fmt((d.emas as { ema20?: number })?.ema20, 2)}**`,
    ].join("\n");
  }

  if (name === "get_quote") {
    const p = d.price ?? d.last;
    if (typeof p !== "number") return null;
    return `**Live quote (${ticker}):** **${fmt(p, 2)}**${d.change_pct != null ? ` (${fmt(d.change_pct, 2)}%)` : ""}`;
  }

  if (name === "get_gex" || name === "get_positioning") {
    const spot = d.spot ?? d.price;
    const flip = d.gamma_flip ?? d.flip;
    const net = d.net_gex;
    if (spot == null && flip == null && net == null) return null;
    return [
      `**Live positioning (${ticker})**`,
      `- Spot **${fmt(spot, 0)}** · γ-flip **${fmt(flip, 0)}** · net GEX **${fmt(net, 0)}**`,
    ].join("\n");
  }

  if (name === "get_flow_tape") {
    const rows = (d.recent ?? d.flows ?? d.prints) as Array<{ premium?: number; ticker?: string }> | undefined;
    if (!rows?.length) return null;
    const top = [...rows].sort((a, b) => (b.premium ?? 0) - (a.premium ?? 0))[0];
    return `**HELIX live:** top print **$${fmt(top?.premium, 0)}**${top?.ticker ? ` on **${top.ticker}**` : ""}`;
  }

  if (name === "get_spx_structure") {
    const price = d.price;
    const flip = d.gamma_flip;
    if (price == null) return null;
    return `**SPX structure (live):** spot **${fmt(price, 0)}** · γ-flip **${fmt(flip, 0)}** · call wall **${fmt(d.call_wall, 0)}** · put wall **${fmt(d.put_wall, 0)}**`;
  }

  if (name === "get_market_context") {
    const bias = d.bias ?? d.regime;
    return bias ? `**Market context (live):** regime **${String(bias)}**` : null;
  }

  if (name === "get_spx_play") {
    const status = d.status;
    if (!status) return null;
    return `**Slayer engine:** **${String(status).toUpperCase()}**${d.direction ? ` · ${String(d.direction).toUpperCase()}` : ""}${d.entry_price != null ? ` @ **${fmt(d.entry_price, 0)}**` : ""}`;
  }

  return null;
}

async function providerFallback(route: BieRoute, onStatus?: (m: string) => void): Promise<string | null> {
  const sym = toolTicker(route);
  onStatus?.(pickLargoStatusLine({ phase: "enrich", intent: route.intent }));

  if (route.intent === "technical_read" || /\b(rsi|ema|atr|technical)\b/i.test(route.intent)) {
    onStatus?.("Polygon: pulling daily bars + EMA stack…");
    const q = await readPolygon(`/v2/aggs/ticker/I:${sym === "SPX" ? "SPX" : sym}/prev`);
    if (q.ok && q.data) {
      const bar = (q.data as { results?: Array<{ c?: number }> }).results?.[0];
      if (bar?.c) return `**Polygon prev close (${sym}):** **${fmt(bar.c, 2)}**`;
    }
  }

  if (route.intent === "helix_read" || route.intent === "flow_tape") {
    onStatus?.("Unusual Whales: recent flow snapshot…");
    const flow = await readUw(`/api/option-trades/flow-alerts`, { limit: "5", ticker: sym });
    if (flow.ok && Array.isArray(flow.data)) {
      const row = flow.data[0] as { premium?: number; ticker?: string } | undefined;
      if (row?.premium) return `**UW flow alert:** **$${fmt(row.premium, 0)}**${row.ticker ? ` · **${row.ticker}**` : ""}`;
    }
  }

  if (sym === "SPX" && (route.intent === "spx_desk_read" || route.intent === "spx_structure")) {
    onStatus?.("Platform API: SPX desk snapshot…");
    const desk = await callInternalApiRead("/api/market/spx/desk");
    if (desk.ok && desk.data && typeof desk.data === "object") {
      const p = (desk.data as { price?: number }).price;
      if (p) return `**Desk API:** SPX **${fmt(p, 0)}**`;
    }
  }

  return null;
}

/**
 * When a deterministic compose is thin or cold, escalate to live Largo tools +
 * governed provider reads, then merge a concise "**Live refresh**" block.
 */
export async function enrichComposedIfNeeded(
  route: BieRoute,
  composed: BieComposed,
  opts?: EnrichOpts
): Promise<BieComposed> {
  if (!needsLiveEnrichment(route, composed)) return composed;

  const onStatus = opts?.onStatus;
  onStatus?.(pickLargoStatusLine({ phase: "enrich", intent: route.intent }));

  const tools = TOOLS_BY_INTENT[route.intent] ?? [];
  const snippets: string[] = [];
  const enrichContext: unknown[] = [];
  const ticker = toolTicker(route);
  const userId = opts?.userId ?? "bie-enrich";

  for (const tool of tools.slice(0, 3)) {
    onStatus?.(pickLargoStatusLine({ phase: "providers", intent: route.intent }));
    try {
      const result = await runLargoTool(tool, toolInput(tool, route), userId);
      enrichContext.push({ tool, result });
      const snip = snippetFromTool(tool, result, ticker);
      if (snip) snippets.push(snip);
    } catch {
      /* fail-soft — next tool */
    }
  }

  if (!snippets.length) {
    const fallback = await providerFallback(route, onStatus);
    if (fallback) snippets.push(fallback);
  }

  if (!snippets.length) return composed;

  const refresh = ["", "---", "**Live refresh** _(direct wire pull)_", "", ...snippets].join("\n");
  const mergedContext =
    enrichContext.length > 0
      ? { ...(composed.context as object), enrich: enrichContext }
      : composed.context;

  // Replace cold/unavailable opener when we got real numbers.
  let answer = composed.answer;
  if ((composed.context as { missing?: boolean })?.missing) {
    answer = answer.replace(/^[^\n]*(?:cold|unavailable)[^\n]*\n?/i, "");
  }

  return {
    answer: `${answer.trim()}\n${refresh}`,
    context: mergedContext,
    envelope: composed.envelope,
  };
}
