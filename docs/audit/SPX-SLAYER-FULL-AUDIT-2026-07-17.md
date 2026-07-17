# SPX Slayer Full-Stack Audit — Staging Sandbox

**Date:** 2026-07-17  
**Repo:** `coreentryadmin-web/blackout-web-sandbox`  
**Branch audited:** `blackout-web-sandbox` @ sync point before this doc  
**Scope:** Staging only — **not** prod `blackout-web` / Railway `main`  
**URL:** https://staging.blackouttrades.com/dashboard  

**Supersedes:** `docs/audit/SPX-SLAYER-DEEP-AUDIT-2026-07-16.md` (narrower γ-flip focus)  
**Test baseline:** `npm test` → **3762 pass / 0 fail**

---

## Executive summary

SPX Slayer on staging is **desk v3**: a **three-column** surface (Largo intel | 0DTE GEX matrix | embedded Vector chart). Trade Alerts kanban and the Slayer terminal were removed 2026-07-13 in favor of Vector as the single price-action hero. The stack is mature — error boundaries, hydration guard, hysteresis on server desk build, 3762 unit tests, extensive playbook/zerodte coverage — but **coherence bugs** and **scope mismatches** show up when multiple “brains” (voice, confluence, synthesis, pulse merge, matrix scoping) read the same desk differently.

### Top issues (fix-first)

| Sev | Issue | Surfaces affected |
|-----|--------|-------------------|
| **P1** | γ-flip side re-derived from raw `price vs flip` in pulse merge + voice | Largo rail, commentary events, matrix header vs spot line |
| **P1** | **Two bias models** in one Largo answer (voice READ vs confluence THESIS) | Largo Q&A, member trust |
| **P1** | Playbook **primary direction ≠ confluence direction** not gated on BUY | Play engine, evidence panel, staging live entries |
| **P2** | Matrix **0DTE levels** vs **near-term strike_totals** vs **desk header** use different scopes | Ladder bars, Net column, γ-flip label, UW banner |
| **P2** | Matrix spot for flip math vs **desk pulse** for live spot line | Ladder spot row, flip crossing UX |
| **P2** | E2E scripts expect **table** DOM; UI defaults to **ladder** | `validate:spx-e2e`, member dashboard audits |
| **P2** | Staging allowlist **code vs ECS env** drift (all PB vs PB-01–03) | Which playbooks can actually BUY on staging |
| **P3** | Orphan `/api/market/spx/commentary` + dead `requestSpxCommentary` | Maintenance / doc drift |
| **P3** | `SpxSessionTimeBar` removed but Largo feed cache/events remain | Dead plumbing |

---

## Methodology

1. Static code review across UI, hooks, APIs, BIE, vector, matrix build, playbook engine, zerodte gates.  
2. Cross-reference with existing audits (`FINDINGS.md`, `PLAYBOOK-BUG-AUDIT-2026-07-11.md`, July 14 coherence fix `5a9962ff`).  
3. Trace data from Polygon chain → cache → API → SWR → components.  
4. Map staging-only flags (`isStagingDeploy`, `playbookStagingLabEnabled`, BIE mode).  
5. Full `npm test` on HEAD.

No prod traffic, Railway deploys, or Clerk prod user minting in this audit.

---

## 1. Desk v3 layout (`/dashboard`)

### 1.1 What the member sees

```
Desktop (≥1024px):
┌─────────────────┬─────────────────┬──────────────────────────────┐
│ Largo           │ Dealer γ map    │ SPX Vector (chart-only)       │
│ commentary rail │ ladder (default)│ 0DTE / 3m defaults, toolbar   │
│ ~0.85fr         │ ~0.95fr         │ ~2.2fr                        │
└─────────────────┴─────────────────┴──────────────────────────────┘

Focus (F / Esc): side columns → 3rem rails; chart expands (1fr)
iOS: segmented Vector | Matrix | Intel (one panel)
```

**Entry:** `src/app/(site)/dashboard/page.tsx` — `requireTier("premium")`, SSR `loadVectorSeedProps("SPX")` when Vector tool accessible.

**Shell:** `src/features/spx/components/SpxDashboard.tsx`

