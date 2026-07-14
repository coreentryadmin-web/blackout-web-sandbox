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
  /**
   * Max rows to keep (nearest-to-spot wins when the band has more). Default 200 — a DENSE ladder:
   * a member wants every material strike Skylit shows, not a tight near-money slice. 200 covers the
   * entire fetched chain for any normally-priced name (a low-priced name's whole chain is a few
   * dozen strikes; even SPX's 5-point strikes give a dense ±6-7% near-money window at 200 rows,
   * with the fatter far walls still force-retained by `keepPerSide`). The list scrolls, so a long
   * ladder is a feature, not a layout problem.
   */
  maxRows?: number;
  /**
   * Half-width of the strike band to keep, as a fraction of spot (e.g. 0.50 = ±50%). Applied only
   * when spot is known. Default 0.50 — deliberately GENEROUS so the display band is NOT the density
   * limiter: the upstream chain fetch already bands the traded range to [spot·0.7, spot·1.35]
   * (−30%/+35%), so a ±50% display window shows every strike that range carries and only trims a
   * true far-tail artifact. (This replaced the old ±8% window, which — compounded by a 40-row cap —
   * dropped fat walls and whole runs of real-OI strikes on low-priced / high-dispersion names: FIG
   * at spot ~23 showed ~11 strikes where Skylit showed the full ~30-strike chain. See
   * docs/audit/FINDINGS.md.) `maxRows` (nearest-to-spot) is the real bound now, not this band.
   */
  bandPct?: number;
  /**
   * How many of the STRONGEST walls PER SIDE to force-retain through the band/cap (default 3). The
   * per-side king (top-1) plus its runners-up: without this, the ±bandPct display window silently
   * drops a fat wall that sits just outside it on a low-priced / high-dispersion name — e.g. FIG at
   * spot ~23 has a +$650K call wall at strike 30 (OI 47k) that ±8% ([21.3,25.1]) excludes, so the
   * panel showed no resistance where the real gamma wall was. Only the single king was retained
   * before; the runners-up are equally tradable structure a member scans the ladder to see. Bounded
   * by `maxRows` (farthest-from-spot NON-retained rows are evicted to stay under cap).
   */
  keepPerSide?: number;
  /**
   * Canonical wall strikes to CROWN as the per-side king (⚑), overriding the ladder's own
   * max-|gex| pick. When provided (finite), the row at that strike on the matching side is crowned
   * instead of the strongest strike in THIS ladder's data.
   *
   * Why this exists — cross-surface truth: the ladder renders the OI-signed per-strike net-GEX
   * (`getHorizonStrikeTotals`), but the banner's resistance/support, the chart's wall line, and the
   * desk terminal all cite the CANONICAL walls (`getVectorGexWallsForHorizon` → `computeGexWalls`
   * over the VOLUME-ADJUSTED ladder for a narrowed horizon, or the warm near-term aggregate for
   * "all"). Those two ladders diverge on index-scale names with heavy 0DTE volume: e.g. live SPX
   * weekly, the OI ladder's biggest put |gex| is a deep-ITM 8000 strike (ABOVE spot — nonsense as
   * "support") while the real put wall is 7475; and SPX "all" crowned 7600/7300 vs the banner's
   * 7550/7400. The DISPLAY stays fully dense (every OI strike + its true magnitude bar) — only the
   * ⚑ crown moves to the strike the other three surfaces already cite, so all four AGREE. When the
   * override strike isn't present on the matching side in this ladder's rows (sign disagreement /
   * strike absent), we fall back to the ladder's own computed king so there is always exactly one
   * king per side. Omit (the BIE full-state + client seed do) to keep the pure self-crowned behavior.
   */
  kingStrikes?: { call?: number | null; put?: number | null };
};

