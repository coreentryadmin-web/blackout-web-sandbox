/**
 * Client-safe desk merge — do NOT import spx-desk.ts from client components
 * (it pulls Polygon/UW server providers into the browser bundle).
 */
import type { SpxDeskLevel, SpxDeskPayload, SpxDeskPulse, SpxDeskFlow, SpxTapeItem } from "@/lib/providers/spx-desk";
import type { GexWall } from "@/lib/providers/gamma-desk";
import { distancePct } from "@/lib/providers/spx-session";

export function recalcGexWallDistances(walls: GexWall[], spot: number): GexWall[] {
  if (!walls.length || spot <= 0) return walls;
  return walls.map((w) => ({
    ...w,
    distance_pts: Math.round((w.strike - spot) * 100) / 100,
  }));
}

export function mergeTapeItems(
  incoming: SpxTapeItem[],
  prev: SpxTapeItem[],
  max = 32
): SpxTapeItem[] {
  const seen = new Set<string>();
  const out: SpxTapeItem[] = [];
  for (const t of [...incoming, ...prev]) {
    const key = `${t.kind}|${t.time}|${t.label}|${t.premium}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

export function flowAlertToTapeItem(alert: {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  direction: string;
  alerted_at: string;
}): SpxTapeItem {
  const isPut = alert.option_type.toUpperCase().startsWith("P");
  return {
    kind: "flow",
    side: isPut ? "put" : "call",
    time: alert.alerted_at,
    label: `${isPut ? "PUT" : "CALL"} ${alert.strike}`,
    premium: alert.premium,
    detail: `${alert.ticker} · ${alert.direction}`,
  };
}

function level(
  label: string,
  value: number | null,
  price: number,
  kind: "support" | "resistance" | "neutral" = "neutral"
): SpxDeskLevel {
  return { label, value, kind, distance_pct: distancePct(price, value) };
}

function buildLevels(input: {
  price: number;
  lod: number | null;
  hod: number | null;
  vwap: number | null;
  pdh: number | null;
  pdl: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
}): SpxDeskLevel[] {
  const p = input.price;
  const items: SpxDeskLevel[] = [
    level("HOD", input.hod, p, "resistance"),
    level("PDH", input.pdh, p, "resistance"),
    level("GEX King", input.gex_king, p, "resistance"),
    level("Max Pain", input.max_pain, p, "neutral"),
    level("γ Flip", input.gamma_flip, p, "neutral"),
    level("EMA 20", input.ema20, p, "neutral"),
    level("VWAP", input.vwap, p, "neutral"),
    level("EMA 50", input.ema50, p, "neutral"),
    level("SMA 50", input.sma50, p, "neutral"),
    level("EMA 200", input.ema200, p, "neutral"),
    level("SMA 200", input.sma200, p, "neutral"),
    level("PDL", input.pdl, p, "support"),
    level("LOD", input.lod, p, "support"),
  ].filter((l) => l.value != null);

  return items.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** Overlay UW flow lane — tape, dark pool, GEX walls. */
export function mergeFlowIntoDesk(base: SpxDeskPayload, flow: SpxDeskFlow): SpxDeskPayload {
  const price = flow.price || base.price;
  const walls = flow.gex_walls.length ? flow.gex_walls : base.gex_walls;
  return {
    ...base,
    polled_at: flow.polled_at,
    dark_pool: flow.dark_pool ?? base.dark_pool,
    spx_flows: flow.spx_flows.length ? flow.spx_flows : base.spx_flows,
    unified_tape: flow.unified_tape.length ? flow.unified_tape : base.unified_tape,
    gex_walls: recalcGexWallDistances(walls, price),
    gex_net: flow.gex_net ?? base.gex_net,
    gex_king: flow.gex_king ?? base.gex_king,
    gamma_flip: flow.gamma_flip ?? base.gamma_flip,
    above_gamma_flip: flow.above_gamma_flip,
    gamma_regime: flow.gamma_regime ?? base.gamma_regime,
    flow_0dte_call_premium: flow.flow_0dte_call_premium ?? base.flow_0dte_call_premium,
    flow_0dte_put_premium: flow.flow_0dte_put_premium ?? base.flow_0dte_put_premium,
    flow_0dte_net: flow.flow_0dte_net ?? base.flow_0dte_net,
    price,
    levels: buildLevels({
      price,
      lod: base.lod,
      hod: base.hod,
      vwap: base.vwap,
      pdh: base.pdh,
      pdl: base.pdl,
      ema20: base.ema20,
      ema50: base.ema50,
      ema200: base.ema200,
      sma50: base.sma50,
      sma200: base.sma200,
      gex_king: flow.gex_king ?? base.gex_king,
      max_pain: base.max_pain,
      gamma_flip: flow.gamma_flip ?? base.gamma_flip,
    }),
  };
}

/** Overlay fast Polygon pulse — price/session only (does not touch tape or GEX). */
export function mergePulseIntoDesk(
  base: SpxDeskPayload,
  pulse: SpxDeskPulse
): SpxDeskPayload {
  const price = pulse.price || base.price;
  return {
    ...base,
    price,
    spx_change_pct: pulse.spx_change_pct,
    vix: pulse.vix,
    vix_change_pct: pulse.vix_change_pct,
    above_vwap: pulse.above_vwap,
    lod: pulse.lod ?? base.lod,
    hod: pulse.hod ?? base.hod,
    vwap: pulse.vwap ?? base.vwap,
    pdh: pulse.pdh ?? base.pdh,
    pdl: pulse.pdl ?? base.pdl,
    ema20: pulse.ema20 ?? base.ema20,
    ema50: pulse.ema50 ?? base.ema50,
    ema200: pulse.ema200 ?? base.ema200,
    sma50: pulse.sma50 ?? base.sma50,
    sma200: pulse.sma200 ?? base.sma200,
    tick: pulse.tick ?? base.tick,
    trin: pulse.trin ?? base.trin,
    add: pulse.add ?? base.add,
    regime: pulse.regime ?? base.regime,
    leader_stocks: pulse.leader_stocks.length ? pulse.leader_stocks : base.leader_stocks,
    vix_term: pulse.vix_term ?? base.vix_term,
    as_of: pulse.polled_at,
    polled_at: pulse.polled_at,
    gex_walls: recalcGexWallDistances(base.gex_walls, price),
    levels: buildLevels({
      price,
      lod: pulse.lod ?? base.lod,
      hod: pulse.hod ?? base.hod,
      vwap: pulse.vwap ?? base.vwap,
      pdh: pulse.pdh ?? base.pdh,
      pdl: pulse.pdl ?? base.pdl,
      ema20: pulse.ema20 ?? base.ema20,
      ema50: pulse.ema50 ?? base.ema50,
      ema200: pulse.ema200 ?? base.ema200,
      sma50: pulse.sma50 ?? base.sma50,
      sma200: pulse.sma200 ?? base.sma200,
      gex_king: base.gex_king,
      max_pain: base.max_pain,
      gamma_flip: base.gamma_flip,
    }),
  };
}
