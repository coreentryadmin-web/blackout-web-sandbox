/**
 * Massive/Polygon stocks LULD (Limit Up–Limit Down) WebSocket normalizer.
 * @see https://massive.com/docs/stocks/ws_stocks_luld
 */

export type LuldBandEvent = {
  symbol: string;
  high_band: number | null;
  low_band: number | null;
  indicator: number;
  /** null = band update only; true/false = explicit halt/resume */
  active: boolean | null;
  ts: number;
};

/**
 * Map SIP LULD indicator codes to halt state.
 * 1/2 = band approach (informational); 3/5/6 = pause/halt; 4 = reopen.
 */
export function luldIndicatorHaltState(indicator: number): boolean | null {
  if (indicator === 3 || indicator === 5 || indicator === 6) return true;
  if (indicator === 4) return false;
  return null;
}

/** Normalize batched Massive stocks WS messages into LULD band/halt events. */
export function normalizeLuldWsMessages(raw: unknown): LuldBandEvent[] {
  const msgs = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out: LuldBandEvent[] = [];
  const now = Date.now();
  for (const msg of msgs) {
    if (!msg || typeof msg !== "object") continue;
    const row = msg as Record<string, unknown>;
    const ev = String(row.ev ?? "");
    if (ev !== "LULD") continue;
    const symbol = String(row.T ?? row.sym ?? row.ticker ?? "").toUpperCase();
    if (!symbol) continue;
    const indicator = Number(row.i ?? row.indicators ?? 0);
    const high = Number(row.h ?? row.high ?? NaN);
    const low = Number(row.l ?? row.low ?? NaN);
    const tsRaw = Number(row.t ?? row.timestamp ?? 0);
    const ts =
      Number.isFinite(tsRaw) && tsRaw > 0
        ? tsRaw > 1e15
          ? Math.floor(tsRaw / 1_000_000)
          : tsRaw > 1e12
            ? Math.floor(tsRaw / 1000)
            : tsRaw
        : now;
    out.push({
      symbol,
      high_band: Number.isFinite(high) ? high : null,
      low_band: Number.isFinite(low) ? low : null,
      indicator: Number.isFinite(indicator) ? indicator : 0,
      active: luldIndicatorHaltState(Number.isFinite(indicator) ? indicator : 0),
      ts,
    });
  }
  return out;
}
