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

  // ADDITIVE, LABELED 0DTE lens — see "Intraday-adjusted GEX" below. ESTIMATE built ON TOP of the
  // canonical OI fields above; NEVER overwrites net_gex / flip / call_wall / put_wall. null when it
  // can't be built. Populated by getGexPositioning (the async accessor); the pure
  // gexPositioningFromHeatmap mapper leaves it undefined (it has no flow input).
  gex_intraday_adjusted?: GexIntradayAdjusted | null;

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

## Intraday-adjusted GEX (0DTE / front expiry) — ADDITIVE, LABELED lens

> **The canonical OI-weighted GEX above is UNCHANGED and PRIMARY.** This is a
> SEPARATE, clearly-labeled view — never a replacement.

**The gap it fills.** Canonical dealer GEX (`net_gex` / walls / `flip`) is
**open-interest weighted** — the industry standard (SpotGamma / Barchart) that
users cross-reference, so it stays exactly as-is. But OI is **settled
end-of-day**, so it is stale intraday; for the **front expiry (0DTE — >50% of
SPX option volume)** OI is near-zero during the session because today's
contracts haven't settled into OI yet. An OI-only view therefore **misses
same-day dealer gamma** being built right now.

**What we add (mirrors SpotGamma's "OI & Volume Adjustment").** For the **front
expiry only**, estimate today's not-yet-settled net dealer positioning from the
**Massive Trades tape** and ADD it to the OI base to produce
`gex_intraday_adjusted` — a parallel view. The canonical fields are **never**
overwritten.

**Signed flow, not gross volume (decided).** Gross volume ≠ net dealer
positioning, so each front-expiry trade is classified **buy-vs-sell via the
quote rule** (`price ≥ ask` → customer buy `+`, `≤ bid` → customer sell `−`,
strictly inside → unclassified `0`). The NBBO used is the `last_quote` **already
present on the discovery snapshot** the Trades reconstruction fetches
(`option-trades.ts`) — so signing costs **zero extra fan-out** (no per-trade
`/v3/quotes` pull). Because that NBBO is a single near-real-time snapshot (not
the quote at each trade's exact nanosecond), the signing is a **bounded
approximation** — the view is labeled an **ESTIMATE**. When classification
coverage is thin the adjustment shrinks toward 0 and the view degrades to the OI
base (`model: "thin"`); never fabricated.

**The math (dimensionally identical to `gex.strike_totals`).** For front-expiry
strike `K`:

```
netCustomerGammaContracts(K) = netCallContractsSigned(K) + netPutContractsSigned(K)
dealerGammaAdjust(K)         = − gammaCoeff(K) · netCustomerGammaContracts(K)
   gammaCoeff(K) = γ · shares_per_contract · spot² · 0.01   // one long contract's $-gamma,
                                                            // SAME per-1%-move scale as the matrix
adjustedStrikeTotal(K)       = oiFrontStrikeTotal(K) + dealerGammaAdjust(K)
```

Both call and put long positions are long gamma for the buyer; the quote-rule
sign already encodes who is net long, and dealers are the **counterparty** (the
negation). Non-front strikes carry their OI total **unchanged**; `flip` / walls
/ net are recomputed on the adjusted totals and surfaced as `*_adjusted`.

**The `GexIntradayAdjusted` type** (on `gex_intraday_adjusted`):

```ts
type GexIntradayAdjusted = {
  ticker: string;
  front_expiry: string;            // YYYY-MM-DD the lens is scoped to
  spot: number;
  asof: string;
  net_gex_adjusted: number;        // OI net GEX + front-expiry intraday nudge
  net_gex_oi: number;              // canonical OI net GEX (UNCHANGED), for side-by-side
  net_gex_adjustment: number;      // adjusted − OI
  strike_totals_adjusted: Record<string, number>;
  flip_adjusted: number | null;    // recomputed on adjusted totals (distinct from canonical flip)
  call_wall_adjusted: number | null;
  put_wall_adjusted: number | null;
  meta: {
    window_min: number;
    total_prints: number;
    side_classified_prints: number;
    classification_coverage: number; // side_classified / total, 0..1 (low ⇒ view ≈ OI base)
    partial: boolean;
  };
  label: string;    // "Intraday-adjusted (OI + volume model) — 0DTE"
  tooltip: string;  // explains it's an estimate + canonical GEX is OI-based
  model: "signed-flow" | "thin";
  source: "polygon";
};
```

**UI labeling requirement.** Any surface that renders this view MUST show the
`label` ("Intraday-adjusted (OI + volume model) — 0DTE") and the `tooltip` (which
states it is an estimate and that the canonical GEX is OI-based), so users never
confuse it with the primary OI numbers.

**Opt-in (keeps the light contract light).** `getGexPositioning` stays a pure
cache-reader by default — `gex_intraday_adjusted` is populated only when a caller
passes `{ includeIntradayAdjusted: true }` (or the route is hit with
`?intraday=1`). The standalone accessor `getGexIntradayAdjusted(ticker)` returns
the view directly. `gexContextBlock` opts in (AI prompts benefit; not the
high-frequency path).

**Cost / RPS.** `getGexIntradayAdjusted(ticker)`:
- reads the **OI base via the SHARED matrix cache** (`fetchGexHeatmap`, cache-reader — no second matrix upstream),
- one **bounded** front-expiry gamma-coefficient band (`fetchFrontExpiryGammaCoeffs`, cached, ~1 page through the shared Polygon funnel),
- the **bounded + cached + rate-limited** Trades tape (`fetchOptionTrades` — contract cap + page cap + the one permissive Massive funnel),
- whole result cached at the OPTIONS_CHAIN TTL so concurrent callers collapse to one build per window.

**Files.**
- `src/lib/providers/gex-intraday-adjust-core.ts` — PURE math + types (no `server-only`, unit-tested in `gex-intraday-adjust-core.test.ts`).
- `src/lib/providers/gex-intraday-adjust.ts` — server orchestration (`getGexIntradayAdjusted`).
- `src/lib/providers/option-trades.ts` — extended with quote-rule side classification (signed premium + signed contracts per strike) at zero extra fan-out.
- `src/lib/providers/polygon-options-gex.ts` — `fetchFrontExpiryGammaCoeffs` (front-expiry per-strike gamma coefficients). The canonical matrix builder is **untouched**.
- `getGexPositioning` populates `gex_intraday_adjusted`; `gexContextBlock` emits a labeled one-liner for AI prompts.

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

---

## Alerts

Heat Maps surface gamma-regime alerts at two layers. The heatmap side (the `events[]`
contract + the cron evaluator) is **complete**; making web-push actually *deliver* is a
set of platform/other-session follow-ups, all gated so nothing ships hot.

### In-tool alerts — `events[]` (DONE)

`fetchGexHeatmap(ticker)` emits a server-computed `events: GexEvent[]` on the matrix payload
(see the `GexEvent` type in `src/lib/providers/polygon-options-gex.ts`). Each event is a PURE
diff of the current sample vs the prior positioning-history snapshot — **no extra upstream
calls**, and only emitted once ≥2 snapshots exist (never fabricated on the first sample). Types:
`flip_crossed`, `wall_broken`, `regime_flipped`, `net_gex_sign_flipped`, each with `severity`
(`info`/`warn`), a ready-to-display `message`, optional `level`/`direction`, and the sample `at`.
The Heat Maps UI renders these as the alerts strip. Cached WITH the matrix, so every user reads
the same shared event list.

### `gex-alerts` cron — web-push evaluator (READY, INERT until activated)

- **Route:** `src/app/api/cron/gex-alerts/route.ts` (Bearer `CRON_SECRET`, `runtime="nodejs"`,
  `dynamic="force-dynamic"`, `maxDuration=120`).
- **Helper:** `src/lib/push/send-web-push.ts` — `sendWebPush({ title, body, url }, { userId? })`.
  Self-contained mirror of the inert push scaffold (`src/app/api/push/send/route.ts`): same VAPID
  gate, same runtime-only optional `web-push` import, same `push_subscriptions` query + 404/410
  prune. Returns `{ configured: false, sent: 0, pruned: 0 }` and sends nothing when VAPID / the
  `web-push` package / the DB is absent. **Never throws.** This is now the single place the send
  logic lives; the scaffold route could later delegate to it (the route is shared-scaffold and was
  intentionally NOT edited here).
- **INERT-by-default gate:** the cron returns `{ ok: true, inert: true }` and does nothing unless
  BOTH `GEX_ALERTS_PUSH` is `"1"`/`"true"` AND `vapidConfigured()`. Ships safe.
- **Watchlist:** MAJOR market-regime tickers only — `SPY`, `SPX`, `QQQ` (broadcast-worthy "market
  gamma regime" alerts, not single-name noise).
- **Cache-reader:** for each ticker it reads the SHARED cached matrix via `fetchGexHeatmap(ticker)`
  and consumes its `events[]` — no new upstream chain fetch, events not recomputed.
- **Which events alert:** regime-level only — `flip_crossed`, `regime_flipped`,
  `net_gex_sign_flipped` for all three; `wall_broken` additionally for `SPY`/`SPX`.
- **Dedup:** keyed `gex-alert-sent:{ticker}:{type}:{ET-date}` (with a rounded `level` bucket where
  the event carries one), TTL ~1 day → a given cross alerts ONCE per ET-date, not every 5-min tick.
  Dedup is a cheap Redis read/write via `sharedCacheGet`/`sharedCacheSet`.
- **Send:** each NEW (non-deduped) regime event → `sendWebPush({ title:`${ticker} ${label}`,
  body: event.message, url:`/heatmap?ticker=${ticker}` }, {})` — broadcast to all push subscribers.
  Best-effort per ticker (one failure never aborts the rest); never throws.
- **Schedule:** ~every 5 min during market hours — infra-owned railway registration (per-service
  `railway.gex-alerts.toml` + a `scripts/hit-cron.mjs` entry), like the EOD cron. Also works
  on-demand via a Bearer call.

### Platform follow-ups to make web-push LIVE (ALL platform/other-session-owned)

The heatmap side (the `events[]` contract + this evaluator) is complete. Going live requires:

1. **Set VAPID keys + install the package** — set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` +
   `VAPID_PRIVATE_KEY` (and optionally `VAPID_SUBJECT`) and run `npm i web-push`. Until then both
   the scaffold and `sendWebPush` stay inert.
2. **Activate the cron** — set `GEX_ALERTS_PUSH=1`. With VAPID also set, the cron leaves inert mode.
3. **Register the cron schedule (railway)** — add `railway.gex-alerts.toml` + the `scripts/hit-cron.mjs`
   entry hitting `/api/cron/gex-alerts` with `Authorization: Bearer ${CRON_SECRET}`, ~every 5 min
   during market hours.
4. **Per-ticker per-user subscription model + a 🔔 opt-in toggle** in the heatmap UI, so alerts
   become per-user-per-ticker (via `sendWebPush(payload, { userId })`) instead of the current
   broadcast. Today alerts broadcast to ALL subscribers; the helper already accepts `{ userId }`
   for when the subscription model lands.

| Item | Status |
| --- | --- |
| `events[]` contract + evaluator (`fetchGexHeatmap` → `GexEvent[]`) | **HEATMAP-OWNED — done** |
| `src/lib/push/send-web-push.ts` (shared send helper, inert) | **HEATMAP-OWNED — done** |
| `src/app/api/cron/gex-alerts/route.ts` (evaluator cron, inert-by-default) | **HEATMAP-OWNED — done** |
| VAPID keys + `npm i web-push` | **PLATFORM-OWNED — activation** |
| `GEX_ALERTS_PUSH=1` | **PLATFORM-OWNED — activation** |
| `railway.gex-alerts.toml` + `scripts/hit-cron.mjs` schedule | **INFRA-OWNED — registration** |
| Per-ticker per-user push subscription model + 🔔 opt-in toggle | **OTHER-SESSION-OWNED — follow-up** |
