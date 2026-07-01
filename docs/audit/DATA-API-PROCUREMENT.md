# Data API Procurement — GEX / Dealer Positioning Correctness

**Date:** 2026-07-01  
**Audience:** Product / engineering deciding what to buy vs wire better  
**Verdict:** You already pay for the two APIs competitors use. **Do not buy SpotGamma/ORATS/LiveVol/GEXBot for math.** Invest in wiring + ops tuning what you have.

---

## What competitors show vs what we compute

| Surface | Competitor (SpotGamma, GEXBot, UW terminal) | BlackOut today |
|---------|---------------------------------------------|----------------|
| GEX matrix cells | OI × gamma × spot² (industry convention) | **Same formula** — `polygon-options-gex.ts` |
| Flip / walls | Per-strike net gamma crossings + extrema | **Same logic** — `computeZeroGammaFlip` + call/put wall |
| Intraday 0DTE | OI + volume / flow adjustment | **Built** — `gex_intraday_adjusted` (opt-in, Massive trades tape) |
| Flow overlay | Premium at strike | **Built** — UW flow-per-strike on Thermal allowlist |
| Native UW GEX ladder | Primary product for UW | **Oracle only** — WS `gex_strike_expiry` + REST cross-val |
| VEX / charm | Proprietary or vendor greeks | **Computed** — Black-Scholes vanna/charm from Massive IV |
| Strike coverage | Often ±8–12% | **±6% SPX default** (was ±4%); env tunable |
| UI density | Full color grid on main desk | **SPX Slayer + Thermal** (PR #198+) |

**Correctness gap is not “wrong API.”** It is:

1. **OI-only primary path** — OI settles EOD; 0DTE intraday gamma is understated until you opt into intraday-adjusted lens.
2. **Coverage band** — narrow band = fewer strikes vs wide competitor grids.
3. **UI scope** — single-column rail vs full matrix (addressed in #198).
4. **UW oracle under-used** — paid WS GEX used for logging, not surfaced to users.

---

## APIs you already have (use these first)

### Massive / Polygon — **Options Advanced + Indices Advanced**

| Capability | Used for GEX? | Utilization |
|------------|---------------|-------------|
| `GET /v3/snapshot/options/{underlying}` (banded, paginated) | **Yes — backbone** | Core |
| Indices WS `A.I:SPX` | Live spot for matrix | Yes |
| Options WS `T` / `Q` | Marks engine only | **Not GEX matrix** |
| `GET /v3/trades/{OCC}` | Intraday-adjusted GEX only | Partial |
| FMV cluster | Illiquid strike mids | **Opportunity** if on plan |

**Buy more?** Only if you need a **higher Massive tier** for:

- Higher REST/WS rate limits under load
- FMV for thin SPXW strikes
- Options trades WS for real-time intraday adjust (vs REST trades probe)

**Do not buy** a second chain vendor for the same OI+gamma math.

### Unusual Whales — **Advanced**

| Capability | Used for GEX? | Utilization |
|------------|---------------|-------------|
| WS `gex_strike_expiry:SPX` | Cross-validation oracle | **Under-used** |
| REST `/spot-exposures/strike` | Fallback oracle | Cached 60s |
| REST `/spot-exposures/expiry-strike?expirations[]=today` | 0DTE King/sign verifier | Correctness cron |
| Flow-per-strike intraday | Heatmap overlay | Allowlist only |
| Dark pool | Heatmap overlay | Allowlist only |
| Greek exposure by strike/expiry | Not wired to matrix | **Opportunity** |

**Buy more?** **No new vendor.** Maximize existing UW Advanced:

1. Keep `gex_strike_expiry` WS always connected for SPX (and optionally SPY/QQQ).
2. Surface `cross_validation` in UI (wired in #198+).
3. Optional: use UW greek-exposure REST for VEX desk parity (same subscription).

**Do not** make UW primary matrix source — REST 503 history; scale differs from $-gamma convention; matrix must stay Polygon-computed for consistency.

---

## APIs you do NOT have (and usually should NOT buy)

| Vendor | Why competitors use it | Should BlackOut buy? |
|--------|------------------------|---------------------|
| **SpotGamma API** | They *are* SpotGamma | **No** — we implement same convention; buying duplicates $ + integration |
| **GEXBot** | Hosted GEX grid | **No** — same OI math; you lose control of desk/Largo alignment |
| **ORATS** | IV surfaces, skew | **Only if** you abandon BS vanna/charm and want vendor vol surface — large pivot |
| **LiveVol / CBOE direct** | Institutional vol | **No** for retail desk unless compliance requires |
| **Barchart dealer GEX** | Alternate host | **No** — redundant with self-compute + UW oracle |

**Exception:** If you want to **white-label SpotGamma levels** as authoritative without maintaining compute, that's a **product/strategy** decision — not a correctness bug fix.

---

## Recommended stack (100% honesty posture)

```
PRIMARY (authoritative for all surfaces)
  Massive chain → OI × gamma → shared gex-heatmap cache

INTRADAY LENS (labeled ESTIMATE, 0DTE)
  Massive trades tape + quote-rule signing → gex_intraday_adjusted

ORACLE (independent check, SPX/SPY/QQQ presets)
  UW WS gex_strike_expiry → cross_validation on heatmap API

OVERLAYS (context, not gamma)
  UW flow-per-strike + dark pool

NEVER FABRICATE
  null / degraded / stale badges when cold, diverged, or feed_stalled
```

---

## Env tuning (free correctness wins)

| Variable | Default (post #198+) | Effect |
|----------|----------------------|--------|
| `SPX_GEX_HEATMAP_BAND_PCT` | **0.06** | ±6% SPX strikes (~±370 pts @ 6200) |
| `GEX_HEATMAP_BAND_PCT` | 0.04 | Other tickers |
| `OPTIONS_HEATMAP_PAGE_GUARD` | 40 | Chain pagination cap — watch truncation logs |
| `UW_WS_GEX_STRIKE_EXPIRY_TICKERS` | SPX | WS oracle tickers |
| `CORRECTNESS_UW_ORACLE` | on in prod cron | Automated King/sign checks |

---

## Monitoring checklist

1. `[gex-heatmap] fetchHeatmapBand truncated` — walls understated
2. `[gex-positioning] cross-validation divergence … >5pt` — Polygon vs UW disagree
3. `gex_strike_expiry` WS freshness — oracle blind when stale
4. Matrix `asof` age > 90s during RTH — stale-as-live
5. `cross_validation.divergence` in API — surface in UI (SPX matrix)

---

## Summary: buy list

| Action | Cost | Impact |
|--------|------|--------|
| **Wire UW cross-val to UI** | $0 (already subscribed) | High — user trust |
| **SPX ±6% band default** | More Polygon pages | High — competitor-like coverage |
| **Enable intraday-adjust on SPX header** (opt-in product) | Massive trades budget | High for 0DTE sessions |
| **Massive Options Trades WS** | Same plan if included | Medium — fresher intraday lens |
| **Massive FMV** | Plan tier | Medium — thin strikes |
| **SpotGamma / ORATS / GEXBot API** | New $$$ | Low unless strategic pivot |

**Bottom line:** Your competitors’ matrices look better because of **presentation + band width + OI+flow lenses**, not because you’re missing a secret GEX API. Pay for **better utilization** of Massive + UW Advanced before adding vendors.