| Column | Component | Data |
|--------|-----------|------|
| Intel | `SpxCommentaryRail.tsx` | Client voice brain + `useSpxPlay` (2s) |
| Matrix | `SpxGexMatrixHeatmap.tsx` + `SpxStrikeLadderAxis.tsx` + `SpxMatrixTapeStrip.tsx` | Own SWR on `/api/market/gex-heatmap?ticker=SPX` + desk overlays |
| Chart | `VectorPageShell` embed `chart-only` | SSR seed + SSE `/api/market/vector/stream?ticker=SPX` |

**Removed from desk (still in repo):** `SpxTradeAlerts.tsx`, `SpxDeskTerminal.tsx`, `SpxSessionTimeBar.tsx`.

### 1.2 Resilience (solid)

- Per-column `SpxPanelErrorBoundary` (`SpxDashboard.tsx:52–68`)
- Desk lane failure amber banner when full desk fails with no cache
- Halt / degraded halt banners (`shouldShowHaltDegradedBanner`)
- Hydration guard: one skeleton beat before sessionStorage desk (`SpxDashboard.tsx` ~134–188) — fixes React #418
- Focus mode keeps matrix/commentary hooks polling while collapsed

---

## 2. Data lanes — merged desk

### 2.1 `useMergedDesk` (single desk brain)

**File:** `src/features/spx/hooks/useMergedDesk.ts`  
There is **no** separate `useSpxBootstrap` — bootstrap is SWR key `"spx-desk-bootstrap"` → `GET /api/market/spx/bootstrap`.

```
bootstrap (desk + flow + pulse seeds)
    → pulse REST (1s off-SSE / 10s on-SSE) + SSE usePulseStream (~250ms spot overlay)
    → full desk GET /api/market/spx/desk (~8s RTH)
    → flow GET /api/market/spx/desk/flow (~2s RTH)
    → mergeDeskLayers → mergePulseIntoDesk → merged SpxDeskPayload
    → sessionStorage throttle 7.5s + flush on tab hide
```

**Poll constants:** `src/features/spx/lib/spx-desk-poll-ms.ts`

| Lane | RTH default |
|------|-------------|
| Pulse | 1s (10s when SSE connected) |
| Full desk | 8s |
| Flow | 2s |
| Matrix (separate hook) | 6s |
| Member play read cache | 2s |

### 2.2 P1 — Pulse merge breaks γ hysteresis

**File:** `src/features/spx/lib/spx-desk-merge.ts:388–390`

Server desk (`spx-desk.ts:1357–1376`) derives `above_gamma_flip` from `gamma_regime` (2pt hysteresis band). Pulse merge **overwrites** every ~1s:

```typescript
above_gamma_flip: base.gamma_flip != null ? price > base.gamma_flip : base.above_gamma_flip,
```

Pulse does not update `gamma_regime`. Inside the band: header/confluence/synthesis can say “mean revert / above flip” while merged desk flips on raw spot.

**Fix:** Preserve `base.above_gamma_flip` or run `gammaRegimeWithHysteresis(price, flip, lastRegime)` on pulse path.

### 2.3 P2 — ET session override with stale price

**File:** `useMergedDesk.ts:219–226` — forces `market_open: true` / `"RTH OPEN"` when ET says open but pulse+desk aren’t live, if cached `price > 0`. Can show open session label on stale spot when pulse lane is entirely down.

### 2.4 Dead bootstrap matrix seed

Bootstrap API always returns `gexHeatmap: null` (`bootstrap/route.ts:18–19`) to avoid CF 524. `useMergedDesk` still contains seed-via-bootstrap logic — harmless but misleading; matrix cold-starts via sessionStorage + direct fetch only.

---

## 3. Largo / BIE / commentary

### 3.1 Three parallel “brains”

| Brain | Module | Used by |
|-------|--------|---------|
| **Voice (4-signal)** | `spx-live-voice.ts` — `deriveSpxBias`, events | Rail pinned card, API commentary |
| **Confluence (15+ factors)** | `spx-signals.ts` — `computeSpxConfluence` | Play engine, Largo THESIS, synthesis |
| **Synthesis** | `spx-desk-synthesis.ts` | Largo brief sections |

### 3.2 Client rail (primary live commentary)

**File:** `SpxCommentaryRail.tsx`

- Runs **client-side** on merged desk tick — **does not** call `/api/market/spx/commentary`
- Pinned bias card: re-voice on bias key change or every 5 min
- Transition feed: `detectSpxVoiceEvents` + 4 min dedupe
- Play lifecycle lines: `useSpxPlay` → `detectPlayVoiceEvents` (2s poll — exists for commentary only since Trade Alerts removed)
- Persistence: `spx-largo-feed-cache.ts` → sessionStorage

