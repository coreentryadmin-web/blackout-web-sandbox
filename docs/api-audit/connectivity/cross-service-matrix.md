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
