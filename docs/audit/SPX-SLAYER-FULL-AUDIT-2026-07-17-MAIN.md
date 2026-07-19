# SPX Slayer Full-Stack Audit — Sandbox `main` (ECS staging)

**Date:** 2026-07-17  
**Repo:** `coreentryadmin-web/blackout-web-sandbox`  
**Branch audited:** **`main`** @ `c0754d1d` (`fix(nighthawk): spot-anchored entries + ticker-family dedup #400`)  
**Deploy line:** ECS staging builds from **`main`** (`.github/workflows/ecr-push-staging.yml` → `branches: [main]`)  
**Live URL:** https://staging.blackouttrades.com/dashboard  

**Prior audit caveat:** `docs/audit/SPX-SLAYER-FULL-AUDIT-2026-07-17.md` (PR #403) was written against **`blackout-web-sandbox`** branch @ `91b606f4` — a **different line** (~68 commits diverged). **This document is ground truth for what ECS runs today.**

**Tests on `main`:** `npm test` → **3671 pass / 0 fail**

---

## Executive summary

Sandbox **`main`** ships SPX Slayer as **desk v3** (Largo | 0DTE matrix ladder | Vector chart embed). The play engine uses **Cortex evidence gating** (not Claude) with a **78-point cold-buy floor**. 0DTE Command hard-enforces **G-4 (VIX)** and **G-6 (cross-system conflict)**. **`/vector`** has the new **VectorPulse** signal feed; the SPX embed is **chart-only** (no pulse panel, no Slayer terminal, no Trade Alerts kanban).

The stack is production-shaped and well-tested, but **γ-regime coherence is broken on `main` itself**: `gamma_regime` uses hysteresis while `above_gamma_flip`, confluence, pulse merge, and voice all use raw `price vs flip`. That is **worse than the sandbox branch**, which partially fixed server-side coherence in `5a9962ff` (not merged to `main`).

---

## 1. Desk v3 layout

### Columns (desktop)

| # | Column | Component | Notes |
|---|--------|-----------|-------|
| 1 | Largo intel | `SpxCommentaryRail.tsx` | Client voice brain; play lifecycle via `useSpxPlay` (2s) |
| 2 | Dealer γ map | `SpxGexMatrixHeatmap.tsx` | Ladder **default**; table via toggle; shared Y-axis with chart |
| 3 | Vector | `VectorPageShell` `embed="chart-only"` | 0DTE + 3m defaults; alerts toast; **no VectorPulse** |

**Removed from render tree (code retained):** `SpxTradeAlerts`, `SpxDeskTerminal`, `SpxSessionTimeBar`.

**Focus mode:** `F` / toolbar button; side rails collapse to strips.

**iOS:** Vector | Matrix | Intel segments.

**Contract tests:** `src/features/spx/spx-dashboard-layout.test.ts` — enforces v3 triple, no TradeAlerts/terminal.

### SSR entry

`src/app/(site)/dashboard/page.tsx` → `loadVectorSeedProps("SPX")` when Vector tool accessible.

---

## 2. Data lanes

```
GET /api/market/spx/bootstrap  → seeds pulse, flow, desk SWR keys (gexHeatmap always null)
GET /api/market/spx/pulse      → ~1s REST (5s when SSE up)
SSE /api/market/spx/pulse/stream → ~250ms spot overlay
GET /api/market/spx/desk       → ~5s RTH full rebuild
GET /api/market/spx/flow       → ~2s tape/GEX overlay
mergeDeskLayers + mergePulseIntoDesk → useMergedDesk
```

**Separate from merged desk:** matrix SWR → `/api/market/gex-heatmap?ticker=SPX` (5s RTH/off-hours on `main`).

| Constant | `main` default |
|----------|----------------|
| Full desk | 5s |
| Matrix | 5s |
| Pulse REST (SSE off) | 1s |
| Pulse REST (SSE on) | 5s |
| Flow | 2s |
| Play read cache | 2s |

Server GEX cache: `GEX_HEATMAP_CACHE_SEC` default **5s** (uniform all tickers).

---

## 3. Largo / BIE / commentary

### Three brains (unchanged architecture)

| Brain | Module | Consumer |
|-------|--------|----------|
| Voice (4-signal) | `spx-live-voice.ts` | Rail pinned card, events |
| Confluence (15+) | `spx-signals.ts` | Play engine, Largo THESIS |
| Synthesis | `spx-desk-synthesis.ts` | Largo brief sections |

### Client rail

- **Does not** call `POST /api/market/spx/commentary` (route exists; `requestSpxCommentary` in `api.ts` has **zero callers**)
- Pinned bias refresh: 5 min or bias-key change
- Event dedupe: 4 min cooldown

### Largo Q&A

`POST /api/market/largo/query` → `composeSpxDeskBrief` — READ (voice) + THESIS (confluence) can **contradict** with no reconciliation.

### Staging BIE

- `isStagingBieMode()` — deterministic unless `STAGING_CLAUDE=1`
- Staging full playbook allowlist when `PLAYBOOK_LIVE_ALLOWLIST` unset

---

## 4. Matrix / GEX

### Pipeline

Polygon banded chain → `buildGexHeatmapUncached` → Redis/in-mem ~5s → `/api/market/gex-heatmap` → matrix SWR.

### Scope mixing (P2)

Same panel mixes:

- **Desk header:** near-term aggregate + **UW WS ladder** when live (`gexSnapshotForPrice` in `spx-desk.ts:1575–1594`)
- **Matrix header Net / γ-flip:** 0DTE column (`gex-odte-scope.ts`)
- **Ladder bars:** near-term `strike_totals`
- **Ladder markers:** 0DTE-scoped king/walls/flip
- **UW banner:** near-term cross_validation

### Spot divergence (P2)

Live spot line uses desk pulse; `odteLevels` recompute uses heatmap API `spot` (~5s poll).

### Matrix default view (P2 automation)

UI defaults to **ladder**; E2E scripts wait for `.spx-gex-matrix-table` rows.

---

## 5. Vector chart (SPX channel)

### SPX embed (`embed="chart-only"`)

- Same SSR seed path as `/vector`
- SSE stream + bar backfill + wall polls
- `onPriceScaleRender` → matrix ladder Y-alignment
- **Explicitly no** VectorPulse, GEX ladder rail, scanner, or terminal (`VectorPageShell.tsx:298–340`)

### Full `/vector` page (not SPX desk)

- **VectorPulse** — live signal feed (flows, wall events, technicals, playbook lines) — `VectorPageShell.tsx:401+`
- Left GEX ladder rail + chart + pulse column

### P2 — Narration gap on SPX desk

Members on `/dashboard` get chart + alert toasts but **not** the Pulse feed that replaced the old Slayer terminal on `/vector`. Play visibility is Largo lifecycle lines only.

### P2 — DTE toggle

Member can change Vector DTE on embed; matrix stays 0DTE-oriented → semantic drift while Y-axis still aligns.

---

## 6. Technicals & signals

### `buildPlayTechnicals` (`spx-play-technicals.ts`)

Polygon m1/m3/m5 bars, opening range, VWAP streaks, MTF confirmation, breakouts. Wired to playbook matchers + Largo server brief — **not** passed to commentary rail (no RSI voice events on client).

### `computeSpxConfluence` (`spx-signals.ts:273–290`)

**On `main` — raw flip compare:**

```typescript
const aboveFlip = price > desk.gamma_flip;
```

Does **not** use `desk.above_gamma_flip` or hysteresis label.

---

## 7. Playbook / play engine

### Writer vs reader

| Path | Mutates? |
|------|----------|
| `GET /api/cron/spx-evaluate` | Yes — authoritative |
| `GET /api/market/spx/play` | No — ~2s cached read |

### Commit gate on `main` (not sandbox branch)

| Control | `main` |
|---------|--------|
| Cold-buy approval | **Cortex** `evaluateCortexForCommit` (`spx-play-engine.ts:1062+`) |
| Cold-buy min score | **78** (`spx-play-config.ts:140`) |
| Cortex required for cold BUY | Default **true** |
| Claude play gate | **Removed** from engine path |

### 0DTE Command gates on `main`

**G-4 (VIX)** and **G-6 (cross-system conflict)** promoted to **hard gates** 2026-07-16 (`zerodte/gates.ts`). Sandbox `blackout-web-sandbox` branch still runs many of these in calibration-only mode.

### Staging enablement

All PB-01..14 allowlisted when staging URL + no env override. **Confirm ECS secret** `PLAYBOOK_LIVE_ALLOWLIST` — infra script may still pin PB-01–03.

### P1 — Primary direction vs confluence

Live gate checks primary **id** but not `playbook_primary_direction === confluence.direction` — same gap as sandbox branch audit.

### P2 — Invisible play UI

Engine + Discord + cron active; desk shows play state only via Largo lifecycle strings. Kanban/hero dormant.

---

## 8. γ-regime coherence (critical — on `main` today)

July sandbox fix `5a9962ff` is **not on `main`**. Worse: `main` computes **both** hysteresis regime **and** raw side-of-flip in the same function:

```1587:1591:src/features/spx/lib/spx-desk.ts
  const gRegime = gammaRegimeWithHysteresis(price, gammaFlip, lastGoodGammaRegime);
  return {
    gamma_flip: gammaFlip,
    above_gamma_flip: gammaFlip != null ? price > gammaFlip : false,
    gamma_regime: gRegime !== "unknown" ? gRegime : lastGoodGammaRegime,
```

Inside the 2pt buffer band, **`gamma_regime` and `above_gamma_flip` contradict each other on the server snapshot.**

Additional raw-compare paths:

| Location | Line | Issue |
|----------|------|-------|
| `spx-desk-merge.ts` | 390 | Pulse overwrites `above_gamma_flip` every ~1s |
| `spx-live-voice.ts` | 186 | `aboveFlip: price >= flip` |
| `spx-signals.ts` | 274 | Confluence γ factor uses raw compare |

**Fix target:** Port `isAboveFlipFromRegime` from sandbox `5a9962ff` + pulse/voice/signals alignment + regression tests.

---

## 9. Findings register (`main`)

### P1

| ID | Finding |
|----|---------|
| P1-1 | Server `above_gamma_flip` raw vs hysteresis `gamma_regime` in same snapshot (`spx-desk.ts:1587–1591`) |
| P1-2 | Pulse merge raw overwrite (`spx-desk-merge.ts:390`) |
| P1-3 | Voice `aboveFlip` raw compare (`spx-live-voice.ts:186`) |
| P1-4 | Confluence γ factor raw compare (`spx-signals.ts:274`) |
| P1-5 | Largo dual bias — voice READ vs confluence THESIS (`spx-desk-brief.ts`) |
| P1-6 | React #418 hydration — no post-mount guard on `main` (sandbox has fix; `useMergedDesk` sync sessionStorage in `useRef` initializer) |
| P1-7 | Catalyst HTML entities leak — `composeCatalystLine` raw title slice (`spx-live-voice.ts:779–783`); sandbox has `sanitizeFeedText` |
| P1-8 | ET session forces RTH OPEN with stale price (`useMergedDesk.ts:219–226`) |

### P2

| ID | Finding |
|----|---------|
| P2-1 | Matrix scope mixing (0DTE vs near-term vs UW WS desk walls) |
| P2-2 | matrixSpot vs overlaySpot for level math |
| P2-3 | VectorPulse on `/vector` only — SPX embed chart-only |
| P2-4 | Play engine UI removed — Largo lifecycle only |
| P2-5 | E2E expects table DOM; UI default ladder |
| P2-6 | Primary playbook ≠ confluence direction not gated |
| P2-7 | Orphan `/api/market/spx/commentary` + dead `requestSpxCommentary` |
| P2-8 | `SpxSessionTimeBar` removed; Largo feed cache/events orphaned |
| P2-9 | AGENTS.md poll/cache docs stale (still says 8s / `SPX_GEX_HEATMAP_CACHE_SEC`) |

### P3

| ID | Finding |
|----|---------|
| P3-1 | Dead bootstrap `gexHeatmap` seed path |
| P3-2 | Commentary `persist()` stale pinned closure |
| P3-3 | `playClaudeGateEnabled()` naming stale (Cortex path) |
| P3-4 | Duplicate layout test files (`spx-dashboard-layout.test.ts` vs `lib/`) |

---

## 10. `main` vs `blackout-web-sandbox` branch

**Merge-base:** `ed7bc8d6` · ~67 scoped files diverged · branches **not in sync**

| Dimension | **`main` (ECS staging)** | **`blackout-web-sandbox` branch** |
|-----------|--------------------------|-----------------------------------|
| Deploy | **ECS from `main`** | Old workflow targeted this branch |
| Play approval | **Cortex** + score ≥78 | Claude LLM + score ≥68 |
| 0DTE G-4/G-6 | **Hard gates** | Calibration-only |
| Vector SPX embed | Chart-only (no Pulse) | **VectorDeskTerminal** (different) |
| Desk γ coherence | Raw flip (broken vs regime) | **`isAboveFlipFromRegime`** fix |
| Hydration #418 | **Open** | Fixed |
| Catalyst HTML | **Raw titles** | `sanitizeFeedText` |
| Desk walls | **UW WS ladder** preferred | Polygon heatmap path |
| Vector extras | **VectorPulse** on `/vector` | FLOW-GEX lens, surface-seed SSR |
| Tests | 3671 | 3762 |
| FINDINGS.md | Shorter | +~1650 lines audit ledger |

**Do not treat PR #403 findings as 1:1 live staging behavior** — merge-base divergence means some sandbox-only fixes are absent on ECS, and `main` has Cortex/Nighthawk/Pulse work absent on the old branch.

---

## 11. Solid areas

- Desk v3 layout contract tests
- Cortex-gated play engine + zerodte hard gates (G-4/G-6)
- UW WS ladder integration for live desk walls
- Vector SSR seed parity; shared price scale map
- Error boundaries, halt banners, GEX stale honesty
- 3671 unit tests green on `main`
- ECR auto-deploy on `main` push (#396)

---

## 12. Recommended fix order (PRs to `main`)

1. **γ-coherence port** — cherry-pick/adapt `5a9962ff` + pulse + voice + signals + tests  
2. **Hydration guard** — port `SpxDashboard` fix from sandbox branch  
3. **`sanitizeFeedText`** on catalyst line  
4. **Largo bias reconciliation** or explicit dual-label UX  
5. **Play direction alignment gate** when live gate on  
6. **Matrix labeling** + E2E ladder selectors  
7. **AGENTS.md** poll/deploy branch update (`main`, 5s defaults)

---

## 13. Validation (against live ECS = `main`)

```bash
npm test
npx tsc --noEmit
npm run lint:brand
npm run validate:staging
npm run validate:staging-rth      # weekday
npm run validate:spx-rth
npm run validate:staging-vector-e2e
```

Confirm deployed image: last **`main`** push that triggered `ecr-push-staging.yml`.

---

## 14. Key file index

| Area | Path |
|------|------|
| Desk shell | `src/features/spx/components/SpxDashboard.tsx` |
| Merge | `src/features/spx/hooks/useMergedDesk.ts`, `spx-desk-merge.ts` |
| Desk build | `src/features/spx/lib/spx-desk.ts` (`gexSnapshotForPrice`) |
| Voice | `src/lib/bie/spx-live-voice.ts` |
| Signals | `src/features/spx/lib/spx-signals.ts` |
| Matrix | `src/features/spx/components/SpxGexMatrixHeatmap.tsx` |
| Vector embed | `src/features/vector/components/VectorPageShell.tsx` |
| Vector Pulse (full page) | `src/features/vector/components/VectorPulse.tsx` |
| Play engine | `src/features/spx/lib/spx-play-engine.ts` |
| Deploy | `.github/workflows/ecr-push-staging.yml` |

---

*Audit branch: `cursor/spx-slayer-main-audit-261c` · Base: **`main`** · Documentation only.*
