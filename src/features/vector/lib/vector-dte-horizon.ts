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

/** Normalize an untrusted value (e.g. a `?dte=` query param) to a valid horizon.
 * Case-insensitive: the UI labels shout "0DTE"/"WEEKLY", so callers naturally pass uppercase —
 * and the old exact-match check silently re-scoped "0DTE" to the DEFAULT ("all"), which the
 * wall-history route answers with an empty rail by contract. Caught when the hardcore harness
 * made exactly that mistake; normalize case here so no consumer can repeat it. */
export function normalizeDteHorizon(v: unknown): VectorDteHorizon {
  const lowered = typeof v === "string" ? v.toLowerCase() : v;
  return isVectorDteHorizon(lowered) ? lowered : VECTOR_DEFAULT_DTE_HORIZON;
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

/** Result of scoping expiries to a horizon, WITH the honesty signal the UI needs (P1-B). */
export type HorizonExpiryResolution = {
  /** The expiries to use (never empty unless there are no live expiries at all). */
  expiries: string[];
  /**
   * True when a BOUNDED horizon had NO expiry inside its window and we fell back to the single
   * nearest live expiry (e.g. "0DTE" requested on a Tuesday for a name whose nearest chain is
   * Wednesday). The fallback keeps walls from vanishing, but the caller MUST surface it — rendering
   * the nearest expiry's ladder silently labeled "0DTE" shows members the wrong expiry's dealer
   * positioning (live sweep: TSLA/NVDA "0DTE" drew a full 07-15 ladder with no signal).
   */
  isFallback: boolean;
  /** The nearest expiry actually shown when `isFallback` (else null). */
  fallbackExpiry: string | null;
};

/**
 * Scope a sorted list of `YYYY-MM-DD` expiries to `horizon`, reporting whether the result is an
 * honest in-window match or a nearest-expiry FALLBACK.
 *
 * Rules:
 *  - Past expiries (dte < 0) are always dropped — a wall on a dead expiry is noise.
 *  - "all" returns every non-expired expiry (never a fallback).
 *  - "0dte"/"weekly"/"monthly" return expiries within the inclusive DTE ceiling.
 *  - HONEST FALLBACK: if a bounded horizon has no matching expiry, return the single NEAREST expiry
 *    (so walls never silently blank) but flag `isFallback` + `fallbackExpiry` so the UI can label it
 *    honestly ("no 0DTE — showing 07-15") instead of mislabeling it as the requested horizon.
 */
export function resolveHorizonExpiries(
  expiries: readonly string[],
  horizon: VectorDteHorizon,
  todayYmd: string
): HorizonExpiryResolution {
  const live = expiries
    .map((e) => ({ e, dte: dteDays(todayYmd, e) }))
    .filter((x): x is { e: string; dte: number } => x.dte != null && x.dte >= 0)
    .sort((a, b) => a.dte - b.dte);

  if (!live.length) return { expiries: [], isFallback: false, fallbackExpiry: null };
  if (horizon === "all") return { expiries: live.map((x) => x.e), isFallback: false, fallbackExpiry: null };

  const maxDte = HORIZON_MAX_DTE[horizon];
  const within = live.filter((x) => x.dte <= maxDte).map((x) => x.e);
  if (within.length) return { expiries: within, isFallback: false, fallbackExpiry: null };
  const nearest = live[0]!.e;
  return { expiries: [nearest], isFallback: true, fallbackExpiry: nearest };
}

/**
 * Filter a sorted list of `YYYY-MM-DD` expiries to the ones inside `horizon` (just the array —
 * delegates to {@link resolveHorizonExpiries}). Kept as the stable signature for every existing
 * consumer that only needs the expiry set; callers that must render an honest scope label use
 * resolveHorizonExpiries directly.
 */
export function expiriesForHorizon(
  expiries: readonly string[],
  horizon: VectorDteHorizon,
  todayYmd: string
): string[] {
  return resolveHorizonExpiries(expiries, horizon, todayYmd).expiries;
}

/** Compact ET-safe "MON D" render of a `YYYY-MM-DD` expiry (expiry is a bare calendar date — parse
 *  as UTC so it never drifts a day across time zones). Returns the raw string on a bad date. */
export function formatExpiryShort(ymd: string): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return ymd;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(ms)
  );
}

/**
 * The honest short scope label for the GEX ladder / chart header. Normally just the horizon name
 * ("0DTE" / "Weekly" / "near-term"), but when the horizon FELL BACK to the nearest expiry it reads
 * e.g. "no 0DTE · Jul 15" so members never mistake a 07-15 ladder for today's 0DTE (P1-B).
 */
export function horizonScopeShortLabel(
  horizon: VectorDteHorizon,
  scope?: { isFallback?: boolean; fallbackExpiry?: string | null } | null
): string {
  const base = horizon === "all" ? "near-term" : dteHorizonLabel(horizon);
  if (horizon === "all" || !scope?.isFallback || !scope.fallbackExpiry) return base;
  return `no ${dteHorizonLabel(horizon)} · ${formatExpiryShort(scope.fallbackExpiry)}`;
}
