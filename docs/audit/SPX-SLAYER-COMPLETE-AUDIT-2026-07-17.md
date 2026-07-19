# SPX Slayer — Complete Audit (sandbox main)

**Date:** 2026-07-17  
**Auditor:** Cursor Cloud Agent (conversation audit consolidation)  
**Repo / branch:** `coreentryadmin-web/blackout-web-sandbox` → `main`  
**Deploy line audited:** `f72502f739f0e1a5e071db6f012f4412d009e96e`  
**ECS staging URL:** https://staging.blackouttrades.com/dashboard  
**Scope:** SPX Slayer only — `/dashboard`, desk APIs, embedded Vector, Largo commentary rail, matrix rail, play engine integration. Night Hawk, HELIX, Thermal, Grid, and iOS shell are referenced only where they integrate *into* SPX Slayer.

---

## 1. Executive summary

SPX Slayer on sandbox `main` is a **Desk v3** three-column layout: **Largo commentary** (left) · **Dealer Gamma Map / matrix** (center-left) · **embedded SPX Vector chart** (right). The former Trade Alerts kanban and Slayer terminal columns were removed 2026-07-13 in favor of a single flagship chart surface.

The architecture is **sound at the data layer** for header gamma coherence (single `(price, gammaFlip)` snapshot) and **cache-reader discipline** (Polygon heatmap → desk walls; UW WS ladder preferred when live). Several **member-visible gaps** remain from the consolidation:

| Theme | Severity | One-line |
|-------|----------|----------|
| Playbook shadow invisible on desk UI | **P1** | `playbook_shadow` ships on `/api/market/spx/play` but no dashboard panel renders it after Desk v3 |
| Vector embed launch-gated | **P1** | `vector` tool defaults `defaultLaunched: false` — non-admin members see “launching soon” |
| Cron vs member-read split | **P1** | `spx-evaluate` mutates DB; member polls use `mutate:false` + 2s cache — OR memory / open-play state can diverge |
| Cross-surface gamma scope mismatch | **P2** | Header = near-term aggregate (15 exp); matrix highlights 0DTE column; Vector embed = `0dte` horizon — kings/flips can disagree legitimately |
| Dual bias surfaces | **P2** | Largo `deriveSpxBias` (4-vote card) vs header `regime` pill (EMA trend) vs Vector regime banner — not unified |
| Largo rail blank / sparse | **P2** | Pre-existing; requires `desk.available` + live session; offline copy when stalled |
| AGENTS.md poll cadence drift | **P3** | Docs say matrix 8s RTH; code defaults 5s (`SPX_MATRIX_POLL_*`, `SPX_GEX_HEATMAP_CACHE_SEC`) |
| Staging-only VWAP unlock | **P2** | SPY volume proxy enables PB-01/PB-02 on staging; prod index VWAP stays typical-price |

**Recommended fix order:** (1) playbook shadow visibility decision, (2) Vector launch gate for staging/flagship desk, (3) cron/read OR-memory contract, (4) cross-surface scope labeling, (5) bias unification UX, (6) doc sync.

---

## 2. Scope and deploy pin

### 2.1 In scope

- Route: `src/app/(site)/dashboard/page.tsx` → `SpxDashboard`
- Client hooks: `useMergedDesk`, `useSpxPlay`, `usePulseStream`
- UI: `SpxSniperHeader`, `SpxGexMatrixHeatmap`, `SpxCommentaryRail`, `VectorPageShell` (embed)
- Server desk: `buildSpxDesk()` / `loadMergedSpxDesk()` in `src/features/spx/lib/spx-desk.ts`
- APIs:
  - `GET /api/market/spx/bootstrap`
  - `GET /api/market/spx/desk`, `/flow`, `/pulse`, `/pulse/stream`
  - `GET /api/market/gex-heatmap?ticker=SPX`
  - `GET /api/market/spx/play`
  - `GET /api/market/spx/commentary`
- Play engine: `evaluateSpxPlay`, `runSpxEvaluator`, `getSpxPlayState`
- Playbook shadow: `buildPlaybookShadowPanel`, `playbook-shadow-matcher.ts`, Postgres `spx_playbook_shadow_observations`
- Crons touching SPX: `spx-evaluate`, `desk-warm`, `heatmap-warm`, `vector-walls-warm`, `platform-warm`, `spx-signal-observe`, `spx-issues-sync`
- Integrations: Largo/BIE voice, Vector walls, UW WS, 0DTE G-6 gate, Clerk tier gate

### 2.2 Out of scope

- Standalone `/vector` page (except embed seam and shared seed path)
- `/heatmap` (BlackOut Thermal) except shared `gex-heatmap-display.ts` and `NEAR_TERM_EXPIRY_COUNT`
- Railway prod deploy (`coreentryadmin-web/blackout-web` @ `152afe6f` — separate fork; see §12)
- Native iOS Capacitor shell (loads prod URL)

### 2.3 ECS deploy line

```
f72502f7 fix(nighthawk): backfill spot-anchored entries + tiered OI + publish gate promotion (PR-N16) (#405)
```

Staging pipeline: `.github/workflows/ecr-push-staging.yml` → ECR `:staging` → ECS `blackout-staging-web`.

