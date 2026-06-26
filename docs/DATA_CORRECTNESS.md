# Data-Correctness Auditor

A continuous verifier that checks **the numbers the platform shows are correct** — starting with
Heat Maps (the GEX / VEX / DEX / CHARM dealer-positioning matrix), the most numerically dense and
highest-stakes surface. It is built to extend to the SPX desk, flows, Night's Watch, and Night Hawk
plays without changing the scorecard schema.

It is distinct from the existing **Data Integrity** sweep (`/api/cron/data-integrity`), which
cross-checks live numbers *across tools* (desk vs heatmap vs quote, SPY/SPX tracking). The
Data-Correctness auditor goes a layer deeper: it **independently re-derives** the Heat Maps
aggregates from the raw chain and confirms them against a **second provider**, answering "is this
number *right*?" — not just "do two surfaces agree?".

- Verifier lib: `src/lib/correctness/heatmap-verifier.ts`
- Scorecard types: `src/lib/correctness/types.ts`
- Orchestrator + markdown render: `src/lib/correctness/run-correctness.ts`
- Cron route: `src/app/api/cron/data-correctness/route.ts`
- Schedule: `railway.data-correctness.toml` + registry entry `data-correctness`
- Scorecard output: `docs/auto/data-correctness-<date>.md` (best-effort; structured result also in the cron run log)

---

## The verification model — six layers (strongest → weakest)

Each layer emits structured per-metric `CheckResult`s with `PASS` / `consistency-only` / `FLAG`
(plus `skipped`), and on a numeric comparison records **expected vs actual vs tolerance**.

### L1 — Shadow recompute (strongest)
Independently re-derives the **key aggregates** — net dealer $-gamma, **King** node, **gamma flip**,
**call/put walls** — *from scratch* (the argmax / sign-crossing / sum algorithms in the verifier do
**not** import the production helpers, so a bug there can't hide behind a shared implementation).

Two sub-checks:
- **From the served `cells`** — re-sum the matrix the client actually renders back into per-strike
  near-term totals and require it to reconcile with the reported `strike_totals` and `total`. This is
  the catch for the **"$5000M should be $5.0B"** class (a scale/aggregation/transform bug between the
  cells and the headline number).
- **From the raw chain** — fetch one near-money chain for the nearest expiry
  (`fetchPolygonAtmOptionsChain`, through the rate-limited Polygon funnel), apply an
  independently-written `gamma·oi·100·spot²·0.01` (call +/put −) formula, and diff per-strike $-gamma
  against the served cells (catches a dropped `×0.01` / `×spot` / wrong sign on a strike), plus a
  band-scoped King agreement.

  *Honest caveat:* the raw recompute uses the **same documented per-1%-move scale** the engine uses
  (it must, to be on the same scale), so it confirms the **aggregation + scale application is correct
  end-to-end**, not that the convention itself is the "right" one. That last question is what the
  cross-provider oracle (L4) answers.

### L2 — Invariants (relationships that MUST hold → FLAG on violation)
- `Σ(per-strike net_gex) == reported net total` (within fp tolerance `1e-6`). A scale bug blows past this.
- `Σ(per-strike net_vex) == reported net VEX total`.
- `call_wall == argmax(+net_gex)` and `put_wall == argmin(−net_gex)` (the walls are the local extrema).
- `gamma_flip` is an **actual neg→pos sign change** of per-strike net gamma nearest spot — not an
  arbitrary level. (One-sided null differences fall back to the documented cumulative-crossing
  behavior and are not flagged unless a clean crossing near spot was dropped.)
- Re-summed `cells` reconcile to `strike_totals` (the matrix the user sees matches the levels reported).

### L3 — Sanity bounds (plausible ranges → FLAG when out of bounds)
- No `NaN` / `Inf` in any served aggregate (spot, net GEX/VEX, flip, walls, max-pain).
- Spot `> 0` on a non-empty matrix.
- Walls / flip / max-pain sit within ±50% of spot (a level far outside the band ⇒ strike-key/scale bug).
- All expiry columns are valid, non-past `YYYY-MM-DD` dates.
- Net GEX magnitude under an absurd-blow-up ceiling (`spot² · 1e8`) — a units/scale tripwire.

### L4 — Cross-provider oracle (the only path to "independently confirmed")
Uses the **UW native GEX ladder** (`fetchUwOdteGexLadder("SPX")` → `spot-exposures/expiry-strike`,
falling back to `greek-exposure/strike`) — this is backlog **#104**, and it **already exists** in the
codebase. For **SPX** it confirms the two **scale-invariant** facts:
- **King strike** (argmax|net|) agreement within ~1.5% of spot → metric marked **independently-confirmed**.
- **Net-GEX sign** agreement → metric marked **independently-confirmed**.

UW rows are `gamma·OI`, a **different scale** from our per-1%-move $-gamma, so **magnitude is not
directly comparable** — only the King strike and the net sign are. UW is reached **only for SPX**,
through `uwGetSafe` → `uw-rate-limiter` (the cluster-wide 2-RPS funnel), so it never adds uncapped
fan-out.

If the oracle does not answer (UW 503/empty) or the ticker is not SPX, the metric is **consistency-only**
and recorded as a **coverage gap** — never a false green.

### L5 — Cross-tool consistency (same value, same label, every surface → FLAG on divergence)
For each ticker, confirm `getGexPositioning` reports the **same** spot / flip / walls / net GEX as the
matrix it derives from. For **SPX**, additionally confirm the **SPX Slayer desk** reads the same spot
and gamma flip. A divergence under the same label is the **#80 class** (the bug where two tools showed
different numbers for "the same" thing).

