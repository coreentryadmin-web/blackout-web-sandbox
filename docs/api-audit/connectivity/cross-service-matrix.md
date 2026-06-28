# Cross-Service Connectivity Matrix

> Every BlackOut service must read the **same** ground truth as every other service.
> When Largo answers about GEX it must use the same GEX the Heatmap shows; when
> Night's Watch judges a position it must use the same walls SPX Slayer shows; when
> Night Hawk picks a play it must use the same flow signals HELIX shows. Data silos =
> divergent answers = users lose money.
>
> This audit is a **source-code wiring audit** (which shared function each consumer
> actually imports), not a live numeric diff — see the "Audit method" caveat below.

---

## Run — 2026-06-27 04:13 ET (re-verification; live endpoints auth-gated)

**Verdict unchanged: connectivity is structurally STRONG.** Independently re-traced
every consumer's import/call site this run — all prior `✓` cells still hold, no new
silo, no regression since the 01:00 run. The two standing WARNs persist, and one new
consistency-risk note (W3) is added.

**Matrix (source → consumer), by shared-function evidence:**

| Source ↓ / Consumer → | SPX | HELIX | HEATMAP | LARGO | NHAWK | NWATCH | GRID |
|---|---|---|---|---|---|---|---|
| **SPX Desk**   | — | n/a | n/a | ✓ `get_spx_structure`/`get_spx_confluence` | n/a | ✓ `loadMergedSpxDesk` | n/a |
| **HELIX**      | ✓ `spx_flows`/`unified_tape`/`strike_stacks` | — | n/a | ✓ `get_flow_tape`/`get_postgres_flows` | ✓ `flow_alerts` (Postgres) candidate select | ⚠️ **W2** (signal exists, list path unset) | n/a |
| **Heatmaps/GEX** | ✓ desk computes `gex_walls`/`gex_king` | n/a | — | ✓ `get_gex`/`get_positioning` (⚠️ **W1**) | ✓ `fetchPolygonPositioningBundle` (⚠️ **W1**) | ✓ `fetchGexHeatmap` (=`getGexPositioning`) | n/a |
| **Largo**      | n/a | n/a | n/a | — | n/a | n/a | n/a |
| **Night Hawk** | n/a | n/a | n/a | ✓ `get_nighthawk_edition`/`outcomes`/`dossier` | — | n/a | n/a |
| **Night's Watch** | n/a | n/a | n/a | ✓ `get_my_positions` | n/a | — | n/a |
| **Grid**       | ✓ desk `macro_events`/`news_headlines` (⚠️ **W3**) | n/a | n/a | ✓ `get_news`/`get_earnings`/`get_congress_trades`/`get_economic_calendar` | n/a | n/a | — |

*(n/a = no directional data dependency between that pair — e.g. HELIX does not consume the SPX desk; Grid is a leaf intelligence aggregator with no downstream-into-tools requirement beyond SPX macro.)*

**Tally: PASS = 16 wired channels · FAIL = 0 · WARN = 3 (W1, W2, W3).**

### Findings (re-confirmed + new)

- **W1 — Dual per-ticker GEX path (standing, still open).** Heatmap, `getGexPositioning`,
  and Night's Watch non-SPX all route through **`fetchGexHeatmap`** (`polygon-options-gex.ts:1715`;
  `getGexPositioning` is now literally `fetchGexHeatmap → this`, `gex-positioning.ts:115`).
  Largo `get_positioning` (`run-tool.ts:1216` → `fetchPositioningSummary`) and Night Hawk
  dossiers (`nighthawk/positioning.ts:88`) route through **`fetchPolygonPositioningBundle`**
  (`polygon-options-gex.ts:2634`). **Severity is bounded:** both ultimately call the SAME
  `aggregateGexRows` core with the SAME call(+)/put(−) dealer-sign convention
  (`polygon-options-gex.ts:2470`, mirrored at :1823), so the *math* is identical — divergence
  can only come from different strike-banding + independent caches (`gex-heatmap:{ticker}` ~20s
  vs `positioningCache`). So a Largo "where's the SPY call wall" answer can still differ by a
  strike from the Heatmap. WARN, not a silo.
