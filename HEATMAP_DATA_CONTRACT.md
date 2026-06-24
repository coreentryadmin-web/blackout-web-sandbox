# Heat Maps Data Contract — Canonical GEX/VEX Cross-Tool Exposure Surface

The Heat Maps tool owns the **single source of truth** for dealer GEX/VEX
positioning. Every other tool, service, and AI surface should read dealer
positioning from **one** place so nobody disagrees with what users see on the
Heat Maps screen.

That source is:

- **Provider:** `src/lib/providers/gex-positioning.ts` (HEATMAP-OWNED)
- **HTTP:** `GET /api/market/gex-positioning?ticker=X` (HEATMAP-OWNED)

Both are thin **cache-readers** over the shared GEX matrix
`fetchGexHeatmap(ticker)` (`src/lib/providers/polygon-options-gex.ts`), which is
already cached in-memory + Redis under `gex-heatmap:{ticker}`. Reading
positioning **never** triggers a second upstream and **never** touches the
Unusual Whales 2-RPS overlay budget.

---

## The `GexPositioning` contract

```ts
import type { GexPositioning } from "@/lib/providers/gex-positioning";

type GammaPosture = "long" | "short" | null;
type VannaPosture = "positive" | "negative" | null;

type GexPositioning = {
  ticker: string;                 // normalized root, e.g. "SPY" / "SPX"
  spot: number;                   // live underlying spot (> 0 when object is non-null)
  change_pct: number;             // signed day change %
  asof: string;                   // ISO timestamp the matrix was computed

  flip: number | null;            // zero-gamma flip strike, or null
  call_wall: number | null;       // largest-positive net gamma strike (resistance/pin)
  put_wall: number | null;        // largest-negative net gamma strike (support)
  max_pain: number | null;        // max-pain strike

  net_gex: number;                // net dealer dollar-GAMMA (signed)
  gamma_posture: GammaPosture;    // 'long' at/above flip, 'short' below, null undetermined
  gamma_regime_read: string;      // one-liner gamma regime read (always a string)

  net_vex: number;                // net dealer dollar-VANNA (signed)
  vanna_posture: VannaPosture;    // 'positive' | 'negative' | null
  vanna_regime_read: string;      // one-liner vanna regime read (always a string)

  nearest_wall: {                 // closer of call/put wall to spot, or null
    strike: number;
    kind: "resistance" | "support";
    distance_pts: number;         // signed (strike - spot), 2dp
  } | null;

  distance_to_flip_pct: number | null; // signed (spot - flip)/spot*100, or null

  shift_summary: string | null;   // intraday gamma-migration one-liner, or null

  source: "polygon";              // provenance (the shared Polygon/Massive matrix)
};
```

### Field meanings (and how they map to the matrix)

| Field | Meaning | Source on `GexHeatmap` |
| --- | --- | --- |
| `flip` | Zero-gamma flip strike. Above → dealers net long gamma (range-bound); below → short gamma (momentum). | `gex.flip` |
| `call_wall` / `put_wall` | Largest positive / negative net dealer-gamma strike (resistance/pin and support). | `gex.call_wall` / `gex.put_wall` |
| `max_pain` | Option-holder value minimizer. | `max_pain` |
| `net_gex` | Net dealer dollar-gamma across the whole matrix (signed). | `gex.total` |
| `gamma_posture` | `'long'` when spot ≥ flip, `'short'` below, `null` undetermined. | `gex.regime.posture` |
| `gamma_regime_read` | Plain-language one-liner; neutral string when data is thin (never empty). | `gex.regime.read` |
| `net_vex` | Net dealer dollar-vanna across the matrix (signed). | `vex.total` |
| `vanna_posture` | `'positive'` (hedging adds to moves as IV rises) / `'negative'` (fades) / `null`. | `vex.regime.posture` |
| `vanna_regime_read` | Vanna one-liner; neutral string when thin. | `vex.regime.read` |
| `nearest_wall` | The call/put wall **closest to spot**, classified resistance/support, with signed point distance. | derived from `gex.call_wall`/`put_wall` + `spot` |
| `distance_to_flip_pct` | Signed % of spot away from the flip. Negative → spot below flip. | derived from `spot` + `gex.flip` |
| `shift_summary` | Intraday gamma-migration summary, but **only** when `shift.available` is true. | `shift.available ? shift.summary : null` |

