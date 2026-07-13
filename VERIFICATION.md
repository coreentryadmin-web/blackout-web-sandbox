# VERIFICATION — SPX Slayer v3: embedded chart-only SPX Vector (branch `fix/spx-slayer-vector-desk`)

Change under test (2026-07-13, member-directed, deploy tonight): `/dashboard` becomes three
columns — Largo commentary | GEX matrix | embedded SPX Vector chart (chart-only, **no terminal
panels anywhere on SPX Slayer**). Trade Alerts + Slayer terminal removed from render (components
stay in the repo unused — one render away). Embed defaults: **0DTE horizon, 3-minute candles**.
Both `/dashboard` and `/vector` seed through the ONE shared server helper `loadVectorSeedProps`.

## Verified locally (this sandbox)

- `npx tsc --noEmit` — green (zero errors).
- `npx tsx --test src/features/vector/lib/*.test.ts` — **378/378 pass** (includes the new
  `vector-seed-props.test.ts` drift guard: both pages must use `loadVectorSeedProps`, and neither
  page may inline any seed-pipeline internal).
- `npx tsx --test src/features/spx/spx-dashboard-layout.test.ts src/features/spx/lib/spx-dashboard-layout.test.ts`
  — pass. The quad-desk layout test was rewritten for v3: bans `<SpxTradeAlerts`, `SpxDeskTerminal`,
  `spx-sniper-plays-col`, `spx-sniper-terminal-col`; requires `VectorPageShell`,
  `embed="chart-only"`, `defaultDteHorizon="0dte"`, `defaultTimeframe={3}`,
  `spx-sniper-triple--desk-v3`.
- Full spx suite: 15 failures are **pre-existing on the clean base** (reproduced via `git stash` →
  same failures with zero diff applied; env-dependent, e.g. engine tests needing runtime config).
  Untouched by this change.
- `npm run build` — completes (see PR/commit note for the run in this sandbox).
- 3-minute timeframe: **already a first-class preset** in `vector-bar-timeframes.ts`
  (`VECTOR_PRESET_TIMEFRAMES = [1, 3, 5, 15, 30, 60]`; `wallCountForTimeframe`/
  `anchorBandPctForTimeframe` carry `tf <= 3` entries; aggregation is generic and covered by the
  existing `vector-bar-timeframes.test.ts`). No type changes were needed.
- `/vector` page refactor is behavior-identical: the seed pipeline moved verbatim into
  `loadVectorSeedProps` (same calls, same order); the page renders `VectorPageShell {...seed}`.

### Layout reasoning (no live browser in this sandbox for the desk — verify post-deploy)
- No horizontal overflow by construction: the v3 grid's chart track is `minmax(0, 2.2fr)` and the
  vector column is `min-w-0 overflow-hidden`; the chart canvas is width-elastic
  (lightweight-charts resize observer). 1440px: ≈ 313px Largo / 350px matrix / 770px chart.
  1920px: ≈ 410/458/1044.
- Vertical fit: the standalone page's inline canvas height (`calc(100vh - 132px)`) is overridden
  inside `.spx-sniper-vector-col` with a flex fill chain (`height: 100% !important`, min 420px) so
  the chart fills the desk column under the Slayer header instead of forcing page scroll.
- <1024px: single-column stack (existing desk behavior); iOS shell segments are now
  Vector / Matrix / Intel.

## Post-deploy live checks (run on the deployed build; deploys settle in a few min)

1. **/dashboard renders the embedded SPX chart** — right column shows the Vector toolbar
   (timeframe select reading **3 min**, DTE toggle reading **0DTE**, indicators menu, GEX/VEX lens,
   replay), the regime banner strip, a static `SPX` ticker chip (no ticker select), the freshness
   chip, and candles + wall beads on the canvas.
2. **No terminal anywhere on /dashboard** — no Slayer desk terminal, no Vector desk terminal, no
   Trade Alerts kanban panel. Left = Largo commentary, middle = live spot + GEX matrix heatmap.
3. **DTE toggle re-scopes** (0DTE → Weekly changes walls/ladder-free chart levels) and
   **timeframe redraws** (3 min → 1 min/5 min re-aggregates candles). Indicator toggles draw.
4. **/vector unchanged** — full page still has ticker select, GEX ladder rail, desk terminal,
   alerts panel, universe scanner; defaults still Weekly + 1 min.
5. **Launch gate**: with `LAUNCHED_TOOLS` not including `vector`, a non-admin premium member sees
   the "Vector chart launching soon" note in the right column (NOT a broken chart / 403 console
   spam). Flip `LAUNCHED_TOOLS` to include `vector` for members to get the embed. Admins see it
   regardless.
6. **No console errors** at 1440px and 1920px; no horizontal scrollbar on the page body at either
   width. iOS UA (`BlackOutiOSApp`): segment bar shows Vector/Matrix/Intel and switches panels.
7. During RTH: freshness chip goes **live** and candles tick on /dashboard (SSE stream is the same
   `/api/market/vector/stream` the /vector page uses); off-hours it shows "<session> close".
8. Member alert rules saved on /vector for SPX still fire toasts on /dashboard (same
   localStorage-backed rules, evaluated by the embedded chart).
9. **Standing Vector per-push gate** (CLAUDE.md): once the deploy settles, run
   `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY npm run validate:vector-push-gate` against
   staging — the /vector surface must stay green (this change is a no-op there, but the gate is
   per-push, not per-feature).

## Rollback / restoration

Single revert of this branch's commits restores the v2 quad desk. The removed panels
(`SpxTradeAlerts`, `SpxDeskTerminal`, kanban) were not modified or deleted — re-rendering them in
`SpxDashboard` is one render away (see the WHY comment at the removal site in
`src/features/spx/components/SpxDashboard.tsx`).