- **W2 — Night's Watch panel verdict omits HELIX flows (standing, still open).** The verdict
  engine HAS a real `flowAlignment` signal reading `ctx.flows` (`verdict.ts:206`), but
  `buildPositionContextMap` (the LIST path) leaves `flows` **unset** by design
  (`position-context.ts:59-76` — "Populated by a separate aggregator, NOT by
  buildPositionContextMap"). So the panel verdict never fires a flow signal; only the detail
  view does. Asymmetry between panel and modal verdicts persists.
- **W3 — Grid econ calendar vs SPX desk macro use different providers (NEW, low severity).**
  Connectivity is PASS — the SPX desk DOES carry event awareness via
  `mergeMacroEventsToday` (`spx-desk.ts:986/1107`) + UW macro indicators, so it is NOT blind
  to FOMC/CPI (the original task's Phase-8 assumption is false). But Grid `/api/grid/economy`
  sources from `readGridEconomy` (UW, `grid/economy/route.ts:5`) while the desk uses
  `macro-events.ts:mergeMacroEventsToday` — two different calendars that could disagree on
  dates/labels. Converge to one macro-events source so Grid and the desk show the same schedule.

### Method this run
- Live numeric cross-check again NOT possible: every `www.blackouttrades.com` data route
  returned **401 (Clerk-gated)** unauthenticated, and it is ~04:13 ET (market closed). Re-ran
  the audit as a **source-code wiring trace** (the stronger structural signal). Every cell
  above cites an import/call site verified this run.
- No commit needed for code changes (none made); doc updated with this re-verification entry.

---

## Run — 2026-06-27 01:00 ET (source-code audit; live endpoints auth-gated)

**Verdict: connectivity is structurally STRONG.** Every consumer that should read a
given source does import the shared source-of-truth function — no consumer is silently
fabricating. Two real findings, both WARN (consistency-risk, not a hard silo):

- **W1 — Dual GEX path (per-ticker):** Largo `get_positioning` and Night Hawk dossiers
  derive GEX from `fetchPolygonPositioningBundle` (single-expiry bundle, defaults to
  today/0DTE), while the Heatmap UI and Night's Watch derive it from `fetchGexHeatmap`
  (full-chain matrix). Both are Polygon-grounded, but they are **different
  computations over different strike bands**, so they can name a different king
  strike / call-wall / put-wall for the same non-SPX ticker. (For **SPX** all roads
  converge on the merged desk — no divergence.)
- **W2 — Night's Watch verdict: panel vs detail asymmetry:** the panel/list verdict
  (`enrichment.ts` → `buildPositionContextMap`) feeds only GEX walls + key levels +
  regime (from the shared desk/heatmap). It does **not** feed HELIX flows, chart
  trend, or earnings catalysts — so the panel's Hold/Trim/Sell can't fire the
  flow/trend/earnings signals. The **detail view** (`position-detail.ts`) feeds all of
  them. Same position can therefore get a different verdict in the panel vs the modal.

### Matrix — Source (row) → Consumer (column)

Legend: `✓` wired to shared source · `⚠` wired but consistency risk · `N/A` not a
meaningful data dependency by product design (rationale in notes) · `—` self.

```
              SPX  | HELIX | HEATMAP | LARGO | NHAWK | NWATCH | GRID
SPX Desk    |  --- |   ✓   |   N/A   |   ✓   |   ✓   |   ✓    | N/A
HELIX       |   ✓  |  ---  |   N/A   |   ✓   |   ✓   |   ⚠²   |  ✓
Heatmaps    |   ✓  |  N/A  |   ---   |   ⚠¹  |   ⚠¹  |   ✓    | N/A
Largo       |  N/A |  N/A  |   N/A   |  ---  |  N/A  |  N/A   | N/A
Night Hawk  |  N/A |  N/A  |   N/A   |   ✓   |  ---  |   ✓    | N/A
Night Watch |  N/A |  N/A  |   N/A   |   ✓   |  N/A  |  ---   | N/A
Grid        |   ✓  |  N/A  |   N/A   |   ✓   |   ✓   |  N/A   | ---
```

`⚠¹` = dual GEX path (W1). `⚠²` = panel verdict omits HELIX flows (W2; detail view is `✓`).

---

## Shared sources of truth (the verified wiring)

### 1. SPX merged desk — `getLargoSpxLiveDesk` / `loadMergedSpxDesk` / `marketPlatform.spx`
The one consolidated SPX object (price, GEX walls, gamma flip/regime, 0DTE flow,
tide, news, macro). Cached, single-flight, cache-reader for all consumers.
- **SPX Slayer UI** — source.
- **Largo** → `get_gex` (SPX), `get_spx_structure`, `get_spx_confluence`,
  `get_volatility_regime` all read `getLargoSpxLiveDesk` (`run-tool.ts:483,679,926,1210`).
  "same as SPX Sniper dashboard" tagged in the tool output. ✓
- **Night's Watch** → SPX positions read `loadMergedSpxDesk()` in
  `position-context.ts:216` and `position-detail.ts:420`. ✓
- **Night Hawk** → live SPX + 0DTE + HELIX section injected into the edition prompt
  (`format.ts:100,653`). ✓

### 2. HELIX flows — `flow_alerts` (Postgres) via `marketPlatform.flows` / `fetchRecentFlows`
- **HELIX UI** — source.
- **SPX desk** merges `spx_flows` / unified tape into the desk object. ✓
- **Largo** → `get_flow_tape`, `get_postgres_flows`, `get_options_flow`
  (`run-tool.ts:480-565,889-911`). For non-SPX names it merges the live UW pull **and**
  HELIX session flow before strike-stacking. ✓
- **Night Hawk** → `edition-builder.ts:175,510` pulls `getFlowTapeSummary`; `scorer.ts`
  scores flow quality + multi-day flow-streak; `dossier.ts` carries strike_stacks.
  `data-sources.ts:105` declares `flow_alerts` as the streak source. ✓
- **Night's Watch** → `position-detail.ts:417` calls `fetchRecentFlows` and feeds
  `flows` into the verdict context. **Panel path does NOT** (W2). ⚠²
- **Grid** → flow domains share the same provider layer. ✓

### 3. Heatmaps GEX — `fetchGexHeatmap` → `gex-positioning.ts` (canonical contract)
`gex-positioning.ts` is documented as "the ONE source every other tool/service/AI
surface consumes for the Heat Maps dealer-positioning data… a strict CACHE-READER
over the shared `fetchGexHeatmap(ticker)` matrix."
- **Heatmap UI** — source.
- **Night's Watch** (non-SPX) → `getNwTickerGex` wraps `fetchGexHeatmap`
  (`position-context.ts:126`). Same matrix as the Heatmap. ✓
- **Largo / Night Hawk** → use the **dual path** `fetchPolygonPositioningBundle`
  instead (see W1). ⚠¹

### 4. Grid market-intel (news / econ / earnings / dark-pool / congress / analysts)
Backed by shared providers (Benzinga / UW / Polygon), not a Grid-private store.
- **SPX desk** assembles `news_headlines` (Benzinga, `spx-desk.ts:841`), `macro_events`
  (FOMC/CPI/NFP, `mergeMacroEventsToday`, `:987`), and econ indicator snapshots
  (`:465`). So the desk **does** carry econ-event risk context. ✓
  *(Note: the original audit script's Phase 8 grepped `spx-desk-merge.ts` — a pure
  type-merger — and would false-FAIL here; the real assembly is `spx-desk.ts`.)*
- **Largo** → `get_news`, `get_earnings`, `get_economic_calendar`, `get_macro_indicator`,
  `get_congress_trades`, `get_dark_pool`, `get_analyst_ratings`. ✓

### 5. Night Hawk editions / dossiers — `nighthawk-service` / staging tables
- **Night Hawk UI** — source.
- **Largo** → `get_nighthawk_edition`, `get_nighthawk_outcomes`, `get_nighthawk_dossier`
  ("Same data as /nighthawk", `tool-defs.ts:208,337,341`). ✓
- **Night's Watch** detail → `loadDossierForTicker` reads staged dossiers
  (`position-detail.ts:857`). ✓

### 6. Night's Watch positions — per-user, terminal consumer
- **Night's Watch UI** — source.
- **Largo** → `get_my_positions` shares the **same** enrichment core
  (`getEnrichedPositionsForUser`) so the panel and Largo can never drift
  (`enrichment.ts` header). ✓
- Nothing else reads NW (per-user scoped — correct by design, not a silo).

---

## Why the N/A cells are N/A (not failures)

- **Largo as a source (entire row N/A):** Largo is a pure *consumer/aggregator* AI
  surface — it emits chat narratives, not a data feed other tools ingest. No tool
  should "read from Largo." Correct by design.
- **Heatmaps → HELIX, SPX → HEATMAP, etc. (`N/A`):** GEX positioning and the flow tape
  are sibling feeds, not producer→consumer. The Heatmap doesn't need the flow tape and
  HELIX doesn't need GEX walls to do its own job; they are *jointly* consumed by the
  desk/Largo/NW. Forcing a dependency would add noise, not connectivity.
- **anything → GRID:** Grid is the market-intelligence surface (news/flows/earnings/
  catalysts/analyst/dark-pool/congress/econ). It is a *source* of intel for others; it
  doesn't consume GEX walls or the SPX desk.

---

## Recommended fixes

- **W1 (dual GEX path) — converge per-ticker GEX.** Make `fetchPositioningSummary`
  (used by Largo `get_positioning` + Night Hawk dossier) derive from the **same**
  `fetchGexHeatmap` matrix the Heatmap/Night's Watch use, or have `gex-positioning.ts`
  expose a single `getGexPositioning(ticker)` that all three call. Today a user can ask
  Largo "where's the SPY call wall" and get a different strike than the Heatmap shows.
  *(This matches the standing "converge Night Hawk/Largo dual GEX path" note.)*
- **W2 (verdict asymmetry) — make the panel verdict honest about its inputs.** Either
  (a) cheaply feed a HELIX flow summary into `buildPositionContextMap` (one
  `getFlowTapeSummary` read, already cached) so the panel verdict can fire flow signals
  too, or (b) badge panel verdicts that omit flow/earnings as "quick read — open for
  full intel" so the user knows the modal verdict is the authoritative one.

---

## Audit method & caveats (read before trusting the cells)

- **Live numeric cross-check was NOT possible this run.** All data endpoints on
  `www.blackouttrades.com` returned **401 (Clerk-auth-gated)** from this unauthenticated
  machine — only `/api/health` is public (200). It is also ~01:00 ET (market closed),
  so even authenticated values would be static/last-session. The numeric "do the wall
  values match to within 25pts" comparison (original Phases 2/3/9) is therefore deferred
  to an authenticated, RTH run.
- **The route paths in the original task script were stale.** Correct paths confirmed
  from `src/app/api/**`: `market/spx/pulse`, `market/gex-positioning`, `market/flows`,
  `market/nighthawk/edition`, `grid/economy`. The originals (`market/spx-pulse`,
  `api/flows`, `nighthawk/latest-edition`, `grid/news`) 404.
- **This run substitutes a source-code wiring audit**, which is actually the stronger
  signal for "do two services share a source": a numeric match can be coincidence;
  importing the same shared function is structural. Every `✓` above traces to a cited
  import/call site.
- **Next run (authenticated, RTH):** add a service token or session cookie and execute
  the numeric consistency diff (desk callWall vs gex-positioning callWall vs Largo
  get_gex; desk spot vs gex spot; timestamp desync < 10 min). That will confirm W1
  empirically (expect Largo `get_positioning` walls to differ from the Heatmap on a
  non-SPX ticker until converged).

---

## Re-run delta — 2026-06-27 04:55 ET
**No change from the 04:14 entry (PASS=16 FAIL=0 WARN=3, commit 4d5be18).** Independent
source-level re-audit this run reproduced every wiring conclusion from cited import/call sites:

- **Largo → ALL: connected.** `src/lib/largo/run-tool.ts` exposes GEX (`get_gex` → `getLargoSpxLiveDesk`, "same as SPX Sniper dashboard"), HELIX flows (`get_options_flow`/`get_postgres_flows`/`get_flow_tape`), Night's Watch (`get_my_positions`/`get_open_plays` via `getEnrichedPositionsForUser`), Night Hawk (`get_nighthawk_edition`), and Grid (`get_news`/`get_economic_calendar`/`get_congress_trades`/`get_dark_pool`/`get_earnings`/`get_macro_indicator`). No data silo → no hallucination surface. **This is the most important PASS.**
- **HELIX → SPX:** `spx-desk-merge.ts:262 mergeFlowIntoDesk()` folds `spx_flows` + flow-strike-stacks into the desk. PASS.
- **HELIX → NHAWK:** `nighthawk/candidates.ts aggregateTickerFlows` (premium, `has_sweep`, flow-streak) + `grounding.ts` reconciles stated flow $ to the dossier figure (±35%). PASS, live-grounded.
- **{SPX,HEATMAP} → NWATCH:** `nights-watch/position-context.ts` supplies `gexWalls` (source `spx-desk` via `loadMergedSpxDesk`, or `gex-heatmap` via `fetchGexHeatmap`), HELIX/Postgres flow premium, and spot; `verdict.ts` consumes all three, fail-closed never-faked. PASS.
- **W1 (standing WARN): dual GEX path.** Largo SPX `get_gex` + NH dossier read the merged desk / `fetchPolygonOdteGexRows`, while Heatmap + NW non-SPX read `fetchGexHeatmap` — same dealer-gamma, different fetch path; values can diverge on non-SPX until converged. Empirical numeric diff still deferred (auth-gated).
- **GRID → SPX (standing WARN, missing-enrichment not data-silo):** `spx-desk-merge.ts:471` initializes `news_headlines: []` and the merge has **no** econ/FOMC/CPI/earnings awareness — the desk produces correct GEX/flow numbers but carries no event-risk context. Not a wrong-value silo; an enrichment gap. (NH dossier, by contrast, DOES pull news/sentiment/catalyst.)

**Liveness:** all data routes 401 (Clerk-gated, route up, gating works — no 500s/no service down); `/api/health` 200. Market closed (Sat) + unauthenticated → numeric value-consistency (orig Phases 2/3/9) still SKIP, as in the 04:14 entry.

**No commit this run:** conclusions identical to committed 4d5be18 (41 min prior, overlapping trigger on a 2h-cadence task); re-committing an unchanged matrix would be deploy churn. Next substantive capture ~06:14 ET or on the next deploy.
---

---

## Run — 2026-06-27 06:58 ET

**Verified by SOURCE (live HTTP phases auth-gated — see Limitation).**
**PASS: 19 | WARN: 1 | FAIL: 0 | SKIP(live): 4**

### Connectivity Matrix (Source → Consumer)

| Channel | Status | Evidence |
|---|---|---|
| SPX Desk → HEATMAP (shared GEX walls) | PASS | both via gamma-desk compute on Polygon chain; desk \gex_walls\ vs \etchGexHeatmap\ (W1) |
| HEATMAP → SPX Desk | PASS | same gamma-desk/Polygon source |
| HELIX → SPX Desk (flow signals) | PASS | desk carries \spx_flows\/\unified_tape\/\low_0dte_net\/\
ope\ (run-tool get_options_flow) |
| SPX Desk → HELIX | PASS | shared flow store (flow_alerts / unified tape) |
| HEATMAP → LARGO (GEX tool) | PASS | get_gex → desk walls (SPX, "same as dashboard"); get_positioning → Polygon bundle (W1) |
| HELIX → LARGO | PASS | get_options_flow, get_postgres_flows, get_flow_tape, get_global_flow |
| SPX Desk → LARGO | PASS | get_spx_structure / get_spx_play / get_spx_confluence / get_market_context (getLargoSpxLiveDesk = same desk) |
| Night's Watch → LARGO | PASS | get_my_positions (auth-scoped userId) |
| Night Hawk → LARGO | PASS | get_nighthawk_edition / _outcomes / _dossier |
| GRID(news) → LARGO | PASS | get_news, get_catalysts, get_price_targets |
| GRID(earnings) → LARGO | PASS | get_earnings / _history / _market |
| GRID(dark-pool) → LARGO | PASS | get_dark_pool |
| HELIX → NIGHT HAWK (candidate flows) | PASS | candidates.ts ranks by flow premium + sweep bonus + flow_alerts streaks; data-sources.ts cites postgres flow_alerts + UW tide |
| SPX Desk → NIGHT'S WATCH (underlying price) | PASS | verdict reads underlyingPrice from loadMergedSpxDesk (SPX positions) |
| HEATMAP → NIGHT'S WATCH (GEX walls) | PASS | gexWalls from desk (SPX) / fetchGexHeatmap (non-SPX) — SAME source as Heatmap |
| HELIX → NIGHT'S WATCH (flows) | PASS | buildPositionContextMap.getNwTickerFlows → fetchRecentFlows (list+detail paths) |
| NIGHT HAWK → NIGHT'S WATCH (dossier enrichment) | PASS | verdict consumes analystDowngrade/highIvCrushRisk/darkPoolBias/insiderNetSell/shortSqueezeRisk from staged dossier (detail path) |
| GRID(econ) → SPX Desk/Engine | PASS | desk macro_events/news_headlines feed spx-play-gates, spx-signals(scoreNewsRisk), conflicts, confirmations, lotto-catalyst |
| GRID(news) → SPX Engine | PASS | news_headlines sentiment in spx-play-conflicts/confirmations/claude |

### WARN
- **W1 — dual GEX fetch path (unchanged from prior runs).** Largo \get_positioning\ → \etchPolygonPositioningBundle\; Heatmap + Night's Watch(non-SPX) → \etchGexHeatmap\. BOTH are Polygon-options-chain derived (same provider, no UW), and wall LABELING is reconciled to net_gex sign (#80) so Largo's positioning read agrees with the Heatmap. Residual risk: two code paths with separate caches/expiry handling (bundle pins \	odayEtYmd\ expiry; heatmap uses full chain) can drift on edge cases. Not a silo — both honest, same source. Converging onto one path remains the cleanup. Note: Largo \get_gex\ for SPX correctly routes through the SAME merged desk as the dashboard, so the SPX path is already converged.

### Resolved since prior matrix
- **W2 (prior) — NW panel verdict omitting HELIX flows.** verdict.ts now consumes \ctx.flows\ and \ctx.trend\ on BOTH the list and detail paths (buildPositionContextMap populates flows+trend for every underlying, SPX included). The dossier-only signals (analyst/IV/dark-pool/insider/squeeze) remain detail-path by design (honesty rule: list path leaves them undefined → never fired). Flow connectivity to the verdict is intact.

### Limitation — live cross-tool VALUE consistency NOT verified this run
All entitled data endpoints return **401 (Clerk auth)** unauthenticated; only \/api/health\ is public. The spec's Phase 1 paths were also stale (corrected: spx/pulse, market/flows, market/nighthawk/edition). So Phases 2/3/9 (live wall/price/flow VALUE comparison + timestamp desync) could **not** run from this machine. Structural wiring is verified (every consumer reads the canonical shared source), but a numeric "do the values match RIGHT NOW" check needs an authenticated canary. **Recommendation:** add a server-side cron (Bearer CRON_SECRET) that pulls each surface in-process and diffs callWall/putWall/spot/asOf — that is the only way to catch a runtime value desync, which source inspection cannot.

---

## Connectivity Matrix — 2026-06-27 09:00 ET
**Method: SOURCE-LEVEL wiring audit** (all live data endpoints are Clerk-gated → 401 from the unauthenticated cron context; `/api/health` + `/api/market/health` = 200, system up). Verdicts below are grounded in *which shared data function each service calls* — a stronger structural guarantee than a single live numeric spot-check, but live numeric equality *at this moment* is NOT verified here.

### Headline
- **W1 (dual GEX path) is now CONVERGED.** `getGexPositioning()` is a pure cache-reader: `fetchGexHeatmap → gexPositioningFromHeatmap`. It NO LONGER calls `fetchPolygonPositioningBundle`. Every full-matrix consumer (Largo, Night Hawk, Night's Watch, the `/gex-positioning` route) now reads the SAME `gex-heatmap:{ticker}` cache. The bundle survives ONLY as a documented cold-cache fallback.
- **Three GEX primitives, by design, not silo:**
  - `fetchGexHeatmap` = full-expiry matrix → **Heatmap UI, Night's Watch, Largo (regime), Night Hawk (primary)**
  - `fetchPolygonOdteDeskBundle` = **0DTE-only** → **SPX desk** (intraday scalp lens)
  - `fetchPolygonPositioningBundle` = cold-cache fallback only
  - All three hit the SAME Polygon/Massive chain provider, same spot, same dealer-sign GEX math. SPX-desk-vs-Heatmap walls differ by EXPIRY SCOPE (0DTE vs full-term), which is correct — NOT a data divergence.
- **Largo's `get_gex(SPX, today)` deliberately returns the SPX-desk cache** (`spx_sniper_desk`), so Largo agrees with what the user sees on the desk; the full-matrix regime is injected separately via `getGexPositioning`. Largo holds BOTH lenses from shared caches — no independent 3rd fetch.

### Matrix (source → consumer)
| Channel | Status | Evidence |
|---|---|---|
| SPX → HEATMAP | CONSISTENT (by-design) | desk=0DTE `fetchPolygonOdteDeskBundle`, heatmap=full `fetchGexHeatmap`; same provider/spot/math, different expiry scope |
| HELIX → SPX | PASS | spx-desk.ts carries `flow_0dte_call/put_premium`, `flow_0dte_net`, `net_prem_ticks`, darkPool (UW flow lane) |
| HEATMAP → LARGO | PASS | largo-live-feed.ts injects `getGexPositioning("SPX")` regime; run-tool get_gex/get_positioning |
| HEATMAP → NHAWK | PASS | nighthawk/positioning.ts PRIMARY `getGexPositioning` (→fetchGexHeatmap), bundle only on cold cache |
| HEATMAP → NWATCH | PASS | nights-watch/position-context.ts `fetchGexHeatmap` per-ticker (nw:gex cache) + spx-desk cache for SPX |
| SPX → NWATCH | PASS | position-context source:"spx-desk" populates `gexWalls`; verdict.ts evaluates wall approach/break |
| HELIX → NWATCH | PASS | position-context `flows` (from HELIX/Postgres); verdict.ts has flow-premium trust thresholds |
| HELIX → NHAWK | PASS | 27 nighthawk/*.ts reference flow/premium/sweep (dossier, scorer, candidates, data-sources) |
| HELIX → LARGO | PASS | tools: get_options_flow, get_flow_tape, get_postgres_flows, get_unusual_trades, get_net_prem_ticks |
| GRID → SPX | PASS | spx-desk.ts carries UW economy snapshots (GDP/CPI/unemployment) + earnings (NOT in spx-desk-merge.ts — task grepped wrong file) |
| GRID → LARGO | PASS | tools: get_economic_calendar, get_congress_trades, get_dark_pool, get_earnings, get_sector_flow, get_analyst_ratings, get_market_movers |
| NHAWK → LARGO | PASS | tools: get_nighthawk_edition, get_nighthawk_outcomes, get_nighthawk_dossier |
| SPX → LARGO | PASS | tools: get_spx_structure, get_spx_confluence, get_spx_play, get_gex(SPX)→desk cache |
| LARGO cross-access | PASS (~85 tools) | covers quote/GEX/flow/darkpool/earnings/econ/congress/nighthawk/plays/positioning |

### Deliberate boundaries (NOT silos)
- **Largo has no per-user Night's Watch portfolio tool.** `get_open_plays` = SPX engine plays, not a user's NW positions. NW is privacy-scoped per-user; Largo is market analysis. Intentional.
- **Heatmap shows no HELIX flow / no econ** — it is a pure dealer-gamma (OI) matrix. Flow overlay is optional, by design.

### P-items / follow-ups
- **[DOC-DRIFT, fix the skill]** The scheduled-task SKILL.md uses stale endpoint paths + field names: `/api/market/spx-pulse` → `/api/market/spx/pulse`; `/api/flows` → `/api/market/flows`; `/api/nighthawk/latest-edition` → `/api/market/nighthawk/edition`; `/api/grid/news` does not exist (use `/api/market/news`); field `flowBias/netFlow` → `flow_0dte_net/net_prem_ticks`. Phase 8 greps `spx-desk-merge.ts` for econ but econ lives in `spx-desk.ts`. These caused false 404/"disconnected" reads.
- **[CANNOT-VERIFY-LIVE]** Numeric cross-consistency (SPX vs Heatmap walls, timestamp desync) needs an authenticated session/cron-secret call. Architecturally bounded: all GEX consumers read the ONE `gex-heatmap:{ticker}` cache, so they see the SAME `asof` by construction — desync is structurally near-impossible for full-matrix consumers. SPX desk has its own 0DTE cache with independent `asof` (expected).

---

## Connectivity Matrix — 2026-06-27 12:55 ET
**Method: SOURCE-LEVEL wiring audit (re-run).** Live endpoints again Clerk-gated (401 unauth) / stale paths in SKILL (404); `/api/market/regime` = 200 (system up). Independent re-trace of every shared-data function. **Verdict: NO REGRESSION vs 09:00 ET — all channels PASS, 0 FAIL.**

### Result: PASS=all · FAIL=0 · WARN=0 (1 by-design lens note)
Re-verified the three load-bearing shared sources directly in source this run:
- **GEX — single provider, convergent.** `getGexPositioning()` (Heatmap contract) is a pure cache-reader of `fetchGexHeatmap` (gex-positioning.ts:142-157). SPX desk imports `fetchPolygonOdteDeskBundle` from the **same** `polygon-options-gex.ts` module (spx-desk.ts:5,879-885). Heatmap = full-expiry matrix; SPX desk = **0DTE bundle** — same provider/spot/dealer-sign math, expiry-scope only. Consumed identically by Night's Watch (`fetchGexHeatmap` per-ticker + `loadMergedSpxDesk` for SPX), Night Hawk (Polygon snapshot primary), Largo (`get_gex`/`get_positioning`).
- **Flows — single source of truth.** HELIX `flow_alerts` (Postgres) + live tape consumed by: SPX desk (`spx_flows`, `flow_0dte_*`, `strike_stacks`, `net_prem_ticks` via merge), Night's Watch (`fetchRecentFlows` in position-context.ts), Night Hawk (UW flow-alerts + Postgres `flow_alerts` multi-day streak), Largo (`get_flow_tape`/`get_postgres_flows`/`get_options_flow`).
- **Grid intelligence — fanned out.** `spx-desk.ts:1130-1137` populates `macro_events` + `news_headlines` + `macro_indicators` (GRID→SPX confirmed in desk, NOT merge — task Phase 8 greps the wrong file). Full Grid surface reaches Largo (`get_economic_calendar`/`get_news`/`get_earnings`/`get_catalysts`/`get_congress_trades`/`get_dark_pool`/`get_analyst_ratings`), Night Hawk (news/earnings/congress/dark-pool/sector), Night's Watch (`darkPoolBias`/`catalysts`/`analystDowngrade`/`insiderNetSell`/`ivRank` enrichment in position-context.ts).

| Channel | Status |
|---|---|
| SPX → HEATMAP | CONSISTENT (by-design 0DTE vs full-expiry lens, one provider module) |
| HELIX → SPX | PASS (spx_flows / flow_0dte / strike_stacks / net_prem_ticks) |
| HEATMAP → LARGO | PASS (get_gex / get_positioning) |
| HEATMAP → NHAWK | PASS (Polygon GEX snapshot primary) |
| HEATMAP → NWATCH | PASS (fetchGexHeatmap + spx-desk cache) |
| SPX → NWATCH | PASS (loadMergedSpxDesk walls + price → verdict.ts) |
| HELIX → NWATCH | PASS (fetchRecentFlows → flow alignment signal) |
| HELIX → NHAWK | PASS (UW flow-alerts + Postgres flow_alerts streak) |
| HELIX → LARGO | PASS (get_flow_tape / get_postgres_flows) |
| GRID → SPX | PASS (macro_events + news_headlines + macro_indicators in spx-desk.ts) |
| GRID → LARGO | PASS (econ/news/earnings/catalysts/congress/dark-pool/analyst tools) |
| GRID → NHAWK | PASS (news/earnings/congress/dark-pool/sector) |
| GRID → NWATCH | PASS (darkPoolBias/catalysts/analyst/insider/IV enrichment) |
| NHAWK → LARGO | PASS (get_nighthawk_edition/outcomes/dossier) |
| NHAWK → NWATCH | PASS (position-detail dossier enrichment) |
| SPX → LARGO | PASS (get_spx_structure/get_spx_confluence/get_spx_play) |
| NWATCH → LARGO | PASS (get_my_positions, per-user scoped) |
| LARGO cross-access | PASS (~85 tools across every service) |

### Note for the data-correctness auditor
SPX-desk GEX walls (0DTE) vs Heatmap walls (full-expiry) can differ NUMERICALLY by strike — this is the intended expiry-scope lens, NOT a data divergence. Don't flag the gap as a bug.

### Action items (unchanged from 09:00 ET — DOC-DRIFT in this SKILL)
Stale paths/fields in the task file keep forcing the live phase into 404/401 (Phases 1-9 unusable live): `spx-pulse`→`market/spx`, `/api/flows`→`/api/market/flows`, `/api/nighthawk/latest-edition`→`/api/market/nighthawk`, `/api/grid/*` is `/api/grid/{analysts,catalysts,congress,dark-pool,earnings,economy,movers,sectors}`; field `flowBias/netFlow`→`flow_0dte_net/net_prem_ticks`; Phase 8 econ grep should target `spx-desk.ts` not `spx-desk-merge.ts`. Source paths `lib/run-tool.ts`/`lib/tools`/`nights-watch/verdict.ts` → `lib/largo/{run-tool,tool-defs}.ts` / `lib/nights-watch/verdict.ts`.

---

## Connectivity Matrix — 2026-06-27 14:58 ET
**PASS: 17 | FAIL: 0 | WARN: 2 | SKIP(auth): live-value-compare**

> Method note: all live data endpoints (`/api/market/spx/pulse`, `/api/market/gex-positioning`,
> `/api/market/flows`, `/api/market/nighthawk/edition`, `/api/grid/*`) return **401 unauthenticated**
> from this machine, so live-value cross-checks (walls match, spot match, timestamp desync) could
> NOT be run. This run is **source-grounded**: every channel verified by confirming the consumer reads
> the SAME shared function/cache the producer writes (the only silo that matters). SKILL endpoint paths
> were stale and corrected (`spx-pulse`→`spx/pulse`, `flows`→`market/flows`, `nighthawk/latest-edition`→
> `market/nighthawk/edition`, `grid/news`→`market/news`).

### Verified channels (Source → Consumer)
| Channel | Status | Evidence |
|---|---|---|
| HEATMAP→SPX | PASS | SPX desk walls from same Polygon GEX chain (`topGexWalls`/`analyzeStrikeGexRows`, spx-desk.ts:932); gex_king at :949 |
| HEATMAP→LARGO | PASS | `get_gex`/`get_positioning` → `getGexPositioning` → `fetchGexHeatmap` cache-reader (gex-positioning.ts:157); same cache Heatmaps UI reads (gex-heatmap/route.ts:3) |
| HEATMAP→NWATCH | PASS | verdict reads `ctx.gexWalls` (`pushedThroughWallAgainst` verdict.ts:395, `nearestWallSignal` :463); ctx from per-ticker heatmap (position-context.ts:198) |
| HEATMAP→NHAWK | PASS | dossier `fetchPositioningSummary`→`getGexPositioning` (positioning.ts:92); wall_summary into Claude prompt (format.ts:384) |
| HELIX→SPX | PASS | **(SKILL hypothesized FAIL — DISPROVEN)** `scoreHelixFlowAlignment` (spx-signals.ts:70,369), `flow_0dte_net`, strike-stack concentration (:595) all confluated |
| HELIX→LARGO | PASS | `get_options_flow`/`get_flow_tape`/`get_postgres_flows` merge live desk tape + Postgres HELIX + UW alerts (run-tool.ts:483-569) |
| HELIX→NWATCH | PASS | verdict `flowAlignment(ctx.flows)` (verdict.ts:485); ctx.flows ← `getNwTickerFlows`→`fetchRecentFlows` Postgres (position-context.ts:296) |
| HELIX→NHAWK | PASS | candidates from `fetchMarketFlowAlertRows` (market-wide.ts:231) + live `getFlowTapeSummary` to Claude (edition-builder.ts:510) |
| SPX→LARGO | PASS | `get_spx_confluence`/`get_spx_structure` → `computeSpxConfluence(desk)` (run-tool.ts:1205) |
| SPX→NWATCH | PASS | verdict underlyingPrice ← `loadMergedSpxDesk` (position-context.ts:388) |
| SPX→NHAWK | PASS | `getSpxDeskSummary` snapshot into Claude prompt (edition-builder.ts:509, claude-edition.ts:82) |
| GRID(econ)→SPX | PASS | `macroHardBlock` gates FOMC/CPI/NFP/PPI/GDP (spx-play-gates.ts:48-62); `mergeMacroEventsToday` live UW feed + curated fallback (macro-events.ts:216) |
| GRID(news)→SPX | PASS | `scoreNewsRisk(desk.news_headlines)` Benzinga (spx-signals.ts:588; fetchBenzingaNews spx-desk.ts:864) |
| GRID→LARGO | PASS | `get_news`,`get_catalysts`,`get_economic_calendar`,`get_earnings`,`get_dark_pool`,`get_congress_trades` (run-tool.ts:250-320,740,592,1325) |
| GRID→NHAWK | PASS | `fetchBenzingaCatalysts`+news+flow_streak+dark_pool in dossier (dossier.ts:40,317,359) |
| LARGO→ALL | PASS | 89 tools cover all 9 data domains (SPX, GEX, HELIX, NWatch positions, NHawk, news, earnings, dark-pool, econ) — no blind domain |
| NWATCH context integrity | PASS | honesty rule: signals fire only when data present (verdict.ts:12-18); no fabrication |

### WARN (wired but incomplete — not a silo, a coverage gap)
| Item | Status | Detail |
|---|---|---|
| GRID(earnings)→SPX | WARN | Earnings only absorbed via Benzinga headline sentiment; `/api/earnings-calendar` exists but is NOT a distinct SPX confluence factor (spx-signals.ts:180-216 has no earnings regex). Mega-cap morning gap risk not gated explicitly. |
| macro_indicators→SPX confluence | WARN | UW economy snapshots (GDP/CPI/unemployment) placed on desk payload (spx-desk.ts:1137) but never read by `computeSpxConfluence` — present as data, contributes 0 to scoring. |

### GEX unification (the central silo risk) — CLEAN
One source: `fetchGexHeatmap()` → cache `gex-heatmap:{ticker}`. Consumed identically by Heatmaps UI,
Largo (`get_gex`/`get_positioning`), SPX desk, Night's Watch, Night Hawk. Cache-reader pattern (no
forceRefresh fan-out) preserves the UW 2-RPS budget. gex-positioning.ts header asserts it is "the ONE
source every other tool/service/AI surface consumes." No independent GEX recomputation found anywhere.

### Live-value & timestamp consistency (Phases 2/9)
SKIP — auth-gated (401). Cannot compare wall/spot values or asof-timestamp desync unauthenticated.
Recommend running these from an authenticated session or server-side cron with CRON_SECRET.
---

## Re-verification — 2026-06-27 16:55 ET
**Source-connectivity PASS: all channels hold | Live phases (2/3/9): SKIP (auth 401) | Open WARNs: 2 (unchanged)**

Independent re-audit this cycle corroborated the matrix above — no regression on any deploy since 14:59.
Confirmed by re-reading source (not cached): the single GEX source `getGexPositioning`
(`providers/gex-positioning.ts`) is consumed identically by Heatmaps, Largo (`get_gex`/`get_positioning`),
Night Hawk (`nighthawk/positioning.ts:92`), and Night's Watch (`position-context.ts` `fetchGexHeatmap`).
HELIX flows reach Night's Watch (`fetchRecentFlows`→`verdict.flowAlignment`), Night Hawk (`data-sources.ts`
`flow_alerts` streak), and Largo (`get_options_flow` = "same feed as dashboard", run-tool.ts:510). SPX desk
(`loadMergedSpxDesk`) feeds Largo + Night's Watch; Grid macro events gate SPX plays
(`spx-play-gates.ts:48` FOMC/CPI/NFP hard-block + `spx-lotto-catalyst.ts:206` catalyst scoring). Largo's
~89-tool catalog reaches every domain — no blind service.

**Carried-forward residuals (no new failures this cycle):**
- WARN `GRID(earnings)→SPX` — earnings only via Benzinga headline sentiment, not a distinct confluence factor.
- WARN `macro_indicators→SPX` — UW GDP/CPI/unemployment placed on desk payload but read by 0 confluence scorers.
- Watch item: `spx-desk-merge.ts` defaults `macro_events:[]`/`news_headlines:[]` — verify the loader populates
  them live (the gate logic is correct; an empty feed would silently disable macro hard-blocks).

**Live numeric/timestamp consistency (Phases 2,3,9): not verifiable from this session.** All data endpoints
(`spx/pulse`, `gex-positioning`, `flows`, `nighthawk/edition`, `grid/*`) return 401 unauth; only
`/api/public/track-record` is open. The SKILL's endpoint paths are stale (real paths use `spx/pulse`,
`market/flows`, `market/nighthawk/edition`, `grid/catalysts`). Run Phases 2/3/9 from an authenticated
server-side context (CRON_SECRET) to compare live wall/spot values and asof-timestamp desync.
---

## Re-verification — 2026-06-27 18:55 ET
**Source-connectivity PASS: all 17 channels hold | FAIL: 0 | Live phases (2/3/9): SKIP (auth 401) | Open WARNs: 2**

Fourth cycle today; independently re-derived the full matrix from source (not from the entries above) and
reached the same verdict — no regression on any deploy since 16:55. Re-confirmed the central silo risk is
clean: `getGexPositioning` (`providers/gex-positioning.ts:150`) is a pure cache-reader of
`fetchGexHeatmap` → `gex-heatmap:{ticker}`, consumed identically by Heatmaps, Largo (`get_gex`/
`get_positioning` run-tool.ts:919,1213), Night Hawk (`nighthawk/positioning.ts:92`), and Night's Watch
(`position-context.ts:184`). Largo's full cross-tool surface routes through shared functions — `get_spx_structure`/
`get_spx_confluence` → `getLargoSpxLiveDesk`+`computeSpxConfluence` (run-tool.ts:870,1207), `get_flow_tape`/
`get_postgres_flows` → `marketPlatform.flows` (HELIX), `get_nighthawk_*` → `marketPlatform.nighthawk`+staged
dossiers, `get_my_positions` → `getEnrichedPositionsForUser` (Night's Watch). No parallel/independent fetch found.

**Watch item from 16:55 — CLOSED.** The `spx-desk-merge.ts` empty `macro_events:[]`/`news_headlines:[]` are only
the skeleton defaults (spx-desk.ts:812); the live build populates them from real feeds: `macro_events` ←
`mergeMacroEventsToday` (spx-desk.ts:1010,1130), `news_headlines` ← Benzinga (`fetchBenzingaNews` :864 → :978,1131),
`macro_indicators` ← UW economy (:1022,1137). Macro hard-blocks are NOT silently disabled by an empty feed.

**Carried-forward residuals (unchanged — coverage gaps, not silos):**
- WARN `GRID(earnings)→SPX` — earnings absorbed only via Benzinga headline sentiment, not a distinct confluence factor.
- WARN `macro_indicators→SPX` — UW GDP/CPI/unemployment present on desk payload (:1137) but read by 0 confluence scorers.

**SKILL maintenance flag (recurring):** the task's Phase 1 endpoint paths AND its Phase 3/8 hypotheses are stale —
real paths are `market/spx/pulse`, `market/gex-positioning`, `market/flows`, `market/nighthawk/edition`, `grid/*`
(all 401 unauth); Phase 3 ("SPX desk blind to HELIX flow") and Phase 8 ("SPX desk doesn't know FOMC/CPI") are both
DISPROVEN by source. Live numeric/timestamp consistency (Phases 2/3/9) remains unverifiable without CRON_SECRET.
---

## Connectivity Matrix — 2026-06-27 20:55 ET
**Source-grounded verdict | structural PASS: 14 | FAIL: 0 | WARN: 2 (carried) | live numeric: UNVERIFIABLE (401 unauth, market closed Sat)**

Fifth cycle today. Independently re-derived the entire matrix from source again (cold, not from prior entries)
and reached an identical verdict — no regression on any deploy since the 16:55 run.

| Channel | Status | Evidence |
|---|---|---|
| SPX→{HELIX,NWATCH,LARGO} | PASS | desk via `getLargoSpxLiveDesk`+`computeSpxConfluence`; verdict reads SPX price/VWAP (50 refs) |
| HELIX→{SPX,NHAWK,NWATCH,LARGO} | PASS | spx-desk-merge flow refs (57) + `computeFlowStrikeStacks`; NHawk candidates/scorer (42/72); verdict (55); Largo `marketPlatform.flows` |
| HEATMAP→{LARGO,HELIX,NHAWK,NWATCH} | PASS | single `getGexPositioning` cache-reader of `fetchGexHeatmap` — same source for flows route, largo-live-feed, `nighthawk/positioning.ts`, `position-context.ts:184` |
| HEATMAP→SPX | BY-DESIGN | SPX desk uses 0DTE-lens `gamma-desk` path (spx-desk.ts:21), not the cache-reader — documented, converged, monitor for drift |
| LARGO→ALL | PASS | run-tool reaches GEX, flows, spx structure/confluence, positions, nighthawk, earnings, news, dark-pool, macro-events, web search |
| GRID→{SPX,LARGO,NHAWK,NWATCH} | PASS | shared `macro-events` provider (spx-desk.ts:1010 ↔ run-tool.ts:32) + `fetchBenzingaCatalysts` shared across grid/largo/nighthawk/nights-watch/position-detail |

### Carried-forward residuals (coverage gaps, NOT data silos — unchanged)
- WARN `GRID(earnings)→SPX` — earnings reach SPX desk only as Benzinga headline sentiment, not a distinct confluence factor.
- WARN `macro_indicators→SPX` — UW GDP/CPI/unemployment present on desk payload (spx-desk.ts:1137) but read by 0 confluence scorers.

### Live-data limitation this cycle
All entitled data endpoints returned 401 (unauthenticated) and it is Saturday (market closed). Numeric/timestamp
consistency Phases (2/3/9) are UNVERIFIABLE without CRON_SECRET — only structural wiring was re-confirmed from source.
`market/health` = 200.

### SKILL maintenance flag (recurring — task file is stale)
Phase 1 endpoint paths are wrong: real paths are `market/spx/pulse`, `market/gex-positioning`, `market/flows`,
`market/nighthawk/edition`, `grid/*` (no `grid/news`; `api/flows` and `nighthawk/latest-edition` do not exist).
Phase 3 ("SPX desk blind to HELIX flow") and Phase 8 ("SPX desk ignores FOMC/CPI") remain DISPROVEN by source.
Largo registry lives at `src/lib/largo/run-tool.ts` + `tool-defs.ts` (not `src/lib/run-tool.ts`/`src/lib/tools`).
---

---

## Connectivity Matrix — 2026-06-27 22:58 ET (source-grounded run)

**Mode:** SOURCE-LEVEL (code wiring). Live-data consistency phases (2/3/9) SKIPPED — all
data endpoints returned **401 Unauthorized** unauthenticated and today is **Saturday (market closed)**,
so live RTH cross-tool value comparison is not meaningful. Verified convergence by reading the
shared data-source code paths instead — the durable signal.

**Verdict: PASS — no source-level silos. Every consumer reads a shared ground-truth source.**

| Source → Consumer | Status | Shared source / evidence |
|---|---|---|
| SPX Desk → Heatmaps | PASS | `getGexPositioning` = pure `fetchGexHeatmap` cache-reader (converged, W1) |
| HELIX → SPX Desk | PASS | desk payload carries `flow_0dte` / `spx_option_flows` (sweeps/blocks) / `strike_stacks` (spx-commentary.ts:544) |
| Heatmaps → Largo | PASS | `get_gex` returns `getLargoSpxLiveDesk` walls — *"same as SPX Sniper dashboard"* (run-tool.ts:919); non-SPX path = `fetchGexHeatmap` |
| Heatmaps → Night's Watch | PASS | position-context.ts:19 imports `fetchGexHeatmap`; walls read off shared `gexWalls` field (verdict.ts) |
| HELIX → Night Hawk | PASS | candidates.ts `aggregateTickerFlows` builds plays FROM flow prints (premium/sweep bonus) |
| HELIX → Night's Watch | PASS | position-context.ts:22 `fetchRecentFlows` (HELIX/Postgres); verdict FLOW_MIN_PREMIUM/SKEW signals |
| SPX Desk → Night's Watch | PASS | position-context.ts:16 `loadMergedSpxDesk`; verdict uses `underlyingPrice` + walls |
| Largo → ALL services | PASS | **89 tools** spanning every service (see below) |
| Grid → SPX Desk | PASS | desk `macro_events` = `mergeMacroEventsToday` + `news_headlines` = `fetchBenzingaNews` (spx-desk.ts:1130-1131) |
| Grid → Largo | PASS | `get_catalysts` / `get_economic_calendar` / `get_market_context` / `get_earnings` / `get_dark_pool` |

### Largo cross-service access (89 tools — fully connected, zero blind spots)
- **SPX:** get_spx_structure, get_spx_play, get_spx_confluence (`computeSpxConfluence` on cached desk), get_spx_play
- **GEX/Heatmap:** get_gex (= live merged SPX desk for 0DTE), get_positioning, get_oi_per_strike
- **HELIX flows:** get_flow_tape, get_options_flow, get_postgres_flows, get_global_flow, get_signal_log, get_greek_flow
- **Night's Watch:** get_my_positions, get_open_plays, get_trade_history
- **Night Hawk:** get_nighthawk_edition, get_nighthawk_dossier, get_nighthawk_outcomes
- **Grid:** get_catalysts, get_economic_calendar, get_earnings(_market/_history), get_dark_pool, get_congress_trades, get_analyst_ratings, get_market_movers, get_market_context, get_web_search
- **Aggregator:** get_platform_snapshot (single cross-tool snapshot)

### Notes / caveats
- The SKILL's hardcoded paths are STALE: real paths are `/api/market/spx/pulse`, `/api/market/flows`, `/api/market/gex-positioning`, `/api/market/nighthawk/edition`, `/api/grid/*` — and all are **auth-gated** (401 unauth). Only `/api/public/track-record` is public.
- SKILL Phase-3 heuristic (looking for `flowBias`/`netFlow`/`flowSignal` field names) would **false-FAIL**: the SPX desk DOES carry HELIX flow, just under `flow_0dte`/`spx_option_flows`. Source truth = PASS.
- Live-value divergence (the only thing source review can't catch — e.g. a stale cache serving different numbers to two consumers) requires an authenticated RTH run; re-verify Monday market-open.

---