**Never fabricated.** Any field that can't be determined from the current matrix
is `null` (or, for the always-present reads, a neutral string). When the matrix
itself is cold/empty (no provider, no spot, or no strikes), the whole object is
`null` — emit nothing rather than a fake read.

---

## How to consume

### 1. Server (TypeScript) — preferred

```ts
import {
  getGexPositioning,
  gexContextLine,
  gexContextBlock,
} from "@/lib/providers/gex-positioning";

const pos = await getGexPositioning("SPY");        // GexPositioning | null
const line = await gexContextLine("SPY");          // one-sentence string | null
const block = await gexContextBlock("SPY");         // multi-line prompt block | null
```

- `getGexPositioning(ticker)` — the full structured contract (or `null`).
- `gexContextLine(ticker)` — one embeddable sentence, e.g.
  `SPY dealer positioning: SHORT gamma below flip 745.0; call wall 750 (resistance), put wall 735 (support), max-pain 743, net GEX -$688M, net vanna +$120M.`
  Missing clauses are dropped; `null` when there's no data.
- `gexContextBlock(ticker)` — the multi-line block mirroring the explain route's
  prompt context (Ticker / Spot / regime read / flip+posture+distance / walls +
  max-pain / net gamma + vanna / intraday shift). `null` when there's no data.

> The accessors are guarded by `import "server-only"` — they run **only**
> server-side. Consumers may import the **type** `GexPositioning` freely (client
> or server); only the runtime functions are server-bound.

### 2. HTTP — any service

```
GET /api/market/gex-positioning?ticker=SPY
Authorization: Bearer <CRON_SECRET>      # or a premium Clerk session
```

Returns `{ available: true, ...GexPositioning }` or `{ available: false, ticker }`
(always HTTP 200, `no-store`). This is the **light** positioning contract — it
never fetches overlays, so it can't pressure the UW budget.

### 3. AI prompts

Drop `await gexContextBlock(ticker)` straight into the prompt context. It's the
exact block the Heat Maps "explain" narrative is grounded on, so the model can't
drift from the on-screen positioning. Use `gexContextLine` when you only need a
one-liner embedded in a larger prompt.

---

## The cache-reader guarantee

`getGexPositioning` calls `fetchGexHeatmap(ticker)` with **no** `forceRefresh`,
so it reads the shared `gex-heatmap:{ticker}` cache (in-memory + Redis, ~20s
matrix TTL). It:

- **NEVER** calls `fetchPolygonPositioningBundle` or any second upstream.
- **NEVER** fetches overlays (HELIX flow-per-strike / dark-pool) — those are the
  UW-budgeted path and live only on the heavy `/api/market/gex-heatmap` route.
- Is therefore **O(distinct tickers)** at the matrix TTL regardless of caller
  count — 500 consumers collapse to the one shared matrix.

This matches the discipline of `getNwTickerGex`
(`src/lib/nights-watch/position-context.ts`), the reference cache-reader.

---

## CONVERGENCE — eliminate the dual-path GEX inconsistency

Two other surfaces currently recompute GEX over a **different chain band** than
the Heat Maps matrix, so their numbers can disagree with what users see on the
Heat Maps screen and in the explain narrative. Each should converge onto
`getGexPositioning` via a thin adapter that maps `GexPositioning` → that surface's
existing summary shape, so **call sites stay unchanged**.

### Inconsistency A — Night Hawk `fetchPositioningSummary` — OTHER-SESSION-OWNED

