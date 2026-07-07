# SPX / GEX Heatmap — Competitor Comparison Investigation

**Date:** 2026-07-01  
**Scope:** Why competitor heatmaps (e.g. QQQ GEX grids) look richer and “more correct” than SPX Slayer’s left rail, and whether our compute logic is wrong.

---

## Executive summary

| Question | Answer |
|----------|--------|
| Is the core GEX math wrong? | **No** — SpotGamma-style formula, server-side flip/walls, verifier + UW cross-check. Historical bugs (flip interpolation, DEX sign) are **fixed**. |
| Why did SPX Slayer look “faulty”? | **UI + scope**, not bad math: single text column, no color scale, zeros as `·`, narrow ±4% band, 0DTE vs 8-expiry header mismatch. |
| Do we have the detailed matrix? | **Yes** — [BlackOut Thermal](/heatmap) (`GexHeatmap.tsx`) is the full competitor-style grid; SPX Slayer was **not wired to it**. |
| Competitor advantage | Wider strike band (~10%+), filled `$0.0K` grid, multi-column color heatmap always visible on the main desk. |

**PR #198 follow-up:** SPX Slayer now embeds a **6-column color matrix** (`SpxGexMatrixHeatmap`) using the same API/cache as Thermal.

---

## Pipeline (single source of truth)

```
Polygon/Massive OI chain (banded)
  → polygon-options-gex.ts :: buildGexHeatmapUncached()
  → Redis cache gex-heatmap:{ticker}
  → GET /api/market/gex-heatmap?ticker=SPX|QQQ|…
  → Thermal (full) | SPX Slayer (compact matrix)
  → Desk header via gex-positioning (near-term strike_totals)
```

All surfaces read the **same cached matrix**. Desk γ flip / GEX king / walls = **near-term aggregate (8 expiries)**. Matrix cells can include **far monthly columns**; `strike_totals` intentionally exclude far-dated OI so Sept −$66B walls don’t swamp actionable 0DTE structure.

---

## Compute constants (SPX @ ~6200, QQQ @ ~730)

| Constant | Value | Effect |
|----------|-------|--------|
| `GEX_HEATMAP_BAND_PCT` | default **0.04** (env tunable ≤0.25) | ±4% strikes in chain pull |
| `NEAR_TERM_EXPIRY_COUNT` | **8** | Levels + Net column scope |
| `FAR_DATED_MAX_TARGETS` | **8** | Extra monthly columns in matrix |
| `HEATMAP_PAGE_GUARD` | **40** pages × 250 contracts | Truncation still possible on huge chains |
| OI filter | **open_interest > 0** | No volume-only gamma |
| GEX formula | `sign × γ × OI × 100 × spot² × 0.01` | SpotGamma per-1%-move $-gamma |
| Flip | neg→pos per-strike crossing nearest spot | Matches `computeZeroGammaFlip` |
| SPX cache TTL | **8s** RTH | QQQ default **20s** |

Competitor QQQ screenshot (~687–772 strikes) ≈ **±5.8%** band on ~730 spot — wider than our default ±4%.

---

## Why competitor grids look “fuller”

1. **Multi-column color matrix on the main view** — we had a **single 0DTE text column** on SPX Slayer while Thermal had the full grid on a separate route.
2. **Zero cells** — competitors show `$0.0K`; we used `·` (looks empty/sparse).
3. **Color normalization** — `pow(mag, 1.35)` dims mid-tier cells; one dominant peak washes out structure (by design for contrast).
4. **Sparse strike axis** — only strikes with OI-backed exposure in band; not every $1 QQQ / $5 SPX step.
5. **Net ≠ sum of visible columns** — Net sums **8 near-term expiries**; monthly columns can be non-zero while Net shows `$0.0K`.
6. **Scope labels** — header levels ≠ single 0DTE column without explanation (fixed in #198).

These are **product/rendering choices**, not silent math errors.

---

## Confirmed fixed compute issues (do not regress)

| Issue | Location |
|-------|----------|
| Cumulative flip wrong segment pairing | `computeZeroGammaFlip` |
| DEX put sign double-flip | `accumulateContract` |
| SPX spot 0 on `I:SPX` | index snapshot + WS |
| Chain truncated at 16 pages | `HEATMAP_PAGE_GUARD` → 40 |
| Fast-move cache bypass dead | `recordHeatmapPriceObservation` on preset compute |

Verifier: `src/lib/correctness/heatmap-verifier.ts` — Σ strike_totals, sign integrity, UW oracle (SPX/SPY).

---

## Surface comparison

| | Competitor (typical) | Thermal (`/heatmap`) | SPX Slayer (before) | SPX Slayer (after #198+) |
|--|---------------------|----------------------|---------------------|---------------------------|
| Layout | Full strike × expiry grid | Full grid + profile/curve/shift | 1 text column | **6-col color matrix + Net** |
| Colors | Yellow/green vs purple | Brand GEX/VEX/DEX/CHARM | None | **Shared heatmap scale** |
| Zeros | `$0.0K` | `·` | `·` | **`$0.0K`** |
| Spot marker | Row highlight | Row + overlays | Spot overlay row | **Cyan spot row** |
| Lenses | GEX (typical) | GEX/VEX/DEX/CHARM | GEX/VEX | GEX/VEX |
| Link to full tool | N/A | — | None | **→ Full Thermal** |

---

## Recommendations (ops / product)

See also **`docs/audit/DATA-API-PROCUREMENT.md`** — buy/don't-buy for APIs vs wiring existing Massive + UW.

1. **Widen band for production** if wings still feel missing: `SPX_GEX_HEATMAP_BAND_PCT=0.08` (SPX default is now **0.06**).
2. **Use Thermal** for monthly OpEx columns, shift/history, explain route, flow overlays.
3. **Monitor** `[gex-heatmap] fetchHeatmapBand truncated` logs — truncation understates walls.
4. **Optional:** SPX desk header 0DTE-only mode (product decision) so header ≡ matrix scope.

---

## Files

| Role | Path |
|------|------|
| Compute | `src/lib/providers/polygon-options-gex.ts` |
| API | `src/app/api/market/gex-heatmap/route.ts` |
| Full UI | `src/components/desk/GexHeatmap.tsx` |
| SPX compact matrix | `src/components/desk/SpxGexMatrixHeatmap.tsx` |
| Shared cell format | `src/lib/gex-heatmap-display.ts` |
| 0DTE scope helpers | `src/lib/correctness/gex-odte-scope.ts` |
| Verifier | `src/lib/correctness/heatmap-verifier.ts` |
