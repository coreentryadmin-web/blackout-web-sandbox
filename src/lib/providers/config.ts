export function polygonConfigured(): boolean {
  return Boolean(process.env.POLYGON_API_KEY?.trim());
}

export function uwConfigured(): boolean {
  return Boolean(process.env.UW_API_KEY?.trim());
}

export function finnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

export function marketDataConfigured(): boolean {
  return polygonConfigured() || uwConfigured() || finnhubConfigured();
}

/** SPX desk in-memory cache TTL (ms). Default 4s — keep at or below client poll interval. */
export function deskCacheTtlMs(): number {
  const raw = process.env.SPX_DESK_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 4;
  if (!Number.isFinite(sec) || sec < 0) return 4_000;
  return Math.round(sec * 1000);
}

/** Optional merge from engine /spx/state. Off by default — website owns live desk data. */
export function engineIntelOverlayEnabled(): boolean {
  return process.env.ENGINE_INTEL_OVERLAY?.trim().toLowerCase() === "1";
}
