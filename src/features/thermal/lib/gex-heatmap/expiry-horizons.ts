/**
 * Near-term vs far-dated (monthly / quarterly OpEx) horizon split for the Thermal / GEX heatmap.
 *
 * MEMBERSHIP is authoritative from the server payload's `near_term_expiries` — the SAME set the
 * server's `gex.total` / `strike_totals` are built from (polygon-options-gex.ts `buildMetric` →
 * `nearTermKeep`). The client must NOT re-derive near/far membership with a pure 3rd-Friday
 * calendar heuristic (`isMonthlyExpiry`): the server's near set routinely INCLUDES a 3rd-Friday
 * standard-monthly expiry (e.g. the July OpEx `2026-07-17` when it is one of the ~8 nearest
 * expiries the engine keeps), and that column carries the dominant near OpEx gamma. Dropping it
 * from the near subset flips the aggregate NET SIGN — a member reading "Near" then sees net-LONG
 * gamma while dealers are net-SHORT (live 2026-07-14 RTH: SPY server −$1.06B vs client-"Near"
 * +$234M; SPX server +$5.78B vs client-"Near" −$1.44B; SPY All −$580.1M vs "Near" +$591.5M —
 * opposite signs on two footers both labeled "near-term total"). See
 * `resolveNearTermExpiriesForCrossValidation()` (gex-cross-validation-core.ts) for the same
 * "prefer the server near set, never a calendar slice/heuristic" reasoning on the levels side.
 */

/**
 * True when a YYYY-MM-DD is a standard US monthly options expiration (the THIRD FRIDAY). Mirrors
 * the server's `thirdFridayYmd` calendar math. Used ONLY as (a) the legacy fallback classifier
 * for cached payloads that predate `near_term_expiries`, and (b) — deliberately NOT — for
 * membership when a server near set is present. Tolerant: a malformed date → false.
 */
export function isMonthlyExpiry(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return false;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const dow = first.getUTCDay(); // 0=Sun..6=Sat
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  return d === firstFriday + 14; // third Friday
}

/**
 * Split the expiry axis into the near-term set (what the server's Net / `strike_totals` actually
 * sum over) and the far-dated monthly/quarterly OpEx columns (matrix-only, additive context).
 *
 * When the payload carries `near_term_expiries` (the current engine always does), membership is
 * taken VERBATIM from it — an expiry is "near" iff the server put it in that set, so the "Near"
 * preset, the profile walls/flip/anchor, the "Monthly" total, and the matrix "M" badge all agree
 * with the server-authoritative Net. A 3rd-Friday date that the server counts as near therefore
 * STAYS in the near set (and is NOT badged "M") — the monthly-OpEx styling is a pure display
 * overlay that must never move a date out of the near aggregate.
 *
 * Falls back to the `isMonthlyExpiry` 3rd-Friday heuristic ONLY when no server near set is present
 * (legacy caches predating the field, and `emptyHeatmap()` which omits it) — preserving the
 * pre-fix behavior for those payloads rather than collapsing everything into "near".
 *
 * The returned arrays preserve the input `expiries` order.
 */
export function splitExpiryHorizons(
  expiries: readonly string[],
  nearTermExpiries: readonly string[] | undefined | null
): { nearExpiries: string[]; farExpiries: string[] } {
  const nearExpiries: string[] = [];
  const farExpiries: string[] = [];

  if (nearTermExpiries && nearTermExpiries.length > 0) {
    // Authoritative path: server told us exactly which expiries its Net sums over.
    const nearSet = new Set(nearTermExpiries);
    for (const e of expiries) {
      if (nearSet.has(e)) nearExpiries.push(e);
      else farExpiries.push(e);
    }
    return { nearExpiries, farExpiries };
  }

  // Legacy fallback: no server near set on this payload — classify by 3rd-Friday calendar.
  for (const e of expiries) {
    if (isMonthlyExpiry(e)) farExpiries.push(e);
    else nearExpiries.push(e);
  }
  return { nearExpiries, farExpiries };
}
