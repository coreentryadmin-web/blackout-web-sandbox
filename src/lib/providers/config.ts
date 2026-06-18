export function polygonConfigured(): boolean {
  return Boolean(process.env.POLYGON_API_KEY?.trim());
}

export function uwConfigured(): boolean {
  return Boolean(process.env.UW_API_KEY?.trim());
}

export function finnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

/** Finnhub economic calendar is premium-only ($50/mo). Off by default — static macro schedule is used instead. */
export function finnhubEconomicCalendarEnabled(): boolean {
  return process.env.FINNHUB_ECONOMIC_CALENDAR?.trim().toLowerCase() === "1";
}

export function marketDataConfigured(): boolean {
  return polygonConfigured() || uwConfigured() || finnhubConfigured();
}

/** Full SPX desk cache (UW + Polygon). Default 10s — matches client full-desk poll. */
export function deskCacheTtlMs(): number {
  const raw = process.env.SPX_DESK_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 10;
  if (!Number.isFinite(sec) || sec < 0) return 10_000;
  return Math.round(sec * 1000);
}

/** Fast Polygon pulse cache (price, session, internals). Default 1s. */
export function deskPulseCacheTtlMs(): number {
  const raw = process.env.SPX_PULSE_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 1;
  if (!Number.isFinite(sec) || sec < 0) return 1_000;
  return Math.round(sec * 1000);
}

/** Slower pulse structure refresh (EMAs, minute bars, mega-caps). Default 10s. */
export function deskPulseStructureCacheTtlMs(): number {
  const raw = process.env.SPX_PULSE_STRUCTURE_SEC?.trim();
  const sec = raw ? Number(raw) : 10;
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