Staging kicker: “BlackOut Intelligence” when `isStagingDeploy()`.

### 3.3 Largo Q&A path

`POST /api/market/largo/query` → `composeSpxDeskRead` → `composeSpxDeskBrief`:

- **READ line:** voice bias (`composeBiasVoice` + `deriveSpxBias`)
- **THESIS / MECHANIC / …:** confluence-driven synthesis
- **`bias` field on brief:** `confluence.bias` — can **contradict READ**

**P1 — Dual bias in one answer:** Member can see bearish READ + bullish THESIS (A grade) with no reconciliation (`spx-desk-brief.ts` ~550–560, 648).

### 3.4 P1 — Voice `aboveFlip` ignores desk label

**File:** `spx-live-voice.ts:187`

```typescript
aboveFlip: price != null && flip != null ? price >= flip : null,
```

Contradicts `spx-desk.ts` hysteresis policy. Affects rail triggers, `composeBiasVoice`, transition events. Confluence/synthesis correctly use `desk.above_gamma_flip`.

### 3.5 Trigger / watch level divergence

| Source | Logic | Max |
|--------|-------|-----|
| Rail “Triggers” | Levels that **flip** voice bias | 3 |
| Rail “Levels to watch” | Nearest levels + distance | 3 |
| Brief `watch` | γ-flip, VWAP, confluence stop/target, nearest walls | 5 |
| King wall | Voice: argmax \|net_gex\|; desk: strike totals king | — |

### 3.6 Orphan server commentary route

- `POST /api/market/spx/commentary` — 5-min shared window, deterministic (no LLM since 2026-07-13)
- `requestSpxCommentary()` in `api.ts:76` — **exported, zero callers**
- Route registry still documents GET + “LLM cost” in places — stale metadata

### 3.7 Staging BIE mode

- `isStagingBieMode()` → BIE-only unless `STAGING_CLAUDE=1`
- `classifyBieStagingFallback` never returns null on staging
- `largoEnabled()` always `true` (staging branch is no-op)

### 3.8 RSI voice events never fire on rail

`voiceSnapshotFromDesk` supports `opts.rsi` for RSI transition events (`spx-live-voice.ts` ~1022–1033). Rail never passes RSI from `buildPlayTechnicals` — technicals only wired on server Largo/shadow paths.

---

## 4. Matrix / GEX data

### 4.1 Cell pipeline

```
Polygon banded chain (±6% SPX, paginated)
  → accumulateContract (GEX/VEX/DEX/CHARM per cell)
  → near-term strike_totals (8 expiries) + full expiry axis
  → in-mem + Redis cache ~5s (GEX_HEATMAP_CACHE_SEC)
  → GET /api/market/gex-heatmap?ticker=SPX
  → cross_validation vs UW (near-term scoped)
  → SpxGexMatrixHeatmap SWR (6s RTH / 20s off)
```

**Display shared with Thermal:** `src/lib/gex-heatmap-display.ts`

### 4.2 Scope mixing (P2 — trust / labels)

Three different “scopes” appear in one panel:

| UI element | Scope |
|------------|--------|
| Desk header walls/flip/king | Near-term aggregate (`getGexPositioning`, 8 expiries) |
| Matrix header Net / γ-flip label | **0DTE column** (`gex-odte-scope.ts`) |
| Ladder bar widths | `block.strike_totals` (near-term) |
| Ladder king/wall/flip markers | **0DTE-scoped** `odteLevels` |
| Table “Net” column | Near-term `strike_totals` |
| UW banner | Near-term cross_validation |

**Effect:** Header “Net GEX” (0DTE) ≠ table Net column (near-term). Ladder bar magnitude can disagree with marked king when 0DTE ≠ aggregate.

### 4.3 Spot divergence (P2)

```typescript
// SpxGexMatrixHeatmap.tsx
const matrixSpot = data?.spot ?? 0;           // heatmap API (~6s poll)
const overlaySpot = liveSpot ?? matrixSpot;   // desk pulse (~1s)
const odteLevels = recomputeScopedGexLevels(odteTotals, matrixSpot); // uses matrixSpot, not overlaySpot
```

Live spot **line** tracks pulse; flip/king math uses cached heatmap spot → crossing semantics can lag.

### 4.4 Doc drift (P3)

