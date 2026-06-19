# Audit — Batch 04: Night Hawk

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Scope:** 48 files (AUDIT-PLAN Batch 04) — edition builder, scoring, outcomes, agents, dossier pipeline, Night Hawk pages/components/embeds, worker  
> **Completed:** 2026-06-19 · Steps 2 + 3

## Coverage

All 48 batch files read in full, including `src/lib/nighthawk/agents/**`:

| Area | Files | Lines (approx) |
|------|-------|----------------|
| Worker + pages/components | 15 | ~1,650 |
| `lib/nighthawk/**` (core + agents) | 32 | ~4,900 |
| `lib/platform/nighthawk-service.ts` | 1 | 44 |

API route consumers (`/api/market/nighthawk/*`, cron) audited for integration only (Batch 03 owns HTTP contracts).

---

## Focus verification (requested)

### ✅ Chain dedup — `fetchEditionChains`

**Status: FIXED (was Bug A in `complete-repo-bugs/AUDIT-NightHawk.md`)**

- `claude-edition.ts:103-106` — single `fetchEditionChains()` call; text tables via `formatEditionChainTables()`, strike rows from the same payload.
- `option-chain-prompt.ts:338-352` — `fetchEditionChains` dedups tickers with `Set`, one `resolveTickerChainRows` per symbol.
- `fetchEditionChainTables` / `fetchEditionChainRows` remain as deprecated wrappers but are **not** called from the edition path.

### ✅ January rollover — `parseOptionsContract`

**Status: FIXED (was Bug B)**

- `option-chain-prompt.ts:284-290` — month-label parsing uses current year, then rolls to `year + 1` when parsed date is >5 days in the past.
- Late-December `"Jan 15"` labels now resolve to next calendar year before `validatePlayAgainstChain`.

### ✅ Day Trade Agent

**Status: WIRED end-to-end**

| Layer | Implementation |
|-------|----------------|
| Agent lib | `agents/day-trade-agent.ts` — wraps `runHuntScan`, applies `filterPlaysByMaxDte` (0DTE) + `filterSignalsBySpxAlignment` |
| Filters | `agents/day-trade-filters.ts` — SPX macro bias, DTE parse, alignment helpers |
| Types | `agents/day-trade-types.ts` — `DayTradeSignal`, phases, run envelope |
| API | `api/market/nighthawk/hunt/route.ts:39-48` — day mode routes to `runDayTradeAgent` (not raw `runHuntScan`) |
| UI | `DayTradeAgentWorkspace.tsx` + `DayTradeSignalCard.tsx` — full command surface, arming phases, signal detail |

---

## Step 2 — Full read audit

### Pipeline core (edition + hunt)