---

## 3. Desk v3 architecture and data flow

### 3.1 Layout (2026-07-13 consolidation)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SpxSniperHeader — spot, EMA/SMA, session, VIX, VWAP, GEX, Regime, γ Flip… │
├──────────────┬────────────────────┬──────────────────────────────────────────┤
│ Largo        │ Dealer Gamma Map   │ VectorPageShell (embed=chart-only)       │
│ Commentary   │ SpxGexMatrixHeatmap│ defaultDteHorizon=0dte, timeframe=3m     │
│ Rail         │ ladder | table     │ toolbar + regime banner + alerts toast   │
│              │ GEX/VEX lens       │ NO terminal / playbook monitor UI        │
└──────────────┴────────────────────┴──────────────────────────────────────────┘
```

**Removed from flagship render (components remain in repo):**

- `SpxTradeAlerts.tsx` — kanban + play engine cards
- Slayer desk terminal inside trade alerts
- `SpxSessionTimeBar` — session strip (focus toggle moved to Vector toolbar)

**Focus mode (`F` / `Esc`):** collapses matrix to king-strike rail + Largo to bias strip; Vector chart expands. Desktop only; iOS uses segmented `Vector | Matrix | Intel`.

### 3.2 Client data lanes (`useMergedDesk`)

| Lane | SWR key | Default poll | Source |
|------|---------|--------------|--------|
| Bootstrap | `spx-desk-bootstrap` | once + 8s dedupe | `GET /api/market/spx/bootstrap` |
| Pulse SSE | EventSource | spot ~250ms | `/api/market/spx/pulse/stream` |
| Pulse REST fallback | `spx-desk-pulse` | 1s / 5s if SSE | `/api/market/spx/pulse` |
| Flow overlay | `spx-desk-flow` | 2s | `/api/market/spx/flow` |
| Full desk | `spx-desk-full` | 5s | `/api/market/spx/desk` |
| Matrix | `/api/market/gex-heatmap?ticker=SPX` | 5s RTH & off-hours | heatmap API |
| Play state | via `useSpxPlay` | 2s | `/api/market/spx/play` |

Bootstrap seeds pulse, flow, desk, and matrix SWR caches in one round-trip (avoids four cold XHRs).

Merge order: pulse overlays spot on desk; flow merges tape/GEX strikes; sessionStorage throttled write every 7.5s.

### 3.3 Server desk pipeline (`buildSpxDesk`)

```
Polygon index snapshots (SPX, VIX, internals)
  + SPX minute bars → session VWAP/HOD/LOD (staging: SPY volume proxy)
  + daily bars → EMA/SMA, PDH/PDL
  + fetchGexHeatmap("SPX") → gexPositioningFromHeatmap → walls/flip/king/net
  + optional UW WS gex_strike_expiry ladder (preferred for wall strikes when live)
  + UW pooled batch (tide, NOPE, 0DTE flow, dark pool, IV rank, …)
  + unified tape, news, macro events, halts (UW + optional LULD)
  → SpxDeskPayload