`AGENTS.md` still says matrix poll **8s** and `SPX_GEX_HEATMAP_CACHE_SEC` default **8**. Code: client **6s**, server cache **5s** uniform (`polygon-options-gex.ts`), env `SPX_GEX_HEATMAP_CACHE_SEC` **not referenced**.

### 4.5 vs Thermal `/heatmap`

Thermal = full analytic surface (4 lenses, expiry scope UI, overlays, shift, client `force=1` on spot divergence). SPX rail = compact 0DTE-oriented ladder synced to Vector Y-axis. Same API route, different poll cadence and features.

### 4.6 0DTE intel feed OR-break proxy (P2)

**File:** `spx-odte-intel-feed.ts:466–492` — when `opening_range` absent, OR breaks use HOD/LOD with “(HOD proxy)” copy. Can mislead vs true opening range.

---

## 5. Vector chart (SPX channel embed)

### 5.1 Integration

- SSR: same `loadVectorSeedProps("SPX")` as `/vector` page — intentional parity
- Embed: `defaultDteHorizon="0dte"`, `defaultTimeframe={3}`, `embed="chart-only"`
- Live: SSE `createVectorEventSource(SPX)` + bar backfill + walls poll 5s + wall-history 60s
- SPX-only: SPY volume merge on bars (`/api/market/vector/spy-volume` 60s)

### 5.2 Shared price axis (solid)

`VectorChart` emits `VectorPriceScaleMap` (250ms throttle) → `SpxStrikeLadderAxis` — bars and spot line align to chart pixels when Vector is mounted.

**Degraded:** If `vectorSeed` null (launch gate), matrix uses linear ±1.2% fallback — alignment intentionally off.

### 5.3 P2 — DTE horizon divergence

Matrix always reads full SPX heatmap 0DTE column logic. If member toggles Vector DTE to weekly/all on embed, **chart walls rescope** but matrix does not follow. Y-axis still aligns; GEX semantics diverge.

### 5.4 P2 — Weekend/holiday 0DTE fallback asymmetry

- Matrix: strict 0DTE null → front expiry + amber “No 0DTE column today”
- Vector: `expiriesForHorizon("0dte")` falls back to nearest live expiry (`vector-dte-horizon.ts:94–98`)

Chart may show Monday walls while matrix labels no 0DTE.

### 5.5 Vector GEX grid ≠ desk matrix

Background chart heatmap is strike×time reconstructed along session spot path (`vector-gex-heatmap-server.ts`) — not the same object as left-rail matrix cells.

---

## 6. Technicals & signals

### 6.1 `buildPlayTechnicals`

**File:** `spx-play-technicals.ts`

- Polygon index minute bars + RSI
- Opening range (frozen high/low after `playOpeningRangeMinutes`)
- VWAP streaks, m1 EMA9, m3/m5 MTF confirmation, breakout flags (PDH/PDL/HOD/LOD/VWAP)
- Used by: playbook matchers, shadow panel, Largo brief, **not** client commentary rail

### 6.2 `computeSpxConfluence`

**File:** `spx-signals.ts`

- 15+ weighted factors (flow, tide, GEX walls, HELIX, news, session window, γ-regime via `desk.above_gamma_flip`)
- Drives: play engine grade/action, Largo THESIS, synthesis
- **Regression tests** for γ hysteresis on confluence path (`spx-signals.test.ts`) — voice not covered

### 6.3 Play read path still active

`useSpxPlay` polls `/api/market/spx/play` every 2s when live — powers commentary play lifecycle only on desk v3. Extra load, not incorrect.

---

## 7. Playbook / 0DTE engine

### 7.1 SPX play lifecycle

**Mutating writer:** `GET /api/cron/spx-evaluate` → `runSpxEvaluator(mutate: true)`  
**Member read:** `GET /api/market/spx/play` → `getSpxPlayState(mutate: false)` (~2s cache)

Pipeline: `loadMergedSpxDesk` → `buildPlayTechnicals` → `matchPlaybooksShadow` (PB-01..14) → verdict guards → `pickPrimaryPlaybook` → gates → Claude approval → `openPlay` (one row per session).

### 7.2 P1 — Primary direction ≠ confluence direction

**Files:** `spx-play-gates.ts:231–270`, `spx-play-engine.ts:1304–1320`

Live gate checks primary **id** and allowlist but **not** `playbook_primary_direction === confluence.direction`. Engine opens with `direction: dir` from confluence while stamping `playbook_id` from primary — evidence panel can show PB-02 short trigger on a long open.