| File | Role | Verdict |
|------|------|---------|
| `edition-builder.ts` | Staged evening build, critic, publish, outcomes sync | ✅ Solid checkpointing; critic zero-play → top-2 unvetted fallback intentional |
| `hunt-builder.ts` | Sync hunt scan for swing/leap (+ day via agent wrapper) | 🟠 See M1 |
| `claude-edition.ts` | Claude synthesis + chain validation + premium cap | ✅ Single chain fetch; strike + premium gates |
| `candidates.ts` | Premium-relative candidate selection | ✅ Unusualness + streak multipliers; watchlist fallback |
| `dossier.ts` | Per-ticker dossier assembly | ✅ Timeout fallbacks; congress/predictions edition cache |
| `market-wide.ts` | Session context | ✅ Flow limit 450; SPX/VIX 45-day lookback via `priorEtYmd(45)` |
| `scorer.ts` | Weighted scoring | ✅ Skew flip → `skewAdj=0`; fundamental block; regime multiplier |
| `play-critic.ts` | Pre-publish Claude review | ✅ Cuts without mechanical backfill |
| `play-outcomes.ts` | Next-day resolution | ✅ Target uses session high/low symmetrically with stop |
| `play-constraints.ts` | $20/share premium cap | ✅ Null premium rejected |
| `option-chain-prompt.ts` | Chain fetch + strike validation | ✅ Jan rollover + deduped prefetch |
| `session.ts` | ET dates + holidays | ✅ `US_MARKET_HOLIDAYS` through 2027 |
| `technicals.ts` | MTF card | ✅ `rel_volume` wired; `swingLevels` on 60 daily bars / 45 lookback |
| `analytics.ts` | Outcome metrics | ✅ Profitable rate vs target/stop tags |
| `format.ts` | Prompt + dossier text | ✅ Premium cap in Claude system prompt |
| `play-explainer.ts` | Hawk Intel briefings | ✅ Fallback when Claude unavailable |
| `publish-preview.ts` | Admin preview | ✅ Surfaces unvetted fallback via critic notes |
| `positioning.ts` | GEX / max pain | ✅ Polygon primary, UW fallback |
| `flow-streak.ts` | Multi-day flow streak | ✅ Bucket math consistent |
| `spx-gap.ts` | Gap pattern context | ✅ gap_and_go / trap / fill |
| `index-dossier.ts` | ETF recap block | ✅ $100K flow threshold |
| `vol-metrics.ts` | Realized vol + skew parse | ✅ |
| `constants.ts` | Limits + caps | ✅ |
| `data-sources.ts` | Endpoint registry | ✅ (doc only) |
| `fetch-timeout.ts` | Dossier race timeouts | ✅ |
| `types.ts` | Shared types | ✅ |
| `agent-config.ts` | Hunt mode UI filter defs | 🟠 See M1 (swing/leap fields not consumed server-side) |
| `hunt-mode.ts` | Filter normalization | 🟠 See M1 |
| `platform/nighthawk-service.ts` | Edition read helpers | ✅ |

### UI + worker

| File | Verdict |
|------|---------|
| `scripts/nighthawk-worker.ts` | ✅ Thin wrapper → `buildEveningEdition` + cron log |
| `app/nighthawk/page.tsx` | ✅ Premium tier gate |
| `NightHawkFeed.tsx` | ✅ Edition SWR + agent routing (day → workspace) |
| `PlaybookBoard.tsx` / `PlaybookPlayRow.tsx` | ✅ 5-slot board, premium cap display |
| `PlayDetailModal.tsx` | ✅ Lazy Hawk Intel via SWR |
| `AgentSidebar.tsx` / `AgentFilterFields.tsx` / `AgentPowerModal.tsx` | ✅ Swing/leap modal hunt |
| `DayTradeAgentWorkspace.tsx` / `DayTradeSignalCard.tsx` | ✅ Full day agent UX |
| `NightHawkRadarBackdrop.tsx` | ✅ Decorative (labeled via aria-hidden) |
| `desk/NightHawkRadar.tsx` | ✅ Live plays from desk API type |
| `embeds/NightHawkEmbeds.tsx` / `embeds/NightHawkRadar.tsx` | 🟡 L1 decorative scanner |

### Prior fixes confirmed in this pass

| Item | Location | Status |
|------|----------|--------|
| Skew double-count | `scorer.ts:421-423` | ✅ `skewAdj=0` when direction flipped by skew |
| Tech-null edition drop | `edition-builder.ts:202` | ✅ `d.scored != null` |
| Outcome intraday bias | `play-outcomes.ts:100-111` | ✅ high/low for target |
| Flow pagination | `constants.ts:38` | ✅ `MARKET_FLOW_ALERT_LIMIT=450` |
| Strike validation | `option-chain-prompt.ts:298-314` | ✅ |
| Null premium reject | `play-constraints.ts:93-94` | ✅ |
| Holiday calendar | `session.ts:6-27` | ✅ |

---

## Findings — Step 2

### 🟠 M1 — Swing / Leap agent filters shown in UI but not applied server-side

