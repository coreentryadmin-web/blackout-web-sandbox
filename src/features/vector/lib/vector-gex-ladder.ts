/**
 * Per-strike GEX ladder — the data behind the Vector "strike ladder" side panel (the dense
 * per-strike net-GEX column a member scans alongside the chart, the Skylit-Atlas parity view).
 *
 * The chart's beads collapse each strike to a single dot at its price; the ladder instead shows
 * EVERY strike near spot with its signed net gamma exposure and relative magnitude, so a member
 * reads the whole gamma structure at a glance — where the fat walls sit, where the thin ones are,
 * and which strike is the single dominant "king" per side.
 *
 * Pure and dependency-free: it takes the raw `strike_totals` record (strike → signed net GEX, the
 * exact map `GexHeatmap.gex.strike_totals` / the per-expiry chain ladder already produce) and the
 * spot, and returns display-ready rows. Sign convention matches `computeGexWalls`: net GEX > 0 is a
 * call/positive-gamma strike (resistance), < 0 is a put/negative-gamma strike (support).
 */

export type GexLadderSide = "call" | "put";

export type GexLadderRow = {
  strike: number;
  /** Signed net GEX at this strike (raw provider value, positive = call/resistance). */
  gex: number;
  side: GexLadderSide;
  /** |gex| / maxAbs in [0,1] — drives bar width / colour intensity in the panel. */
  magnitude: number;
  /** Strongest strike on its own side (the call king / put king). */
  isKing: boolean;
};

export type GexLadder = {
  spot: number | null;
  /** Rows sorted DESCENDING by strike (highest on top, matching a price axis / Skylit ladder). */
  rows: GexLadderRow[];
  /** Largest |gex| across all rows — the normaliser behind every row's `magnitude`. */
  maxAbs: number;
};

export type BuildGexLadderOpts = {
  /** Max rows to keep (nearest-to-spot wins when the band has more). Default 40. */
  maxRows?: number;
  /**
   * Half-width of the strike band to keep, as a fraction of spot (e.g. 0.08 = ±8%). Applied only
   * when spot is known. Default 0.08 — wide enough to show the structure a member trades around,
   * tight enough to drop far-OTM noise. `maxRows` still caps the result after banding.
   */
  bandPct?: number;
};

const EMPTY: GexLadder = { spot: null, rows: [], maxAbs: 0 };

/**
 * Build the display-ready GEX ladder from a `{strike: netGex}` record.
 *
 * Steps: parse & clean (finite strike/gex, drop exact-zero strikes) → band around spot (when spot
 * is known) → keep the `maxRows` strikes NEAREST spot if still over cap (so the panel always shows
 * the tradable core, never an arbitrary head/tail slice) → tag each row's side, relative magnitude,
 * and the per-side king → sort descending by strike. Returns an empty ladder (never throws) for a
 * missing/empty record so the caller can render a graceful empty state.
 */
export function buildGexLadder(
  strikeTotals: Record<string, number> | null | undefined,
  spot: number | null,
  opts: BuildGexLadderOpts = {}
): GexLadder {
  if (!strikeTotals) return { ...EMPTY, spot };
  const { maxRows = 40, bandPct = 0.08 } = opts;

  let entries: Array<{ strike: number; gex: number }> = [];
  for (const [key, value] of Object.entries(strikeTotals)) {
    const strike = Number(key);
    // Drop non-finite and exact-zero strikes — a 0 net-GEX strike is not a wall and would only
    // dilute the ladder / skew the "nearest N" selection with empty rows.
    if (!Number.isFinite(strike) || !Number.isFinite(value) || value === 0) continue;
    entries.push({ strike, gex: value });
  }
  if (entries.length === 0) return { ...EMPTY, spot };

  // Band + nearest-to-spot cap, both keyed to spot so the panel centres on the tradable strikes.
  if (spot != null && Number.isFinite(spot) && spot > 0) {
    const halfBand = spot * bandPct;
    const banded = entries.filter((e) => Math.abs(e.strike - spot) <= halfBand);
    // Never blank the panel: if the band excluded everything (spot far from the chain, thin name),
    // fall back to the unbanded set and let the nearest-N cap below do the trimming.
    if (banded.length > 0) entries = banded;
    if (entries.length > maxRows) {
      entries.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
      entries = entries.slice(0, maxRows);
    }
  } else if (entries.length > maxRows) {
    // No spot: keep the maxRows strongest by |gex| (best-effort — can't centre without spot).
    entries.sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex));
    entries = entries.slice(0, maxRows);
  }

  let maxAbs = 0;
  let kingCallStrike: number | null = null;
  let kingCallAbs = 0;
  let kingPutStrike: number | null = null;
  let kingPutAbs = 0;
  for (const e of entries) {
    const abs = Math.abs(e.gex);
    if (abs > maxAbs) maxAbs = abs;
    if (e.gex > 0) {
      if (abs > kingCallAbs) {
        kingCallAbs = abs;
        kingCallStrike = e.strike;
      }
    } else if (abs > kingPutAbs) {
      kingPutAbs = abs;
      kingPutStrike = e.strike;
    }
  }

  const rows: GexLadderRow[] = entries
    .map((e) => ({
      strike: e.strike,
      gex: e.gex,
      side: (e.gex > 0 ? "call" : "put") as GexLadderSide,
      magnitude: maxAbs > 0 ? Math.abs(e.gex) / maxAbs : 0,
      isKing: e.strike === kingCallStrike || e.strike === kingPutStrike,
    }))
    .sort((a, b) => b.strike - a.strike);

  return { spot, rows, maxAbs };
}
