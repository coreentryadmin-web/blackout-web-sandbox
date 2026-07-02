// Shared response-shaping helper: rounds every fractional number in a
// JSON-serializable value to a fixed number of decimal places before it
// goes out over the wire.
//
// Root cause this fixes: money-math (VWAP/EMA accumulation, GEX/DEX dollar
// sums, price ratios, etc.) produces IEEE-754 floats with 6-13 spurious
// decimal digits (e.g. 7499.360000000001, -12701691969.618551) that were
// being serialized verbatim into API responses across ~16 endpoints. Each
// endpoint computes its numbers via a different code path (ma-math.ts,
// gex-positioning, spx-session, etc.) so fixing this "at the source" would
// mean touching a dozen unrelated arithmetic call sites. Rounding once at
// the response boundary — the actual data layer the client consumes — is
// the single shared fix.
//
// Integers pass through untouched (Number.isInteger short-circuits), so
// epoch-millis timestamps, counts, and IDs are never touched — only genuine
// float noise gets rounded.
export function roundFloats<T>(value: T, dp = 2): T {
  const factor = 10 ** dp;
  const walk = (v: unknown): unknown => {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Number.isInteger(v)) return v;
      return Math.round(v * factor) / factor;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