/** Default strongest-walls-per-side kept through the band (king + 2 runners-up each side). */
const DEFAULT_KEEP_PER_SIDE = 3;

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
  const { maxRows = 200, bandPct = 0.5, keepPerSide = DEFAULT_KEEP_PER_SIDE, kingStrikes } = opts;

  let entries: Array<{ strike: number; gex: number }> = [];
  for (const [key, value] of Object.entries(strikeTotals)) {
    const strike = Number(key);
    // Drop non-finite and exact-zero strikes — a 0 net-GEX strike is not a wall and would only
    // dilute the ladder / skew the "nearest N" selection with empty rows.
    if (!Number.isFinite(strike) || !Number.isFinite(value) || value === 0) continue;
    entries.push({ strike, gex: value });
  }
  if (entries.length === 0) return { ...EMPTY, spot };

  // Rank the strongest walls PER SIDE on the FULL cleaned set — BEFORE banding — so the top-N per
  // side can be force-retained below. Ranking (and crowning) after the trim let the panel's ⚑
  // disagree with the banner and the chart's king anchor whenever the true wall sat just outside the
  // nearest-N band (caught live: SPX banner/chart put wall 7475 vs panel king 7480 with a
  // [7480,7675] band). The three surfaces read the same structure, so the panel must crown — and
  // show — the same strikes. We keep the top `keepPerSide` per side (not just the single king)
  // because a low-priced / high-dispersion name parks a fat runner-up wall OUTSIDE the ±bandPct
  // window (FIG spot ~23: +$650K call wall at strike 30, ±8% band only [21.3,25.1]) that a member
  // needs to see — the king alone hid it.
  const spotForTie = spot != null && Number.isFinite(spot) && spot > 0 ? spot : null;
  // Strongest first; exact-|gex| ties order the strike NEAREST spot first (the tradable one), so a
  // tie can never drag an arbitrary far-OTM strike into the panel via the force-retain below.
  const byStrength = (a: { strike: number; gex: number }, b: { strike: number; gex: number }) => {
    const av = Math.abs(a.gex), bv = Math.abs(b.gex);
    if (av !== bv) return bv - av;
    if (spotForTie == null) return 0;
    return Math.abs(a.strike - spotForTie) - Math.abs(b.strike - spotForTie);
  };
  const keepN = Math.max(1, Math.floor(keepPerSide));
  const callWalls = entries.filter((e) => e.gex > 0).sort(byStrength).slice(0, keepN);
  const putWalls = entries.filter((e) => e.gex < 0).sort(byStrength).slice(0, keepN);
  // Kings stay the single strongest per side (top-1) — the ⚑ crown is unchanged; only the SET of
  // force-retained walls widened.
  const fullCallKing = callWalls[0] ?? null;
  const fullPutKing = putWalls[0] ?? null;
  // Every wall (king + runners-up, both sides) that must survive the band/cap, globally strongest
  // first and capped to `maxRows` so the retain set can never itself overflow the row cap (e.g. a
  // tiny maxRows with keepPerSide runners-up on both sides). Kings computed above are unaffected.
  const retainWalls = [...callWalls, ...putWalls].sort(byStrength).slice(0, maxRows);
  const retainStrikes = new Set(retainWalls.map((w) => w.strike));

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

  // Force-retain the full-set top-N walls (king + runners-up, both sides) through the band/cap: any
  // wall that fell outside is re-inserted, evicting the weakest claim (farthest-from-spot NON-wall
  // row, or the smallest |gex| without a spot) so the row count stays capped and the panel ALWAYS
  // shows the same walls the banner and the chart anchor cite — plus the material runner-up walls a
  // ±bandPct window would otherwise hide on a low-priced / high-dispersion name.
  const kingCallStrike = fullCallKing?.strike ?? null;
  const kingPutStrike = fullPutKing?.strike ?? null;
  for (const wall of retainWalls) {
    if (entries.some((e) => e.strike === wall.strike)) continue;
    entries.push(wall);
    if (entries.length > maxRows) {
      let evict = -1;
      let worst = -Infinity;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        // Never evict a retained wall (king OR runner-up) to make room for another one.
        if (retainStrikes.has(e.strike)) continue;
        const score = spotForTie != null ? Math.abs(e.strike - spotForTie) : -Math.abs(e.gex);
        if (score > worst) {
          worst = score;
          evict = i;
        }
      }
      // Evict the weakest non-retained row; if EVERY row is retained (no evictable), revert this
      // push so the `maxRows` cap always holds. (`retainWalls` is capped to maxRows above, so the
      // strongest walls are the ones kept in that degenerate case.)
      if (evict >= 0) entries.splice(evict, 1);
      else entries.pop();
    }
  }

  let maxAbs = 0;
  for (const e of entries) {
    const abs = Math.abs(e.gex);
    if (abs > maxAbs) maxAbs = abs;
  }

  // Resolve the crowned king per side. Default is the ladder's own full-set max-|gex| strike. When
  // the caller passes canonical wall strikes (`kingStrikes` — the SAME walls the banner / chart line
  // / desk terminal cite), crown THOSE so all four surfaces agree — but ONLY when the override strike
  // is actually present on the matching side in the displayed rows (finite + a row with that strike
  // AND the correct sign). If it isn't (the canonical wall's sign disagrees with the OI ladder at
  // that strike, or the strike isn't in the fetched chain), fall back to the self-crowned king, so
  // there is ALWAYS exactly one king per side and the ⚑ never lands on a strike the panel doesn't
  // render or on the wrong-signed row. The display band/magnitudes are untouched — only the ⚑ moves.
  const overrideCall = kingStrikes?.call;
  const overridePut = kingStrikes?.put;
  const crownCallStrike =
    overrideCall != null && Number.isFinite(overrideCall) && entries.some((e) => e.strike === overrideCall && e.gex > 0)
      ? overrideCall
      : kingCallStrike;
  const crownPutStrike =
    overridePut != null && Number.isFinite(overridePut) && entries.some((e) => e.strike === overridePut && e.gex < 0)
      ? overridePut
      : kingPutStrike;

  const rows: GexLadderRow[] = entries
    .map((e) => ({
      strike: e.strike,
      gex: e.gex,
      side: (e.gex > 0 ? "call" : "put") as GexLadderSide,
      magnitude: maxAbs > 0 ? Math.abs(e.gex) / maxAbs : 0,
      // Crowned per side (side-checked so a strike shared across signs can't double-crown). The
      // crowned strike is the canonical wall when the caller supplied one, else the ladder's own
      // strongest strike — see `crownCallStrike`/`crownPutStrike` above.
      isKing: (e.gex > 0 && e.strike === crownCallStrike) || (e.gex < 0 && e.strike === crownPutStrike),
    }))
    .sort((a, b) => b.strike - a.strike);

  return { spot, rows, maxAbs };
}