**Files:** `agent-config.ts` (swing: `dte_min`, `dte_max`, `max_entry_premium`; leap: `min_dte`, `require_catalyst`), `hunt-mode.ts` (`normalizeHuntFilters`)

**Bug:** `normalizeHuntFilters` only parses day-mode fields (`max_dte`, `spx_context`) plus generic direction/score/streak/IV/premium. Swing DTE window, max entry premium, leap min DTE, and catalyst toggle are **never read** — UI changes have no effect on `runHuntScan`.

**Impact:** Swing Hawk and Leap Hawk agents advertise filters that do not change scan behavior (only shared direction/min_score/min_streak/max_iv/min_premium apply when set).

**Fix:** Extend `NormalizedHuntFilters` + `dossierPassesPrefilters` / `applyHuntScoreFilters` (or post-Claude premium/DTE checks) for swing/leap-specific fields; pass DTE guidance into `generateEditionPlays` for leap min DTE.

---

### 🟠 M2 — Hunt scan drops dossiers without Polygon technicals; edition scan does not

**Files:** `hunt-builder.ts:131` vs `edition-builder.ts:201-203`

**Bug:** Hunt requires `d.tech != null` before rescoring. Edition ranks any dossier with `scored != null` (tech-null still scores — flow-only candidates can rank).

**Impact:** A ticker with strong UW flow but missing Polygon MTF appears in the evening playbook pipeline but is **silently excluded** from all hunt agents (including Day Hawk via `runHuntScan`).

**Fix:** Align gates — either require `tech != null` in edition ranking or allow `scored != null` in hunt (prefer latter + surface “technicals unavailable” in UI).

---

### 🟡 LM1 — SPX alignment treats ambiguous directions as aligned

**File:** `agents/day-trade-filters.ts:44-47`

**Bug:** For bull bias, `isLongDirection(direction) || !isShortDirection(direction)` passes neutral/mixed strings (e.g. `"CALL spread"`, `"—"`). Bear path symmetric.

**Impact:** With “Require SPX alignment” on, misaligned or vague Claude directions may survive the filter when bias is non-neutral.

**Fix:** Require explicit long/short match when bias ≠ neutral; only pass neutrals when bias is neutral.

---

### 🟡 L1 — Embed radar is cosmetic, not live Night Hawk data

**File:** `embeds/NightHawkRadar.tsx`

Random ticker blips on a timer — no API connection. Acceptable for marketing embeds but could mislead if presented as live scan output. Label or wire to hunt/edition API if used on authenticated surfaces.

---

### 🟡 L2 — Day-trade 0–1 DTE filter only post-validates at 0DTE

**File:** `agents/day-trade-agent.ts:35-37`

When `max_dte === 1`, no `filterPlaysByMaxDte` pass — relies on Claude `maxDte` prompt only. 2+ DTE contracts can slip through if Claude ignores guidance.

**Fix:** Run `filterPlaysByMaxDte(playbookPlays, maxDte)` for both `0` and `1`.

---

### 🟡 L3 — DTE check uses server-local midnight, not ET

**File:** `agents/day-trade-filters.ts:81-82`

`optionsPlayWithinMaxDte` zeroes `today` in local TZ. Near UTC/ET midnight boundary, DTE can be off by one for 0DTE filtering.

**Fix:** Use ET session date (`todayEt()` / `formatEtDate`).

---

### 🟡 L4 — Day signal phases never advance past `CANDIDATE`

**Files:** `day-trade-agent.ts:14`, `day-trade-types.ts:5`

`WATCH` / `ACTIONABLE` / `EXPIRED` defined but always set to `CANDIDATE`. UI shows phase badge — lifecycle not implemented (cosmetic until intraday refresh exists).

---

### 🟡 L5 — Duplicate React keys in agent result list

**File:** `AgentPowerModal.tsx:138` — `key={play.ticker}` collides if two plays share a ticker (unlikely but possible after rescans).

---

## Step 3 — Edge-case second pass

