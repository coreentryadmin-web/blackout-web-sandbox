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

  // Crown the kings on the FULL cleaned set — BEFORE banding — and remember the entries so they can
  // be force-retained below. Crowning after the trim let the panel's ⚑ disagree with the banner and
  // the chart's king anchor whenever the true wall sat just outside the nearest-N band (caught live:
  // SPX banner/chart put wall 7475 vs panel king 7480 with a [7480,7675] band). The three surfaces
  // read the same structure, so the panel must crown — and show — the same strikes.
  let fullCallKing: { strike: number; gex: number } | null = null;
  let fullPutKing: { strike: number; gex: number } | null = null;
  const spotForTie = spot != null && Number.isFinite(spot) && spot > 0 ? spot : null;
  // Strictly-stronger wins; exact-|gex| ties crown the strike NEAREST spot (the tradable one), so a
  // tie can never drag an arbitrary far-OTM strike into the panel via the force-retain below.
  const beats = (cand: { strike: number; gex: number }, cur: { strike: number; gex: number } | null) => {
    if (!cur) return true;
    const a = Math.abs(cand.gex), b = Math.abs(cur.gex);
    if (a !== b) return a > b;
    return spotForTie != null && Math.abs(cand.strike - spotForTie) < Math.abs(cur.strike - spotForTie);
  };
  for (const e of entries) {
    if (e.gex > 0) {
      if (beats(e, fullCallKing)) fullCallKing = e;
    } else if (beats(e, fullPutKing)) fullPutKing = e;
  }

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

  // Force-retain the full-set kings through the band/cap: a king that fell outside is re-inserted,
  // evicting the weakest claim (farthest-from-spot non-king row, or the smallest |gex| without a
  // spot) so the row count stays capped and the panel ALWAYS shows the same walls the banner and
  // the chart anchor cite.
  const kingCallStrike = fullCallKing?.strike ?? null;
  const kingPutStrike = fullPutKing?.strike ?? null;
  for (const king of [fullCallKing, fullPutKing]) {
    if (!king || entries.some((e) => e.strike === king.strike)) continue;
    entries.push(king);
    if (entries.length > maxRows) {
      let evict = -1;
      let worst = -Infinity;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        if (e.strike === kingCallStrike || e.strike === kingPutStrike) continue;
        const score = spotForTie != null ? Math.abs(e.strike - spotForTie) : -Math.abs(e.gex);
        if (score > worst) {
          worst = score;
          evict = i;
        }
      }
      if (evict >= 0) entries.splice(evict, 1);
    }
  }

  let maxAbs = 0;
  for (const e of entries) {
    const abs = Math.abs(e.gex);
    if (abs > maxAbs) maxAbs = abs;
  }

  const rows: GexLadderRow[] = entries
    .map((e) => ({
      strike: e.strike,
      gex: e.gex,
      side: (e.gex > 0 ? "call" : "put") as GexLadderSide,
      magnitude: maxAbs > 0 ? Math.abs(e.gex) / maxAbs : 0,
      // Crowned on the FULL set (side-checked so a strike shared across signs can't double-crown).
      isKing: (e.gex > 0 && e.strike === kingCallStrike) || (e.gex < 0 && e.strike === kingPutStrike),
    }))
    .sort((a, b) => b.strike - a.strike);

  return { spot, rows, maxAbs };
}