### 7.3 Staging enablement three-way drift (P2)

| Source | Allowlist |
|--------|-----------|
| Code (no env) | All PB-01..14 (`spx-play-config.ts:467–474`) |
| ECS `apply-staging-env-overrides.mjs` | `PLAYBOOK_LIVE_ALLOWLIST=PB-01,PB-02,PB-03` |
| Tests | `spx-staging-full-enablement.test.ts` assumes all-14; other tests assume PB-01–03 default |

Also: staging runs all matchers via regime router, but A17 **fail-closes** on `unknown` EMA regime — shadow fires, BUY blocked.

### 7.4 0DTE Command (parallel stack)

`src/lib/zerodte/*` — multi-ticker ledger, G-1..G-6 + Cortex. Shares 9:45 opening unlock with SPX. **G-6** cross-conflict with Slayer is **calibration-only** today — opposing correlated plays can still commit while logging conflict.

### 7.5 Trade governor (solid)

`trade-governor.ts` — 5 entries / 3 losses / VIX halts / per-PB trigger caps / option spread overlay. Well unit-tested.

---

## 8. Staging environment summary

| Concern | Staging |
|---------|---------|
| Playbook live gate | Always on (`playbookStagingLabEnabled`) |
| Allowlist | All PB if env unset; ECS may override to PB-01–03 |
| Regime router | All 14 eligible |
| Legacy confluence BUY | Allowed without primary when staging + no primary fired |
| BIE | Deterministic; Claude opt-in via `STAGING_CLAUDE=1` |
| UW | 1 RPS, narrowed WS tickers |
| Postgres | RDS snapshot + independent ingest |
| Clerk | Satellite of prod |

**Sandbox vs prod fork:** ~68 commits ahead / ~53 behind `origin/main` (do not merge without explicit request).

---

## 9. Findings register

### P0 — None identified in static audit

No confirmed “always wrong trade signal” without market-data keys; premium tools degrade gracefully. Runtime P0 requires RTH staging validation.

### P1

| ID | Finding | Location |
|----|---------|----------|
| P1-1 | Pulse merge raw γ-flip overwrite | `spx-desk-merge.ts:388–390` |
| P1-2 | Voice `aboveFlip` raw compare | `spx-live-voice.ts:187` |
| P1-3 | Largo dual bias (READ vs THESIS) | `spx-desk-brief.ts:550–560` |
| P1-4 | Primary playbook id ≠ confluence direction on BUY | `spx-play-gates.ts`, `spx-play-engine.ts:1304–1320` |

### P2

| ID | Finding | Location |
|----|---------|----------|
| P2-1 | Matrix scope mixing (0DTE vs near-term vs desk header) | `SpxGexMatrixHeatmap.tsx`, `gex-odte-scope.ts` |
| P2-2 | matrixSpot vs overlaySpot for level math | `SpxGexMatrixHeatmap.tsx:244–255` |
| P2-3 | Vector DTE toggle vs matrix fixed 0DTE | `SpxDashboard.tsx`, `VectorPageShell` |
| P2-4 | E2E expects `.spx-gex-matrix-table`; UI default ladder | `scripts/spx-dashboard-e2e-audit.mjs` |
| P2-5 | Staging allowlist code vs ECS env | `spx-play-config.ts` vs infra overrides |
| P2-6 | Unknown regime: matchers fire, A17 blocks BUY | `playbook-regime-router.ts`, `spx-play-gates.ts:251–252` |
| P2-7 | ET session open override stale price | `useMergedDesk.ts:219–226` |
| P2-8 | OR-break HOD/LOD proxy in intel feed | `spx-odte-intel-feed.ts:466–492` |
| P2-9 | Desk verifier uses raw spot≥flip invariant | `desk-verifier.ts:194–209` |
| P2-10 | 0DTE Command G-6 calibration-only vs Slayer | `zerodte/gates.ts` |

### P3

| ID | Finding | Location |
|----|---------|----------|
| P3-1 | Orphan commentary API + dead client export | `commentary/route.ts`, `api.ts:76` |
| P3-2 | Session time bar removed; feed cache orphaned | `SpxDashboard.tsx`, `spx-largo-feed-cache.ts` |
| P3-3 | AGENTS.md cache/poll intervals stale | `AGENTS.md` |
| P3-4 | Dead bootstrap gexHeatmap seed path | `useMergedDesk.ts`, `bootstrap/route.ts` |
| P3-5 | Commentary rail `persist()` stale pinned closure | `SpxCommentaryRail.tsx:257` |
| P3-6 | News events skip `sanitizeFeedText` | `spx-live-voice.ts` ~1065 vs ~786 |
| P3-7 | No governor stress test multi-PB concurrent | `spx-staging-full-enablement.test.ts` |

