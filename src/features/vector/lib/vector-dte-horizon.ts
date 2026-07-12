/**
 * DTE (days-to-expiry) horizon selection for Vector walls — the foundation for
 * timeframe/expiry-aware GEX/VEX walls. Dealer positioning at a 0DTE horizon
 * (today's expiry only) reads very differently from a monthly horizon; a member
 * scalping the open cares about the former, a swing trader the latter. The wall
 * levels the chart draws should reflect the horizon the member is trading, not
 * a single fixed near-term blend.
 *
 * This module is intentionally PURE and dependency-free (no Date.now, no
 * provider imports): `todayYmd` is passed in so the mapping is deterministic and
 * unit-testable, and it operates on the `YYYY-MM-DD` expiry strings the GEX
 * heatmap already returns (sorted ascending).
 */

export type VectorDteHorizon = "0dte" | "weekly" | "monthly" | "all";

/** Display order for the horizon toggle. */
export const VECTOR_DTE_HORIZONS: readonly VectorDteHorizon[] = ["0dte", "weekly", "monthly", "all"];

export const VECTOR_DEFAULT_DTE_HORIZON: VectorDteHorizon = "all";

/** Inclusive DTE ceiling per horizon (calendar days from today). "all" is unbounded. */
const HORIZON_MAX_DTE: Record<Exclude<VectorDteHorizon, "all">, number> = {
  "0dte": 0,
  weekly: 7,
  monthly: 35,
};

/** Short label for the UI toggle. */
export function dteHorizonLabel(h: VectorDteHorizon): string {
  switch (h) {
    case "0dte":
      return "0DTE";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "all":
      return "All";
  }
}

export function isVectorDteHorizon(v: unknown): v is VectorDteHorizon {
  return typeof v === "string" && (VECTOR_DTE_HORIZONS as readonly string[]).includes(v);
}

/** Normalize an untrusted value (e.g. a `?dte=` query param) to a valid horizon. */
export function normalizeDteHorizon(v: unknown): VectorDteHorizon {
  return isVectorDteHorizon(v) ? v : VECTOR_DEFAULT_DTE_HORIZON;
}

/**
 * Choose the value to SHOW for a given horizon: the horizon-scoped value when the
 * member has narrowed the DTE (not "all") AND a scoped value exists, else the live
 * near-term stream value. This is the single rule behind coherence between the walls
 * drawn on the chart and the desk-terminal narration (regime / magnet / proximity /
 * integrity) — every consumer that must "adapt to the DTE selection" routes through
 * this so it can never describe a different scope than the chart shows.
 *
 * Honest fallback: on "all", or when the scoped fetch hasn't landed / yielded nothing
 * (scoped == null), we fall back to the stream value rather than blanking — a narrowed
 * horizon must never make a wall or flip vanish just because its scoped fetch was empty.
 *
 * Pure and generic (works for walls objects and for the numeric gamma flip alike).
 */
export function pickHorizonScopedValue<T>(
  horizon: VectorDteHorizon,
  scoped: T | null | undefined,
  stream: T
): T {
  return horizon !== "all" && scoped != null ? scoped : stream;
}

/** Calendar days from `todayYmd` to `expiryYmd` (expiry − today), or null on a bad date. */
function dteDays(todayYmd: string, expiryYmd: string): number | null {
  const a = Date.parse(`${todayYmd}T00:00:00Z`);
  const b = Date.parse(`${expiryYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Filter a sorted list of `YYYY-MM-DD` expiries to the ones inside `horizon`.
 *
 * Rules:
 *  - Past expiries (dte < 0) are always dropped — a wall on a dead expiry is noise.
 *  - "all" returns every non-expired expiry.
 *  - "0dte"/"weekly"/"monthly" return expiries within the inclusive DTE ceiling.
 *  - HONEST FALLBACK: if a bounded horizon has no matching expiry (e.g. "0dte"
 *    over a weekend when the nearest expiry is Monday), return the single NEAREST
 *    expiry rather than an empty set — walls must never silently vanish because
 *    the requested horizon happened to be empty. Returning empty would blank the
 *    overlay and read as "no dealer positioning", which is wrong.
 */
export function expiriesForHorizon(
  expiries: readonly string[],
  horizon: VectorDteHorizon,
  todayYmd: string
): string[] {
  const live = expiries
    .map((e) => ({ e, dte: dteDays(todayYmd, e) }))
    .filter((x): x is { e: string; dte: number } => x.dte != null && x.dte >= 0)
    .sort((a, b) => a.dte - b.dte);

  if (!live.length) return [];
  if (horizon === "all") return live.map((x) => x.e);

  const maxDte = HORIZON_MAX_DTE[horizon];
  const within = live.filter((x) => x.dte <= maxDte).map((x) => x.e);
  return within.length ? within : [live[0]!.e];
}