- **File:** `src/lib/nighthawk/positioning.ts`
- **Function:** `fetchPositioningSummary(ticker): Promise<PositioningSummary>`
- **What it does today:** calls `fetchPolygonPositioningBundle(sym)` (a **second
  upstream**, a different banded chain fetch than `fetchGexHeatmap`), then
  recomputes net GEX / flip / regime / walls / max-pain / net VEX via
  `analyzeStrikeGexRows` + `computeGammaFlip` + `gammaRegime` + `topGexWalls`.
- **Call sites:**
  - `src/lib/nighthawk/dossier.ts:226` (per-ticker dossier `positioning` field)
  - `src/lib/nighthawk/index-dossier.ts:42` (index/ETF dossier)
- **Risk:** different band + different flip/wall math → the dossier can report a
  flip, walls, or net GEX that don't match the Heat Maps screen for the same
  ticker at the same moment.
- **Recommended convergence (OTHER-SESSION-OWNED):** rewrite
  `fetchPositioningSummary` as a **thin adapter** over `getGexPositioning`:
  - `net_gex` ← `net_gex`
  - `gamma_flip` ← `flip`
  - `gamma_regime` ← map `gamma_posture` (`'long'`/`'short'`/`null`) to the
    existing regime label string
  - `net_vex` ← `net_vex`
  - `max_pain` ← `max_pain`
  - `negative_gamma` ← `net_gex < 0`
  - `gex_king_strike` ← `nearest_wall?.strike ?? call_wall ?? put_wall`
  - `wall_summary` ← format from `call_wall` / `put_wall` (+ `nearest_wall`
    distance), matching the current `"resistance $X (+Npts) · support $Y …"` style
  - `source` ← `"polygon"`
  Keep the `PositioningSummary` return type and both call sites identical. The
  internal `fetchPolygonPositioningBundle` call (and the `gamma-desk` recompute
  helpers, if no longer used elsewhere) can then be dropped.

### Inconsistency B — Largo `get_positioning` tool — OTHER-SESSION-OWNED

- **File:** `src/lib/largo/run-tool.ts`
- **Tool case:** `get_positioning` (`run-tool.ts:1210-1213`) →
  `return { ticker: sym, ...(await fetchPositioningSummary(sym)) }`
- **What it does today:** reuses the same Night Hawk `fetchPositioningSummary`,
  inheriting the same off-band recompute.
- **Risk:** Largo's `get_positioning` answers can disagree with the Heat Maps
  screen and the Heat Maps explain narrative for the same ticker.
- **Recommended convergence (OTHER-SESSION-OWNED):** once Inconsistency A is
  fixed (adapter over `getGexPositioning`), Largo's `get_positioning` inherits the
  canonical numbers with **no further change**. Alternatively, point the tool case
  directly at `getGexPositioning(sym)` (or surface `gexContextBlock(sym)` as the
  grounding text) if the tool's output shape is allowed to move to the canonical
  contract.

---

## Ownership map

| Item | Status |
| --- | --- |
| `src/lib/providers/gex-positioning.ts` (provider + helpers) | **HEATMAP-OWNED — done** |
| `src/app/api/market/gex-positioning/route.ts` (canonical endpoint) | **HEATMAP-OWNED — done** |
| `src/app/api/market/gex-heatmap/explain/route.ts` (core GEX context deduped onto `gexContextBlock`) | **HEATMAP-OWNED — done** |
| `HEATMAP_DATA_CONTRACT.md` (this doc) | **HEATMAP-OWNED — done** |
| `src/lib/nighthawk/positioning.ts` → adapter over `getGexPositioning` | **OTHER-SESSION-OWNED — Night Hawk action** |
| `src/lib/nighthawk/dossier.ts` / `index-dossier.ts` call sites | **OTHER-SESSION-OWNED — unchanged once adapter lands** |
| `src/lib/largo/run-tool.ts` `get_positioning` | **OTHER-SESSION-OWNED — Largo action (inherits the adapter)** |