| Scenario | Result |
|----------|--------|
| Dec 28 `"Jan 17 CALL"` in `options_play` | ✅ Year rolls forward; validation sees future expiry |
| Same ticker twice in `chainTickers` | ✅ `fetchEditionChains` Set dedup — one fetch |
| Claude emits 8 plays, 3 over premium cap | ✅ `filterPlaysWithinPremiumCap` rejects; logs warn |
| Claude strike not on chain | ✅ `validatePlayAgainstChain` rejects before publish |
| Critic cuts all 5 plays | ✅ Edition publishes top-2 unvetted fallback (`edition-builder.ts:273-281`) |
| Hunt critic path | ✅ No backfill in `play-critic.ts` (hunt skips critic entirely) |
| Empty flow day | ✅ `extractCandidateTickers` → empty → failed job with clear error |
| Watchlist only, zero flow | ✅ `candidates.ts:100-106` injects watchlist tickers at base score |
| `requireSpx` + SPX desk fetch fails | ✅ `getSpxDeskSummary().catch(() => null)` — alignment skipped, signals unfiltered |
| Trading halt active | ✅ `scoreCandidate` → score 0 + `fundamental_block` → excluded from rank |
| Outcome both target and stop touched | ✅ `resolveOutcome` → `ambiguous` with open-order tie-break |
| `parseOptionsContract` missing expiry | ⚠️ Strike match ignores expiry (`row.expiry !== parsed.expiryYmd` skipped) — may validate wrong expiry OI |
| Leap `require_catalyst` toggle ON | ❌ No-op (M1) |
| Swing `dte_max=5` with Claude 10 DTE contract | ❌ No server DTE enforcement (M1) |
| Force rebuild mid-staging | ✅ Clears staging, resets job; resumes from context if checkpoint exists |
| Premium tier on page, hunt API | ✅ Both gated premium (Batch 03) |

### Additional edge note — expiry-less strike validation

**File:** `option-chain-prompt.ts:306-311`

When Claude omits an ISO/month expiry from `options_play`, validation matches **any** front-expiry row at that strike with sufficient OI. Low frequency but allows wrong-expiry contracts to pass. **Fix:** reject parsed contracts with `expiryYmd == null` when strict mode desired.

---

## Cross-check — `complete-repo-bugs/AUDIT-NightHawk.md`

| Prior item | Batch 04 status |
|------------|-----------------|
| Bug A — chain double fetch | ✅ **FIXED** — see focus verification |
| Bug B — Jan rollover | ✅ **FIXED** — see focus verification |
| Skew double-count | ✅ Verified fixed |
| Critic stub backfill | ✅ Intentional edition fallback (documented) |
| Tech-null edition | ✅ Verified fixed |
| Outcome resolver bias | ✅ Verified fixed |
| rel_volume / swingLevels / flow 450 / holidays / premium / strike | ✅ Verified fixed |

---

## Finding counts

| Severity | Step 2 | Step 3 (new) | Total |
|----------|--------|--------------|-------|
| Critical | 0 | 0 | **0** |
| High | 0 | 0 | **0** |
| Medium | 2 | 0 | **2** |
| Low–Med | 1 | 0 | **1** |
| Low | 5 | 1 | **6** |
| **Open actionable** | **8** | **1*** | **9** |

\*Step 3 adds one edge-case item (expiry-less strike validation) not duplicated in Step 2 table — counted under Low in total.

**Verified fixed (prior open):** 2 (Bug A, Bug B)  
**Verified fixed (historical list):** 11  
**Cleared / intentional:** critic fallback, decorative embeds, phase placeholders

---

## Recommended fix order

1. **M1** — Wire swing/leap filters (user-visible contract broken).
2. **M2** — Align hunt vs edition technical gate.
3. **LM1** — Tighten SPX direction matching for Day Hawk.
4. **L2 + L3** — Hard 0–1 DTE post-filter on ET calendar.
5. **L1** — Clarify embed radar as demo, or connect live data.