### L6 — Freshness (never stale-shown-as-live → FLAG when stale during RTH)
The served `asof` must be within the expected TTL (15 min during RTH; heatmap-warm runs every ~30s).
When the market is closed, freshness is **skipped** (thin closed-market data is legitimately stale).

---

## What is independently-confirmed vs consistency-only — TODAY

| Metric | SPX | SPY / QQQ / NVDA / others |
|---|---|---|
| King strike | **independently-confirmed** (UW oracle, when it answers) | consistency-only — no second source |
| Net-GEX sign | **independently-confirmed** (UW oracle, when it answers) | consistency-only |
| Net-GEX magnitude | consistency-only (UW is a different scale) | consistency-only |
| Call / put walls | consistency-only (invariant-checked) | consistency-only |
| Gamma flip | consistency-only (invariant-checked) | consistency-only |
| Per-cell $-gamma | consistency-only (raw-chain shadow recompute) | consistency-only |
| Spot (cross-tool) | consistency-checked across desk + positioning | consistency-checked across positioning |
| Freshness | asserted during RTH | asserted during RTH |

**Consistency-only is a coverage gap, not a guarantee.** The scorecard surfaces it explicitly so no
admin tile or report can render a false "verified" badge.

---

## Tolerances

| Comparison | Tolerance | Why |
|---|---|---|
| Σ strike_totals vs reported total | `1e-6` fractional | fp only — a real scale bug is orders of magnitude larger |
| Raw-chain cell vs served cell | `2%` fractional | banding / far-dated handling differ slightly between paths |
| King / wall strike equality | `0.01` pts (absolute) | it's the same strike or it isn't |
| Cross-tool spot | `0.5%` fractional | well outside live-tick timing jitter |
| Cross-provider King | `1.5%` of spot | different vendors use different strike grids |
| Freshness (RTH) | `15` min | heatmap-warm runs ~30s; 15 min ⇒ a real stall |
| Net-GEX absurd ceiling | `spot² · 1e8` | units/scale tripwire only |

---

## Cron, auth, cadence

- **Auth:** `Authorization: Bearer ${CRON_SECRET}` (`isCronAuthorized`), `force-dynamic`, `maxDuration = 120`.
- **Cadence:** every 30 min during market hours (`0,30 11-21 * * 1-5` UTC, covering RTH in EDT & EST);
  self-skips outside `isSpxEngineCronWindow` (use `?force=1` to run off-hours).
- **Tickers:** `SPX, SPY, QQQ, NVDA` by default; override via `CORRECTNESS_TICKERS` (CSV, ≤10).
- **Alerts:** `notifyOpsDiscord({severity:'critical'})` on any **FLAG**;
  `{severity:'warning'}` when an RTH run is entirely consistency-only (the oracle confirmed nothing —
  a surfaced coverage gap, not a silent all-green).
- **Persistence:** `logCronRun("data-correctness", …)` records the structured payload; a markdown
  scorecard is emitted to `docs/auto/data-correctness-<date>.md` when the FS is writable.

### Env switches
| Var | Effect |
|---|---|
| `CORRECTNESS_TICKERS` | CSV ticker set (default `SPX,SPY,QQQ,NVDA`, capped at 10) |
| `CORRECTNESS_SHADOW_RAW=0` | disable the raw-chain shadow recompute (run pure cache-reader) |
| `CORRECTNESS_UW_ORACLE=0` | disable the UW cross-provider oracle (SPX King/sign become consistency-only) |

---

## The #104 dependency (true GEX confirmation)

Backlog **#104** is "the cross-provider oracle". The UW native GEX channel it calls for already exists
(`fetchUwOdteGexLadder`), so **SPX King + net-GEX sign are independently confirmed today** whenever UW
answers. To extend independent confirmation:

1. **More tickers** — UW `spot-exposures` works for the index/large-cap set; wiring SPY/QQQ/NVDA
   through the same oracle (respecting the 2-RPS budget) would promote them from consistency-only.
2. **Magnitude confirmation** — requires a second source on the **same `$-gamma` scale** (or a
   documented conversion from UW's `gamma·OI`). Until then, net-GEX **magnitude** stays consistency-only.
3. **Walls / flip confirmation** — derivable from a second per-strike ladder; today they are
   invariant-checked against our own matrix only.

Until #104's coverage expands, the auditor is **honest by construction**: it confirms what it can,
consistency-checks the rest, and flags every coverage gap — it never shows a guarantee it cannot back.