```

**Canonical GEX:** single path via `resolveCanonicalDeskGex()` — no parallel 0DTE recompute on the desk header.

**Last-good fallback:** empty Polygon chain serves sticky walls/flip with `gex_stale` + age badge (audit gap #7a).

### 3.4 Auth and tier gates

- Page: `requireTier("premium")` on dashboard server component
- APIs: `authorizeMarketDeskApi` / `authorizeCronOrTierApi` patterns
- Clerk: staging runs as **satellite** of prod (`src/lib/clerk-env.ts`)
- Vector embed: `canAccessTool("vector")` — see §7.4

---

## 4. UI controls inventory

### 4.1 Header (`SpxSniperHeader`)

| Control / metric | Type | Data field | Notes |
|------------------|------|------------|-------|
| Product mark + title | static | — | Hidden on iOS native shell |
| Live SPX spot | display + level indicator | `desk.price` | Leads stat strip (2026-07-14) |
| EMA 20/50/200 | pills + vs-spot tone | `ema20`, `ema50`, `ema200` | Tooltips in `METRIC_TIPS` |
| SMA 50/200 | pills | `sma50`, `sma200` | |
| Session HOD/LOD/PDH/PDL | grid pills | `hod`, `lod`, `pdh`, `pdl` | |
| VIX | pill | `vix` | |
| VWAP | pill + `vw` badge | `vwap`, `above_vwap`, `vwap_volume_weighted` | Staging: true VWAP via SPY proxy |
| GEX net | pill | `gex_net` | Signed premium format |
| Regime | pill | `regime` | EMA trend inference — **not** same as Largo bias |
| γ Flip | pill + level indicator | `gamma_flip` | |
| Max Pain | pill | `max_pain` | |
| IV Rank | pill | `uw_iv_rank` | |
| GEX stale badge | alert chip | `gex_stale` | Amber when last-good walls |
| Feed stalled dimming | CSS class | `feed_stalled` | Dims entire strip |

### 4.2 Matrix rail (`SpxGexMatrixHeatmap`)

| Control | Storage key | Behavior |
|---------|-------------|----------|
| GEX / VEX lens toggle | React state | `GexHeatmapLens`; VEX auto-falls back if empty |
| Ladder / Table view | `spx-matrix-view-mode` | Default ladder (shared price axis) |
| Refresh button | — | `mutate()` on SWR key |
| Opening range overlay | props | `openingRange` from desk |
| 0DTE flow strip | props | `flow0dteNet`, call/put prem |
| Matrix tape strip | props | `unifiedTape` subset |
| Focus rail mode | prop `focus` | King-strike only on shared axis |
| Cross-validation disclaimer | API | `cross_validation` when UW diverges |

**Ladder view:** `SpxStrikeLadderAxis` uses `VectorPriceScaleMap` from embedded chart for pixel-aligned spot row.

**Table view:** up to **6** expiry columns displayed (`MAX_EXPIRY_COLS`); backend stores **15** near-term expiries.

### 4.3 Vector embed (`VectorPageShell` chart-only)

| Control | Default on SPX desk | Notes |
|---------|---------------------|-------|
| DTE horizon | `0dte` | Toggle: 0DTE / WEEKLY / MONTHLY (no “All” in UI) |
| Timeframe | 3-minute candles | Member-directed 2026-07-13 |
| Indicators menu | full Vector set | EMA, VWAP, Pivot-P, flow overlays, etc. |
| Replay | toolbar slot | Focus button injected left of Replay (desktop) |
| Regime banner | `VectorRegimeBanner` | From chart stream |
| Alert toasts | saved rules | Wall-touch alerts still fire on dashboard |
| Freshness chip | SSE-driven | “Live session” vs close label |
| Terminal / Pulse / playbook lines | **absent** | `embed=chart-only` — deliberate |

### 4.4 Largo commentary rail (`SpxCommentaryRail`)

| Surface | Behavior |
|---------|----------|
| Pinned bias card | `deriveSpxBias` → direction + conviction + voice + ≤3 triggers; refresh on bias change or 5 min |
| Event feed | Transition-only: king migrate, γ-flip cross, VWAP cross, EMA/regime, expected move, play lifecycle |
| Context chips | VWAP posture, expected move, session character, catalyst |
| Collapse toggle | `railCollapsed` local state |
| Focus strip | Vertical “LARGO” + direction color |
| Offline copy | `pickCommentaryOfflineCopy` when desk unavailable |

**Brain runs client-side** on desk ticks (~2–5s) — no extra network for commentary.

### 4.5 iOS compact shell

- `IosNativeSegment`: Vector | Matrix | Intel
- Hero spot in header when `nativeShell`
- Focus mode disabled (`compactPanels`)

### 4.6 Removed / repo-only controls

- `SpxTradeAlerts` — play kanban, engine cards, **playbook monitor**
- `SpxSessionTimeBar` — event dots (shared cache with Largo feed still exists)
- Admin `/admin` SPX panels — out of member desk scope

---

## 5. Numbers, calculations, formulas, and scopes

### 5.1 GEX heatmap — 15 near-term expiries

**Constant:** `NEAR_TERM_EXPIRY_COUNT = 15` in `src/lib/providers/polygon-options-gex.ts` (raised from 8 for Thermal density).

- **Strike band SPX:** ±6% (`SPX_HEATMAP_BAND_PCT = 0.06`)
- **Strike band others:** ±20% default
- **Axis:** ascending nearest 15 expiries + optional far-dated columns merged for display
- **`near_term_expiries`:** explicit subset for auditors — client “All” scope must sum over this set, not `expiries.slice(0,8)`

**Cell formula (dealer dollar-gamma per 1% move):**

```
GEX_strike,expiry = Σ_contracts sign(call/put) × γ × OI × 100 × spot² × 0.01
```

VEX/DEX/CHARM lenses use parallel greek columns from the same chain snapshot.

### 5.2 Desk header GEX scope

- **Source:** `gexPositioningFromHeatmap("SPX", hm)` on full heatmap
- **Walls:** top 10 two-sided ladder (`GEX_WALL_LADDER_LIMIT = 10`); UW WS ladder overrides strike set when `hasLiveGexStrikeExpiry("SPX")`
- **King:** `kingFromStrikeTotals(hm.gex.strike_totals)` — **near-term aggregate**, not single expiry
- **Flip:** zero-gamma crossing from positioning block
- **Net GEX:** summed near-term strike totals

### 5.3 Matrix 0DTE column scope

**Strict 0DTE:** `resolveZeroDteExpiry(expiries, todayEt)` — today's ET date only; no silent front-expiry fallback.

**Fallback column:** `resolveOdteExpiry` — nearest front if today missing (off-hours / holiday).

**Per-column king/walls:** `columnTotalsForAxis` + `recomputeScopedGexLevels` for **each displayed expiry** — column king ≠ header king by design.

**0DTE overlay on ladder:** `odteStrikeTotalsFromCells` for strict column slice; disclaimer when not true 0DTE.

### 5.4 Vector horizon (embed)

- **Default:** `0dte` — narrowed chain; empty chain → honest gap (no blended mislabel)
- **Walls on chart:** volume-adjusted positioning (OI + today's per-strike volume) for mid-day births
- **Recorder:** 15s buckets, `DOMINANT_WALLS_PER_BUCKET = 3`, dominance-filtered trails
- **Cold API path:** reads last Redis rail sample before chain aggregate (fix 75296eb)

**Cross-check expectation (checklist 2026-07-14):** flip/regime within ±0.1% between desk header and Vector **when scopes align** — breaks when header = 15-exp aggregate and Vector = 0DTE-only.

### 5.5 Gamma regime coherence (header internal)

**Fixed (single snapshot):** `above_gamma_flip` and `gamma_regime` both derive from the same `(price, gammaFlip)` pair via `gammaRegimeWithHysteresis` — see `spx-desk.ts:1356–1373`.

**Explicit non-goal:** aggregate net-GEX sign does **not** override local spot-vs-flip regime (adversarial review documented in FINDINGS).

**Hairline / near-flip zones:** `isHairlineNetGammaSign`, `isNearGammaFlip` in `gex-odte-scope.ts` downgrade cross-provider sign checks.

### 5.6 Largo bias (`deriveSpxBias`)

Four votes (when available):

1. γ-flip (above = +1)
2. VWAP (above = +1)
3. EMA stack (bullish/bearish/flat)
4. Trend regime from desk (`bullish`/`bearish`/neutral)

Conviction: STRONG (≥3 signals, all aligned), SOLID (≥3, one dissent), LEAN, MIXED.

**Dual bias finding:** Header `regime` pill uses `inferRegime(price, ema20, ema50)` independently — can read “bullish” while Largo card is “BEARISH · 2/4 aligned” when γ-flip and VWAP disagree with EMA stack.

### 5.7 Play engine scoring (summary)

Full detail: `docs/bie/spx-slayer-mechanics.md`.

- **Confluence:** weighted sum clamped [-100, 100]; BUY at |score| ≥ 22; grades A+…D
- **Gates:** market open, halts, GEX present, desk freshness, mixed tape, grade floor, …
- **Mutations:** only when `mutate: true` (cron / admin confirm)

### 5.8 0DTE G-6 cross-system conflict

**Gate:** `cross_system_conflict` in `src/lib/zerodte/gates.ts` — HARD since 2026-07-16.

Blocks 0DTE Command commits when direction opposes live Slayer open play or fresh Night Hawk take with score < 80. SPX-correlated tickers (SPY, QQQ, …) participate; single-name shorts may not.

Integrates **into** Slayer as the book of record for “live SPX play direction.”

---

## 6. Poll cadence and cache

### 6.1 Client defaults (`spx-desk-poll-ms.ts`)

| Env override | Default | Purpose |
|--------------|---------|---------|
| `NEXT_PUBLIC_SPX_PLAY_POLL_MS` | 2000 | Play + shadow API |
| `NEXT_PUBLIC_SPX_FLOW_POLL_MS` | 2000 | Flow lane |
| `NEXT_PUBLIC_SPX_FULL_DESK_POLL_MS` | 5000 | Full desk rebuild |
| `NEXT_PUBLIC_SPX_PULSE_REST_POLL_MS` | 1000 | Pulse REST |
| `NEXT_PUBLIC_SPX_PULSE_REST_SSE_POLL_MS` | 5000 | Pulse when SSE up |
| `NEXT_PUBLIC_SPX_MATRIX_POLL_RTH_MS` | 5000 | Matrix |
| `NEXT_PUBLIC_SPX_MATRIX_POLL_OFF_MS` | 5000 | Matrix off-hours |

**Doc drift:** `AGENTS.md` still mentions matrix **8s RTH / 20s off-hours** and `SPX_GEX_HEATMAP_CACHE_SEC` default **8** — code defaults are **5s** for both client poll and server cache.

### 6.2 Server caches

| Asset | TTL default | Key / notes |
|-------|-------------|-------------|
| SPX GEX heatmap | 5s (`SPX_GEX_HEATMAP_CACHE_SEC`) | Redis + in-memory; SWR revalidate |
| Stale-while-revalidate | 90s (`GEX_HEATMAP_MAX_STALE_SEC`) | Background rebuild on miss |
| SPX Polygon 0DTE bundle | 15s (`SPX_POLYGON_GEX_CACHE_SEC`) | `fetchPolygonOdteDeskBundle` |
| Member play read | 2s (`SPX_PLAY_MEMBER_READ_CACHE_SEC`) | `spx-play-read:{date}` — no SWR |
| Desk lanes | cron + leader | `desk-warm` ~5 min; in-app leader ~90s |
| Vector walls | 15–30s | `vector-walls-warm` cron |
| Heatmap warm + SSE delta | 30–45s | `heatmap-warm` cron |

### 6.3 Crons (SPX-relevant)

| Cron | Schedule | Effect on Slayer |
|------|----------|------------------|
| `spx-evaluate` | ~5 min, 7AM–4PM ET | **Mutating** play evaluation + lotto/power hour |
| `desk-warm` | ~5 min RTH | Pre-warm desk/flow/pulse/matrix |
| `heatmap-warm` | 30–45s RTH | Matrix cache + delta SSE |
| `vector-walls-warm` | 15–30s RTH | Embed chart walls |
| `platform-warm` | 5 min 24/7 | Bootstrap bundle |
| `spx-signal-observe` | scheduled | Confluence snapshots |
| `spx-issues-sync` | scheduled | Admin incidents (was human-only) |
| `uw-cache-refresh` | 2 min | UW REST cache when WS stale |

---

## 7. Cross-surface scope map

| Surface | Expiry scope | Wall math | Spot source | King / flip |
|---------|--------------|-----------|-------------|-------------|
| Header pills | Near-term aggregate (15 exp) | Polygon HM + optional UW WS ladder | Pulse SSE → WS index | Aggregate king / HM flip |
| Matrix table/ladder | Column = strict 0DTE or front; UI shows 6 cols | Same HM cells, per-column recompute | Desk live spot overlay | Per-column king |
| Vector embed | User DTE toggle (default **0dte**) | Volume-adjusted; dominance trails | Chart stream 1Hz | Horizon-scoped walls |
| `/api/market/gex-positioning` | Canonical reader | Same as header | Cached | Same as header |
| BIE / Largo tools | Tool-dependent | Via desk snapshot | Desk | Desk fields |
| Play engine gates | Desk snapshot | Requires walls present | Desk price | Desk flip/walls |

**Coherence rule for audits:** compare like scopes — 0DTE column ↔ Vector `0dte` ↔ strict `resolveZeroDteExpiry`; header ↔ `near_term_expiries` aggregate.

---

## 8. Integrations INTO SPX Slayer

### 8.1 Largo / BIE

- **Commentary rail:** client-side `spx-live-voice.ts` composers
- **API route:** `/api/market/spx/commentary` (server cards — rail prefers client brain)
- **Largo Q&A:** `composeSpxDeskRead` threads `playbookShadow` summary when panel builds
- **SPX full state tool:** includes play payload + shadow summary
- **Kill-switch:** BIE-first for SPX commentary (Claude spend path reduced on staging)

### 8.2 Vector

- **Seed:** `loadVectorSeedProps("SPX")` — same helper as `/vector`
- **Embed:** chart-only; shared price axis map → matrix ladder alignment
- **Pulse/terminal playbook lines:** only in full Vector shell — **not** on SPX desk embed
- **Cron:** `vector-walls-warm` feeds embed wall freshness

### 8.3 Play engine + playbook shadow

- **Evaluate:** `evaluateSpxPlay(desk, technicals, { mutate })`
- **Cron writer:** `runSpxEvaluator` → `mutate: true`, advisory lock, Discord, DB open/close
- **Member reader:** `getSpxPlayState` → `readSpxPlaySnapshot` + `buildPlaybookShadowPanel`
- **Shadow telemetry:** `maybeLogPlaybookShadowMatch` → Postgres (throttled by `playbookShadowStateKey`)
- **UI:** **`SpxTradeAlerts` not mounted** — shadow invisible except API/Largo/Vector full page

### 8.4 Unusual Whales WebSocket

- Lazy boot: `init-data-sockets.ts` on first market API hit
- Channels: `gex_strike_expiry`, `option_trades:SPX,SPY`, `net_flow`, halts, …
- Staging budget: `UW_MAX_RPS=1`, narrowed ticker env overrides
- Desk prefers WS ladder for wall **strikes** when fresh

### 8.5 0DTE Command (G-6)

- Reads live Slayer play direction from platform context
- **G-6** blocks conflicting 0DTE entries on correlated tickers
- Documented replay: 2026-07-13 session economics in `gates-replay-2026-07-13.test.ts`

### 8.6 Crons

- **`spx-evaluate`:** only path that should mutate open play rows on schedule
- **`desk-warm` / `heatmap-warm`:** keep member polls cache-hot
- Staging: EventBridge/cron equivalents via ECS (not Railway TOMLs)

### 8.7 Clerk / Whop

- Premium tier required for `/dashboard`
- Admin `role` bypasses tool launch gates
- Staging satellite auth: sign-in may redirect to primary domain

---

## 9. Findings register (P1–P3)

### P1 — Playbook shadow invisible on flagship desk

| Field | Detail |
|-------|--------|
| **Symptom** | Members cannot see PB-01…PB-14 monitor on `/dashboard` despite live `playbook_shadow` on API |
| **Root cause** | Desk v3 removed `SpxTradeAlerts` render (`SpxDashboard.tsx:33–38`); Vector embed is `chart-only` with no terminal (`VectorPageShell.tsx:301–302`) |
| **Evidence** | `docs/spx/SPX-PLAYBOOK-LIVE-VALIDATION-CHECKLIST.md` checklist items; `validate-staging-playbook.mjs` probes API only |
| **Files** | `SpxDashboard.tsx`, `SpxTradeAlerts.tsx`, `VectorPageShell.tsx`, `spx-service.ts:101–136` |
| **Fix options** | (a) Re-mount compact playbook strip, (b) surface primary PB in Largo rail, (c) Vector embed mini-monitor |
| **Status** | OPEN — architecture decision pending |

### P1 — Vector embed launch-gated

| Field | Detail |
|-------|--------|
| **Symptom** | “Vector chart launching soon” for premium members without `vector` in `LAUNCHED_TOOLS` |
| **Root cause** | `tool-access.ts`: `vector` has `defaultLaunched: false`; dashboard checks `canAccessTool("vector")` before seed |
| **Files** | `src/app/(site)/dashboard/page.tsx:26–28`, `src/lib/tool-access.ts:34–35` |
| **Staging note** | Flagship desk depends on Vector — consider auto-launch for SPX dashboard or decouple embed from Vector tool gate |
| **Status** | OPEN |

### P1 — Cron vs member-read evaluation split

| Field | Detail |
|-------|--------|
| **Symptom** | Open play / OR-break memory can differ between cron tick and rapid member polls |
| **Root cause** | Cron: `runSpxEvaluator` → `mutate: true`; API: `readSpxPlaySnapshot` → `mutate: false`; 2s `playMemberReadCacheSec` collapses polls but not cron boundary |
| **Mitigation exists** | Shared `or_break_memory` + `playbook_resolved` passed into read path when built in `evaluateSpxPlayState` |
| **Files** | `spx-evaluator.ts`, `spx-service.ts:81–147`, `spx-play-engine.ts:1549+` |
| **Risk** | Lotto/power hour state advance **only** on cron (`spx-lotto-engine.ts`, `spx-power-hour-engine.ts` comments) |
| **Status** | OPEN — document contract; consider read path consuming last cron snapshot for phase fields |

### P2 — Cross-surface gamma / king scope mismatch (confused coherence)

| Field | Detail |
|-------|--------|
| **Symptom** | Header king ≠ matrix column king ≠ Vector 0DTE king; flip delta vs Vector weekly |
| **Root cause** | Legitimate scope differences (§5.2–5.4); insufficient UI labeling |
| **Files** | `SpxGexMatrixHeatmap.tsx:208–215`, `spx-desk.ts:345–398`, `vector-snapshot.ts` |
| **Status** | OPEN UX — not a data bug if scopes documented |

### P2 — Dual bias (Largo vs header vs Vector regime)

| Field | Detail |
|-------|--------|
| **Symptom** | Largo “BEARISH · 3/4” while header Regime pill shows “bullish” |
| **Root cause** | Independent models: `deriveSpxBias` (4 votes) vs `inferRegime` (EMA20/50) vs Vector `deriveVectorRegime` |
| **Files** | `spx-live-voice.ts:244–285`, `spx-desk.ts:1383`, Vector regime banner |
| **Status** | OPEN — unify labels or cross-link in UI |

### P2 — Largo LIVE COMMENTARY blank / sparse

| Field | Detail |
|-------|--------|
| **Symptom** | Left rail empty or offline copy on cold load |
| **Root cause** | Requires `live && desk?.available && largoEnabled()`; pre-market partial votes → MIXED with thin copy; FINDINGS.md pre-existing |
| **Files** | `SpxCommentaryRail.tsx:186–188`, `spx-commentary-offline-copy.ts` |
| **Status** | OPEN — regression tracked in `docs/checklist/spx-slayer-july14.md` |

### P2 — Staging VWAP unlock vs prod (playbook PB-01/PB-02)

| Field | Detail |
|-------|--------|
| **Symptom** | PB-01/PB-02 arm on staging; blocked on prod with ISSUE-16 message |
| **Root cause** | `sessionStatsWithProxyVwap` merges SPY volume on staging only (`spx-desk.ts:114–125`) |
| **Files** | `playbook-data-requirements.ts`, `playbook-shadow-matcher.ts`, `spx-play-gates.ts` |
| **Status** | BY DESIGN — env divergence; prod needs alternate volume source for parity |

### P2 — `/api/account/personal-alerts` 502

| Field | Detail |
|-------|--------|
| **Note** | Origin-side; SPX desk doesn't depend on it — listed from FINDINGS.md open items |
| **Status** | OPEN (platform) |

### P3 — AGENTS.md matrix poll/cache drift

| Field | Detail |
|-------|--------|
| **Symptom** | Operators expect 8s/20s matrix polling |
| **Code** | 5s client + 5s `SPX_GEX_HEATMAP_CACHE_SEC` |
| **Status** | OPEN docs |

### P3 — 0DTE desk bundle cache stampede

| Field | Detail |
|-------|--------|
| **Fix** | `odteBundleInflight` single-flight (`FINDINGS.md` 2026-07-15) |
| **Status** | FIXED in sandbox |

### P3 — Dashboard hydration blank (#418)

| Field | Detail |
|-------|--------|
| **Note** | Escalated in FINDINGS — cold load can blank desk |
| **Status** | OPEN — monitor |

---

## 10. Solid areas (verified healthy)

1. **Single canonical GEX path** for desk header — no duplicate Polygon pulls per request when cache warm.
2. **Gamma flip / above-flip coherence** within header payload (2026 fix, `spx-desk.ts:1356+`).
3. **UW WS ladder preference** for wall strikes aligns desk with Vector when WS fresh.
4. **Bootstrap bundle** reduces cold-load XHR fan-out.
5. **Last-good GEX honesty** — `gex_stale`, age ms, stalled feed dimming.
6. **Shared price axis** — matrix ladder tracks Vector chart Y mapping.
7. **Playbook shadow API** — 14 verdicts, pipeline audit, staging validator script.
8. **Unit test depth** — 420+ tests under `src/features/spx/**/*.test.ts` (per playbook audit docs).
9. **BIE SPX voice** — transition cooldown prevents spam; sessionStorage survives refresh.
10. **Cron registry** — `spx-evaluate`, `desk-warm`, `heatmap-warm` documented in `cron-registry.ts`.
11. **Tier + cron auth** on `/api/market/spx/play` — no anonymous play state leak.
12. **Vector wall engine fixes** — dominance filter, volume-adjusted births, narrowed horizon honesty (commits through 2026-07-14).

---

## 11. Test gaps

| Gap | Risk | Suggested coverage |
|-----|------|-------------------|
| Desk v3 E2E without Trade Alerts | Playbook invisible regressions | Extend `validate:spx-e2e` to assert UI OR explicit “API-only shadow” |
| Vector gated empty state | Flagship desk broken for default launch flags | Staging env + launch-status integration test |
| Cross-surface 0DTE flip parity | False alarms in RTH audit | `validate:spx-bie` + scoped API probes (0dte vs near_term) |
| Cron vs read open-play parity | Silent divergence | Contract test: cron snapshot === cached read within window |
| Largo rail blank on cold load | Member trust | Playwright: commentary populates ≤20s (checklist item) |
| iOS segmented desk | Matrix/Vector swap | `validate:ios-mobile-desk` + tab clicks |
| Gamma coherence regression | Header flip vs regime | Unit test already in desk; add E2E spot-crossing fixture |
| Off-hours playbook_shadow absent | False staging failures | Session-guard aware validator (`validate-staging-playbook.mjs`) |

**Existing commands (see §13):** `npm run validate:spx-rth`, `validate:spx-e2e`, `validate:staging-playbook`, `validate:spx-bie`.

---

## 12. main vs blackout-web-sandbox divergence

Repos are **forked products** — no merge-base between sandbox `f72502f7` and prod `152afe6f` in this environment.

| Dimension | `blackout-web-sandbox` (staging) | `blackout-web` (Railway prod) |
|-----------|----------------------------------|-------------------------------|
| **Deploy target** | ECS / ECR `:staging` | Railway multi-region |
| **SPX feature files** | ~225 under `src/features/spx/` | ~114 (sandbox +111 playbook files) |
| **Playbook system** | Full PB-01…14 shadow + FSM + telemetry | Reduced / absent many `playbook-*` modules |
| **Desk layout** | Desk v3 (3-column, Vector embed) | May still differ if not merged |
| **VWAP** | SPY volume proxy → `vwap_volume_weighted: true` | Typical-price VWAP; PB-01/02 blocked |
| **Clerk** | Satellite on `staging.blackouttrades.com` | Primary domain |
| **UW budget** | `UW_MAX_RPS=1`, narrowed WS tickers | Full 2 RPS budget |
| **Crons** | ECS/EventBridge equivalents | Railway `railway.*.toml` services |
| **LAUNCHED_TOOLS** | Staging env overrides | Railway `blackout-web` vars |
| **Postgres** | RDS snapshot + independent live ingest | Railway Postgres + PgBouncer |

**Sandbox-only SPX modules (sample):** `playbook-shadow-matcher.ts`, `playbook-fsm-sync.ts`, `playbook-promotion-eval.ts`, `spx-staging-full-enablement.test.ts`, … — full diff: `comm -23` sandbox vs prod file lists.

**Do not merge sandbox → prod** unless explicitly requested (AGENTS.md policy).

---

## 13. File index

### UI

| Path | Role |
|------|------|
| `src/app/(site)/dashboard/page.tsx` | Server page, Vector seed, tier gate |
| `src/features/spx/components/SpxDashboard.tsx` | Desk v3 layout orchestrator |
| `src/features/spx/components/SpxSniperHeader.tsx` | Header metrics ribbon |
| `src/features/spx/components/SpxGexMatrixHeatmap.tsx` | Matrix / ladder rail |
| `src/features/spx/components/SpxCommentaryRail.tsx` | Largo live commentary |
| `src/features/spx/components/SpxStrikeLadderAxis.tsx` | Shared-axis ladder |
| `src/features/spx/components/SpxTradeAlerts.tsx` | **Unmounted** — playbook UI |
| `src/features/vector/components/VectorPageShell.tsx` | Embed seam |
| `src/features/vector/components/VectorChart.tsx` | Chart proper |

### Hooks / client libs

| Path | Role |
|------|------|
| `src/features/spx/hooks/useMergedDesk.ts` | Desk lane merger |
| `src/features/spx/hooks/useSpxPlay.ts` | Play SWR |
| `src/features/spx/lib/spx-desk-poll-ms.ts` | Poll constants |
| `src/features/spx/lib/spx-desk-focus.ts` | Focus mode hotkeys |
| `src/features/spx/lib/spx-desk-session-client.ts` | ET session clock |

### Server / engine

| Path | Role |
|------|------|
| `src/features/spx/lib/spx-desk.ts` | `buildSpxDesk`, canonical GEX |
| `src/features/spx/lib/spx-desk-loader.ts` | Cached desk load |
| `src/features/spx/lib/spx-play-engine.ts` | Play evaluation |
| `src/features/spx/lib/spx-evaluator.ts` | Cron mutator |
| `src/features/spx/lib/spx-service.ts` | Play API aggregation |
| `src/features/spx/lib/spx-signals.ts` | Confluence scoring |
| `src/features/spx/lib/spx-play-gates.ts` | Sequential gates |
| `src/features/spx/lib/playbook-shadow-panel.ts` | Shadow panel builder |
| `src/features/spx/lib/playbook-shadow-matcher.ts` | PB preconditions |
| `src/lib/providers/polygon-options-gex.ts` | Heatmap build, 15-exp |
| `src/lib/correctness/gex-odte-scope.ts` | 0DTE scoping helpers |
| `src/lib/bie/spx-live-voice.ts` | Largo bias + events |
| `src/lib/zerodte/gates.ts` | G-6 cross-system gate |

### API routes

| Path | Role |
|------|------|
| `src/app/api/market/spx/bootstrap/route.ts` | Cold-load bundle |
| `src/app/api/market/spx/desk/route.ts` | Full desk |
| `src/app/api/market/spx/play/route.ts` | Play + shadow |
| `src/app/api/market/gex-heatmap/route.ts` | Matrix data |
| `src/app/api/cron/spx-evaluate/route.ts` | Mutating evaluator |

### Docs / ops

| Path | Role |
|------|------|
| `docs/bie/spx-slayer-mechanics.md` | Play engine mechanics |
| `docs/spx/PLAYBOOK-ARCHITECTURE-STATUS.md` | Playbook system status |
| `docs/checklist/spx-slayer-july14.md` | RTH validation checklist |
| `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` | All-day agent runbook |
| `docs/audit/FINDINGS.md` | Living issue log |

---

## 14. Validation commands

### SPX-focused

```bash
# Unit tests (no DB)
npm test

