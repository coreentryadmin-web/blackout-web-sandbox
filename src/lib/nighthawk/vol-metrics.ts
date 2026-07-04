function sortRowsByDateDesc(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const da = String(a.date ?? a.as_of ?? a.timestamp ?? a.trading_date ?? "");
    const db = String(b.date ?? b.as_of ?? b.timestamp ?? b.trading_date ?? "");
    return db.localeCompare(da);
  });
}

function rowNumeric(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = Number(row[k]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

export function parseLatestRealizedVol(rows: Record<string, unknown>[]): number | null {
  const latest = sortRowsByDateDesc(rows)[0];
  if (!latest) return null;
  const val = rowNumeric(latest, [
    "realized_volatility",
    "realized_vol",
    "rv",
    "value",
    "volatility",
    "vol",
  ]);
  return val != null && val > 0 ? val : null;
}

/** UW historical risk-reversal skew — positive puts bid over calls (fear). */
export function parseLatestRiskReversalSkew(rows: Record<string, unknown>[]): number | null {
  const latest = sortRowsByDateDesc(rows)[0];
  if (!latest) return null;
  return rowNumeric(latest, ["skew", "risk_reversal_skew", "risk_reversal", "rr_skew", "value"]);
}

/**
 * The raw latest-by-date row itself (not just one parsed field) — pairs with
 * parseLatestRealizedVol/parseLatestRiskReversalSkew/parseLatestImpliedVol, all of which
 * extract a single number from this exact same "latest" row. Callers that also need
 * row-level context the single-field parsers discard (e.g. the row's own `date`, for a
 * staleness check against `now` — see src/lib/spx-signals-shadow-skew.ts) call this
 * instead of re-implementing sortRowsByDateDesc themselves.
 */
export function latestRow(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  return sortRowsByDateDesc(rows)[0] ?? null;
}

/**
 * UW's `/api/stock/{ticker}/volatility/realized` rows carry BOTH `realized_volatility` AND
 * `implied_volatility` side by side per date (confirmed via a live pull against SPX/SPY on
 * 2026-07-04 — e.g. `{"date":"2025-07-03","implied_volatility":"0.131000","realized_volatility":"0.087404"}`).
 * parseLatestRealizedVol above only ever read the realized side; this sibling reads the
 * implied side from the SAME already-fetched rows so a realized-vs-implied comparison needs
 * no second UW call.
 */
export function parseLatestImpliedVol(rows: Record<string, unknown>[]): number | null {
  const latest = sortRowsByDateDesc(rows)[0];
  if (!latest) return null;
  const val = rowNumeric(latest, [
    "implied_volatility",
    "implied_vol",
    "iv",
    "iv_30d",
    "value",
  ]);
  return val != null && val > 0 ? val : null;
}
