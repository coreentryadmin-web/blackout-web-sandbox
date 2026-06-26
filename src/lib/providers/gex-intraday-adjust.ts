import "server-only";

// ---------------------------------------------------------------------------
// 0DTE / FRONT-EXPIRY INTRADAY-ADJUSTED GEX — server orchestration (cache + bounded I/O).
//
// The PURE math + types live in `gex-intraday-adjust-core.ts` (no server-only, unit-tested). This
// file wires the bounded/cached/rate-limited DATA SOURCES into that math:
//   - OI base: fetchGexHeatmap(ticker) — SHARED cache read (cache-reader; NO second matrix upstream).
//   - Gamma coefficients: fetchFrontExpiryGammaCoeffs(ticker) — ONE bounded front-expiry band, cached.
//   - Intraday flow: fetchOptionTrades(ticker, window, frontExpiry) — bounded+cached+rate-limited tape.
//
// WHY THIS EXISTS (the legitimate gap, decided + documented):
//   The canonical dealer GEX is OPEN-INTEREST-weighted — the industry standard (SpotGamma/Barchart)
//   users cross-reference, so it stays UNCHANGED + PRIMARY. But OI is settled end-of-day, so it is
//   STALE intraday; for the FRONT expiry (0DTE, >50% of SPX option volume) OI is near-zero during
//   the session, so an OI-only view MISSES same-day dealer gamma. This lens mirrors SpotGamma's
//   "OI & Volume Adjustment": keep the OI base, ADD a SEPARATE, clearly-LABELED front-expiry view
//   that nudges the OI GEX by today's not-yet-settled positioning. Canonical fields are NEVER
//   overwritten.
//
// SIGNED vs HEURISTIC (decided — SIGNED, at ZERO extra fan-out):
//   Each front-expiry trade is classified BUY-vs-SELL via the quote rule using the NBBO ALREADY on
//   the discovery snapshot that the Trades reconstruction fetches (option-trades.ts captures
//   last_quote per contract). So signing needs NO per-trade /v3/quotes pull — it is genuine SIGNED
//   net customer flow (gross premium ≠ net dealer positioning) at no marginal cost. The NBBO is a
//   single near-real-time snapshot (not per-trade-nanosecond), so the signing is a BOUNDED estimate
//   — labeled as such. When classification coverage is thin the adjustment shrinks toward 0 and the
//   view degrades to the OI base. Never throws; null on cold/empty inputs.
// ---------------------------------------------------------------------------

import {
  fetchGexHeatmap,
  fetchFrontExpiryGammaCoeffs,
  resolveOptionsRoot,
} from "@/lib/providers/polygon-options-gex";
import { fetchOptionTrades } from "@/lib/providers/option-trades";
import { serverCache, TTL } from "@/lib/server-cache";
import {
  gexIntradayAdjustedFrom,
  type GexIntradayAdjusted,
} from "@/lib/providers/gex-intraday-adjust-core";

export type { GexIntradayAdjusted } from "@/lib/providers/gex-intraday-adjust-core";
export { gexIntradayAdjustedFrom } from "@/lib/providers/gex-intraday-adjust-core";

/** Lookback window (minutes) for the intraday flow used in the adjustment. Env-tunable. */
function windowMin(): number {
  const raw = process.env.GEX_INTRADAY_WINDOW_MIN?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 240; // default: most of the session
}

/**
 * Resolve the 0DTE/front intraday-adjusted GEX view for `ticker`.
 *
 * The whole result is cached (OPTIONS_CHAIN TTL) so concurrent callers collapse to one build per
 * window. Returns null when the OI base is cold/empty — never fabricates. Never throws.
 */
export async function getGexIntradayAdjusted(
  ticker: string
): Promise<GexIntradayAdjusted | null> {
  const { root } = resolveOptionsRoot(ticker);
  if (!root) return null;
  const win = windowMin();

  return serverCache(`gex-intraday-adjusted:${root}:${win}m`, TTL.OPTIONS_CHAIN, async () => {
    // OI base via the SHARED matrix cache (cache-reader — NO second matrix upstream). Its `expiries`
    // axis is ascending, so the FRONT (0DTE / nearest) expiry is the first entry.
    const hm = await fetchGexHeatmap(root).catch(() => null);
    if (!hm || !(hm.spot > 0) || hm.strikes.length === 0) return null;

    const spot = hm.spot;
    const frontExpiry = hm.expiries[0] ?? null;
    if (!frontExpiry) {
      // No front expiry to scope to → emit the OI base unchanged as a degenerate adjusted view.
      return gexIntradayAdjustedFrom(root, hm, null, null, null, spot, win);
    }

    // Gamma coefficients (one bounded front-expiry band, cached) + intraday flow tape (bounded +
    // cached + rate-limited) for the SAME front expiry, in parallel.
    const [coeffs, trades] = await Promise.all([
      fetchFrontExpiryGammaCoeffs(root, frontExpiry).catch(() => null),
      fetchOptionTrades(root, win, frontExpiry).catch(() => null),
    ]);

    return gexIntradayAdjustedFrom(
      root,
      hm,
      trades,
      coeffs?.gammaCoeffByStrike ?? null,
      frontExpiry,
      spot,
      win
    );
  });
}