# Typecheck + brand lint (CI blocking)
npx tsc --noEmit
npm run lint:brand

# SPX RTH all-day audit (sockets, matrix, buttons)
npm run validate:spx-rth

# SPX dashboard E2E (Playwright-style harness)
npm run validate:spx-e2e

# BIE/desk number consistency
npm run validate:spx-bie

# Bootstrap cold profile
npm run validate:spx-bootstrap-profile
```

### Staging (ECS)

```bash
# Full staging harness
npm run validate:staging

# RTH: sockets, flow, spx/play
npm run validate:staging-rth

# Playbook shadow API (auth via script)
npm run validate:staging-playbook

# Desk + playbook live shapes
npm run validate:staging-desk-live

# Staging vs prod latency
npm run validate:latency-compare

# Ops action items (staging)
npm run ops:collect:staging
```

### Manual probes (premium session or CRON_SECRET)

```bash
# Desk snapshot
curl -s "https://staging.blackouttrades.com/api/market/spx/desk" | jq '.gamma_flip, .gex_king, .gex_stale, .vwap_volume_weighted'

# Play + playbook shadow
curl -s "https://staging.blackouttrades.com/api/market/spx/play" | jq '.action, .playbook_shadow.mode, .playbook_shadow.primary_playbook_id'

# Matrix
curl -s "https://staging.blackouttrades.com/api/market/gex-heatmap?ticker=SPX" | jq '.expiries | length, .near_term_expiries'

