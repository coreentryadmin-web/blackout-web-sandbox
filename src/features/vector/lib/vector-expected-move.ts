/**
 * Options-implied EXPECTED MOVE — the ±1σ / ±2σ range the options market is pricing for a horizon
 * (task #15, the cone half; the gamma-magnet half shipped in #153). Pure and deterministic: given a
 * spot, an ATM implied vol, and the time to expiry, it returns the expected-move bands a desk reads
 * as "where price is likely to stay through expiry."
 *
 * Formula (standard desk expected move): a 1σ move over time `t` years is
 *     move₁ = spot · σ · √t          (σ = annualized ATM implied vol, t = DTE_days / 365)
 * and the k·σ band is spot ± k·move₁. This is the Black-Scholes lognormal-diffusion 1σ displacement
 * with the drift term dropped (the market's own convention for a symmetric expected-move quote).
 *
 * Honesty (per repo policy): σ MUST be a real ATM implied vol sourced from the options chain (the
 * server surfaces it — the client walls carry only {strike, pct}); this engine never invents one.
 * Every input is validated and a missing/degenerate input returns `null`, never a fabricated band.
 * The engine is intentionally `window`/`Date`-free so it is fully unit-testable.
 *
 * 0DTE note: at expiry `DTE_days → 0` so the move collapses to 0. For a 0DTE horizon the caller must
 * pass the FRACTION OF THE TRADING DAY REMAINING as `dteDays` (e.g. 3h to close ≈ 3/6.5/… — the
 * intraday session fraction expressed in days), NOT 0. A literal 0/negative/non-finite `dteDays`
 * returns null rather than a meaningless zero-width band.
 */

const TRADING_DAYS_PER_YEAR = 365; // calendar-day annualization — matches the desk expected-move convention.

export type ExpectedMoveBand = {
  /** k in the k·σ band (1, 2, …). */
  sigma: number;
  /** Absolute lower/upper price bound: spot ∓ k·move₁. */
  low: number;
  high: number;
  /** ± points for this band (k·move₁), the "±X pts" a desk quotes. */
  movePts: number;
};

export type ExpectedMove = {
  /** Annualized ATM implied vol used (decimal, e.g. 0.14 = 14%). Real, chain-sourced. */
  atmIv: number;
  /** Time to expiry in days (fractional for 0DTE — the intraday session fraction). */
  dteDays: number;
  spot: number;
  /** 1σ move as a fraction of spot (move₁ / spot) — the headline "expected move %". */
  movePct: number;
  /** Bands sorted ascending by sigma. */
  bands: ExpectedMoveBand[];
};

export type ExpectedMoveInput = {
  spot: number;
  /** Annualized ATM implied vol, decimal (0.14 = 14%). */
  atmIv: number;
  /** Days to expiry; fractional session-remaining for 0DTE. */
  dteDays: number;
};

/**
 * Compute the expected-move bands, or null when any input is missing/degenerate.
 * `sigmas` defaults to [1, 2]; values are sanitized (positive, finite, de-duplicated, ascending).
 */
export function computeExpectedMove(
  input: ExpectedMoveInput,
  sigmas: readonly number[] = [1, 2]
): ExpectedMove | null {
  const { spot, atmIv, dteDays } = input;
  // All three must be real positives — a zero/NaN vol or a 0DTE passed as literal 0 is not a band.
  if (!(spot > 0) || !(atmIv > 0) || !(dteDays > 0)) return null;
  if (!Number.isFinite(spot) || !Number.isFinite(atmIv) || !Number.isFinite(dteDays)) return null;

  const t = dteDays / TRADING_DAYS_PER_YEAR;
  const move1 = spot * atmIv * Math.sqrt(t); // 1σ displacement in price points.
  if (!(move1 > 0) || !Number.isFinite(move1)) return null;

  const cleanSigmas = Array.from(
    new Set(sigmas.filter((k) => Number.isFinite(k) && k > 0))
  ).sort((a, b) => a - b);
  if (cleanSigmas.length === 0) return null;

  const bands: ExpectedMoveBand[] = cleanSigmas.map((k) => {
    const movePts = k * move1;
    return {
      sigma: k,
      movePts,
      // Lower bound floored at 0 — a wide 2σ band on a low-priced name must never quote a negative
      // price (nonsensical), even though the lognormal tail technically can't reach 0.
      low: Math.max(0, spot - movePts),
      high: spot + movePts,
    };
  });

  return { atmIv, dteDays, spot, movePct: move1 / spot, bands };
}

/**
 * Pre-format the expected move into desk-terminal callout lines (newest-consumer style, like
 * `technicalsCallouts`). Empty array when there's nothing real to say. The chart/terminal owns spot,
 * so formatting lives here to keep one source of truth for the wording.
 */
export function expectedMoveCallouts(em: ExpectedMove | null): string[] {
  if (!em || em.bands.length === 0) return [];
  const fmtPts = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const fmtPx = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const lines: string[] = [];
  for (const b of em.bands) {
    const pct = b.sigma === 1 ? ` (${(em.movePct * 100).toFixed(2)}%)` : "";
    lines.push(
      `${b.sigma}σ expected move: ±${fmtPts(b.movePts)} pts${pct} → ${fmtPx(b.low)}–${fmtPx(b.high)}`
    );
  }
  return lines;
}
