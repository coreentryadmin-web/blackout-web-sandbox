export function polygonConfigured(): boolean {
  return Boolean(process.env.POLYGON_API_KEY?.trim());
}

/** Polygon Advanced (Options/Stocks/Indices/Benzinga) — unlimited; prefer over UW for chains, GEX, indices, news. */
export function polygonPrimary(): boolean {
  return polygonConfigured();
}

export function uwConfigured(): boolean {
  return Boolean(process.env.UW_API_KEY?.trim());
}

export function marketDataConfigured(): boolean {
  return polygonConfigured() || uwConfigured();
}

/** Full SPX desk cache (UW + Polygon). Default 20s — SWR serves stale while revalidating. */
export function deskCacheTtlMs(): number {
  const raw = process.env.SPX_DESK_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 20;
  if (!Number.isFinite(sec) || sec < 0) return 20_000;
  return Math.round(sec * 1000);
}

/** Hard cap on UW flow-alerts fetch during cold desk build (sticky tape covers gaps). */
export function deskFlowRaceMs(): number {
  const raw = process.env.SPX_DESK_FLOW_RACE_MS?.trim();
  const ms = raw ? Number(raw) : 2500;
  if (!Number.isFinite(ms) || ms < 500) return 2500;
  return Math.round(ms);
}

/** Fast Polygon pulse cache (price, session, internals). Default 1s. */
export function deskPulseCacheTtlMs(): number {
  const raw = process.env.SPX_PULSE_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 1;
  if (!Number.isFinite(sec) || sec < 0) return 1_000;
  return Math.round(sec * 1000);
}

/** Slower pulse structure refresh (EMAs, minute bars, mega-caps). Default 5s with live Polygon. */
export function deskPulseStructureCacheTtlMs(): number {
  const raw = process.env.SPX_PULSE_STRUCTURE_SEC?.trim();
  const sec = raw ? Number(raw) : 5;
  if (!Number.isFinite(sec) || sec < 0) return 10_000;
  return Math.round(sec * 1000);
}

/** UW flow lane cache (tape + GEX strikes). Default 2s. */
export function deskFlowCacheTtlMs(): number {
  const raw = process.env.SPX_FLOW_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 2;
  if (!Number.isFinite(sec) || sec < 0) return 2_000;
  return Math.round(sec * 1000);
}

/** Optional merge from engine /spx/state. Off by default — website owns live desk data. */
export function engineIntelOverlayEnabled(): boolean {
  return process.env.ENGINE_INTEL_OVERLAY?.trim().toLowerCase() === "1";
}