---

## 10. Solid areas (keep)

- Server desk hysteresis + comments (`spx-desk.ts`, `gamma-desk.ts`)
- July 14 coherence fix for confluence/synthesis path (`5a9962ff`)
- Playbook verdict guard + FSM sync + extensive matcher tests
- Vector SSR seed parity + price scale map + replay guards
- Matrix/Thermal shared cell formatting
- Error boundaries, halt banners, GEX stale badge, UW divergence banner
- Full test suite green; static layout contracts (`spx-dashboard-layout.test.ts`)
- Zerodte gate/governor/Cortex unit coverage

---

## 11. Test & automation gaps

| Gap | Risk |
|-----|------|
| No cross-coherence test: voice vs confluence vs synthesis same desk fixture | P1 bugs recur |
| No `mergePulseIntoDesk` hysteresis regression test | P1-1 |
| E2E ladder-default not covered | False RED in CI/scripts |
| No Playwright for commentary rail bias/feed | UI regressions |
| No integration: multi-PB fire → single `spx_open_play` + direction alignment | P1-4 |
| `requestSpxCommentary` / route untested end-to-end in UI | Dead code rots |
| Scoped `npm test -- src/features/spx` invalid (node treats dir as file) | Misleading local runs |

**Correct scoped run:** `npm test` (full) or explicit globs like `src/features/spx/**/*.test.ts`.

---

## 12. Recommended fix order (sandbox PRs)

1. **Coherence bundle:** P1-1 + P1-2 + tests; optionally P2-9 verifier  
2. **Largo alignment:** P1-3 — reconcile READ with THESIS or label explicitly  
3. **Play engine:** P1-4 direction alignment gate on prod + staging when live gate on  
4. **Matrix honesty:** P2-1 labels (“Net 0DTE” vs “Net near-term”); P2-2 use overlaySpot for odteLevels when live  
5. **Ops/docs:** P3-3 AGENTS.md; P2-4 E2E ladder selectors; P2-5 document ECS allowlist vs code  
6. **Cleanup:** P3-1 remove or wire commentary route; P3-2 remove dead session bar plumbing  

---

## 13. Validation commands

```bash
npm test
npx tsc --noEmit
npm run lint:brand
npm run validate:staging          # deploy harness
npm run validate:staging-rth      # weekday RTH
npm run validate:spx-rth          # SPX-specific (update E2E for ladder)
npm run validate:staging-vector-e2e
```

**Manual RTH checklist:** `docs/spx/SPX-PLAYBOOK-LIVE-VALIDATION-CHECKLIST.md`, `docs/checklist/spx-slayer-july14.md`

---

## 14. Key file index

| Area | Paths |
|------|-------|
| Desk shell | `src/features/spx/components/SpxDashboard.tsx` |
| Merged desk | `src/features/spx/hooks/useMergedDesk.ts`, `spx-desk-merge.ts`, `spx-desk.ts` |
| Commentary | `SpxCommentaryRail.tsx`, `spx-live-voice.ts`, `spx-desk-brief.ts`, `spx-desk-synthesis.ts` |
| Matrix | `SpxGexMatrixHeatmap.tsx`, `spx-strike-ladder.ts`, `gex-odte-scope.ts`, `polygon-options-gex.ts` |
| Vector | `VectorPageShell.tsx`, `VectorChart.tsx`, `vector-seed-props.ts` |
| Technicals | `spx-play-technicals.ts`, `spx-signals.ts` |
| Play engine | `spx-play-engine.ts`, `spx-play-gates.ts`, `spx-evaluator.ts`, `trade-governor.ts` |
| 0DTE | `src/lib/zerodte/gates.ts`, `governor.ts`, `cortex-gate.ts`, `scan.ts` |
| APIs | `api/market/spx/*`, `api/market/gex-heatmap`, `api/market/vector/*`, `api/market/largo/query` |

---

*Full-stack audit — documentation only. Branch: `cursor/spx-slayer-full-audit-261c`. Staging sandbox only.*