# Launch gates
curl -s "https://staging.blackouttrades.com/api/admin/launch-status" -H "Cookie: …" | jq '.vector'
```

### RTH autonomous (weekday ≥ 09:00 ET)

```bash
npm run validate:rth-open   # includes deploy + session checks
```

---

## 15. Recommended fix order

1. **Product decision:** Surface playbook shadow on desk (compact panel vs Largo vs re-enable trade alerts strip).
2. **Launch gate:** Ensure flagship `/dashboard` Vector embed works for intended audience (`LAUNCHED_TOOLS=vector` on staging or SPX-specific embed exception).
3. **Cron/read contract:** Document and test open-play phase ownership; optional read-through of last cron payload for lotto/power hour.
4. **Scope labeling:** Matrix disclaimer + header tooltip clarifying aggregate vs 0DTE column vs Vector horizon.
5. **Bias UX:** Link Largo card to header regime or show both with explicit “structural” vs “trend” labels.
6. **Docs sync:** Update `AGENTS.md` poll/cache defaults to match `spx-desk-poll-ms.ts` and `polygon-options-gex.ts`.
7. **RTH proof:** Monday checklist — `validate:staging-playbook` during `market_open: true`; F4 items in `docs/ops/STAGING-F4-MONDAY.md`.

---

## 16. Related audit artifacts

- `docs/audit/FINDINGS.md` — Vector bead-rail, wall engine, Night Hawk gates (cross-reference)
- `docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md` — 0DTE product boundary
- `docs/spx/PLAYBOOK-BUG-AUDIT-2026-07-11.md` — playbook deep audit
- `docs/spx/PLAYBOOK-SYSTEM-DEEP-SWEEP-2026-07-11.md` — telemetry + cleanup
- `audit-tracker.html` — historical P0/P1 tracker (includes auth SSE note — verify separately)

---

*End of audit. Documentation only — no code changes in this commit.*
