# SPX Slayer Deep Audit — Staging Only

**Date:** 2026-07-16  
**Repo:** `coreentryadmin-web/blackout-web-sandbox` (branch `blackout-web-sandbox`)  
**HEAD audited:** `91b606f4` (`fix: uniform update rates — spot 1s, GEX/walls/beads 5s for ALL stocks #393`)  
**Scope:** Staging sandbox only — **not** prod `blackout-web` / Railway `main`  
**Staging URL:** https://staging.blackouttrades.com  

---

## Executive summary

SPX Slayer on staging is a **large, well-tested subsystem** (~210 feature files under `src/features/spx/`, plus `src/lib/zerodte/` playbook engine). The July 14 coherence fix (`5a9962ff`) correctly aligned server-built desk snapshots with hysteresis-based `gamma_regime` / `above_gamma_flip`. **Two client-side merge paths partially undo that fix** on every ~1s pulse tick, which can reintroduce side-of-flip / narration / confluence disagreements for seconds at a time inside the hysteresis band.

**Test posture:** `npm test` on HEAD → **3762 pass / 0 fail** (full suite).  
**Sandbox vs prod fork:** ~**68 commits ahead**, ~**53 behind** `origin/main` (staging-only experiments; do not merge without explicit request).

---

## Architecture map

| Layer | Primary paths | Role |
|-------|---------------|------|
| **UI shell** | `src/features/spx/components/SpxDashboard.tsx`, `SpxGexMatrixHeatmap.tsx`, `SpxTradeAlerts.tsx`, `SpxCommentaryRail.tsx`, `SpxPlayKanban.tsx` | Quad desk layout, 0DTE matrix, trade alerts, BIE commentary rail |
| **Merged desk (client)** | `src/features/spx/hooks/useMergedDesk.ts`, `spx-desk-merge.ts` | Merges base desk (~10s) + flow lane + pulse lane (~1s) |
| **Desk builder (server)** | `src/features/spx/lib/spx-desk.ts`, `src/lib/providers/gamma-desk.ts` | Canonical GEX, hysteresis regime, levels, tape |
| **Signals / plays** | `spx-signals.ts`, `spx-evaluator.ts`, `spx-play-*.ts`, `playbook-*` | Confluence, playbook matching, governor, outcomes |
| **0DTE engine** | `src/lib/zerodte/` (`gates.ts`, `governor.ts`, `cortex-gate.ts`, `scan.ts`, `tiers.ts`) | Gate stack, Cortex veto, tiering, scan loop |
| **BIE / voice** | `src/lib/bie/spx-live-voice.ts`, `spx-desk-synthesis.ts`, `spx-desk-brief.ts` | Commentary, Largo, voice events |
| **API** | `src/app/api/market/spx/*` (bootstrap, pulse, pulse/stream, commentary) | Lanes + SSE |
| **Existing runbooks** | `docs/spx/SPX-PLAYBOOK-LIVE-VALIDATION-CHECKLIST.md`, `docs/checklist/spx-slayer-july14.md`, `docs/bie/spx-slayer-mechanics.md` | RTH validation, mechanics |

### Data lanes (staging)

```
Server buildSpxDesk (~10s GEX refresh, 5s walls/beads on HEAD)
    ↓
mergeFlowIntoDesk (tape / flow briefs)
    ↓
mergePulseIntoDesk (~1s Polygon spot, session stats, halts)  ← client + server loader
    ↓
useMergedDesk → SpxDashboard / signals / commentary / playbook matchers
```

WebSocket market-data managers boot lazily on first `/api/market/*` request (`src/lib/ws/init-data-sockets.ts`). Staging uses narrowed UW budget (`UW_MAX_RPS=1`, reduced WS tickers per AGENTS.md).

---

## Findings

Severity: **P0** = user-visible wrong trade signal · **P1** = coherence / trust · **P2** = edge / ops · **P3** = hygiene / docs

### P1 — Gamma flip / regime coherence (regression vs `5a9962ff`)

Commit `5a9962ff` established the invariant on **server-built** snapshots:

```text
above_gamma_flip === (gamma_regime === "mean_revert")
```

via `isAboveFlipFromRegime()` in `spx-desk.ts` and `gamma-desk.ts`. Pulse merge and BIE voice **re-derive** side-of-flip from raw `price vs gamma_flip`, bypassing hysteresis.

#### P1-a — `mergePulseIntoDesk` overwrites `above_gamma_flip`

**File:** `src/features/spx/lib/spx-desk-merge.ts` (lines ~388–390)

```typescript
// ISSUE-18+20: Recompute above_gamma_flip with current price so price crossings
// of the gamma flip level are reflected after each pulse — base value would be stale.
above_gamma_flip: base.gamma_flip != null ? price > base.gamma_flip : base.above_gamma_flip,
```

**Problem:** Pulse updates price every ~1s but does **not** update `gamma_regime`. Inside the 2pt hysteresis band, this flips `above_gamma_flip` on raw spot while `gamma_regime`, server narration, `/api/market/regime`, and `spx-signals` confluence still use the debounced label → **header chip, matrix context, confluence factor, and BIE can disagree for seconds**.

**Evidence:** Regression tests exist for server path (`spx-signals.test.ts`, `spx-desk-synthesis.test.ts`, `gamma-desk.test.ts`) but **no test** asserts pulse merge preserves regime coherence.

**Recommended fix:**

```typescript
above_gamma_flip: base.above_gamma_flip,
// OR: isAboveFlipFromRegime(base.gamma_regime)
```

If instant crossing UX is required, update **both** `gamma_regime` and `above_gamma_flip` with the same hysteresis helper (`gammaRegimeWithHysteresis`) using pulse price — never raw `price > flip` alone.

**Add:** `spx-desk-merge.test.ts` case — base desk with `gamma_regime: "mean_revert"`, `above_gamma_flip: true`, price 1pt below flip → merged desk must keep `above_gamma_flip: true`.

---

#### P1-b — `voiceSnapshotFromDesk` ignores desk label

**File:** `src/lib/bie/spx-live-voice.ts` (line ~187)

```typescript
aboveFlip: price != null && flip != null ? price >= flip : null,
```

**Problem:** Commentary rail, `spx-commentary.ts`, and Largo voice events call `voiceSnapshotFromDesk(desk)` on the **merged** desk. `aboveFlip` in the voice snapshot can contradict `desk.above_gamma_flip` inside the hysteresis band. Other BIE modules (`spx-desk-synthesis.ts`, `spx-premise.ts`, `spx-desk-brief.ts`) correctly read `desk.above_gamma_flip`.

**Recommended fix:**

```typescript
aboveFlip:
  desk.gamma_flip != null && price != null && price > 0
    ? desk.above_gamma_flip
    : null,
```

**Add:** extend `spx-live-voice.test.ts` — desk with hysteresis-held `above_gamma_flip: true`, price below flip → `snap.aboveFlip === true`.

---

#### P1-c — Admin desk verifier encodes the *old* invariant

**File:** `src/lib/correctness/desk-verifier.ts` (lines ~194–209)

Flags `above_gamma_flip` as inconsistent when `spot >= gamma_flip` disagrees with the label. After hysteresis, **disagreement is expected and correct** inside the buffer band. Verifier will false-flag healthy desks during RTH admin audits.

**Recommended fix:** Change invariant to `above_gamma_flip === (gamma_regime === "mean_revert")` when `gamma_regime` is present; only fall back to raw spot compare when regime is unknown.

---

### P2 — Opening range intel uses HOD/LOD proxy

**File:** `src/features/spx/lib/spx-odte-intel-feed.ts` (lines ~466–492)

When `desk.opening_range` is absent, OR-break events emit from session HOD/LOD crossings labeled `(HOD proxy)` / `(LOD proxy)`. This is documented in copy but can mislead if true OR (first 15–30m) differs from session extremes.

**Recommended fix:** Prefer `desk.opening_range.break` when `opening_range.high/low` exist; only use HOD/LOD proxy when OR is genuinely unavailable. Add test mirroring `spx-odte-intel-feed.test.ts` gamma-cross cases.

---

### P2 — ET session override with stale price

**File:** `src/features/spx/hooks/useMergedDesk.ts` (lines ~219–226)

When `etSessionOpen` is true but pulse+d desk are not “live”, merged desk forces `market_open: true` and `market_label: "RTH OPEN"` if `price > 0`. During a half-open feed freeze, UI can show **RTH OPEN + last stale price** without `feed_stalled` surfacing from pulse (if pulse lane is down entirely).

**Recommended fix:** Gate the override on `isDeskSessionLiveFromPulse(out) || pulse?.available` OR set `feed_stalled: true` when forcing session open without fresh pulse.

---

### P2 — Staging full playbook enablement lacks governor stress test

**File:** `src/features/spx/lib/spx-staging-full-enablement.test.ts`

Covers allowlist, regime eligibility, VWAP proxy on staging vs prod. **Missing:** concurrent arming of many playbooks → `trade-governor.ts` / zerodte `governor.ts` cap enforcement under staging full enablement (all PB-01..PB-14 live on staging).

**Recommended fix:** Add integration-style test: N simultaneous playbook matches → assert governor caps / primary-rank winner.

---

### P3 — Stale comment / doc drift

| Item | Location | Note |
|------|----------|------|
| ISSUE-18+20 comment | `spx-desk-merge.ts:388` | Intent (instant cross) conflicts with `5a9962ff` hysteresis policy — pick one and document |
| Cortex ABSTAIN tiering | `zerodte/tiers.ts` | Abstain is evidence gap not zero — tested, but worth staging RTH spot-check in checklist |
| Float display noise | `docs/audit/BASELINE-2026-07-01.md` | Still applies to some API payloads; pulse rounding fix (`5a9962ff`) helped pulse lane only |

---

## Solid areas (no action required for audit)

| Area | Why |
|------|-----|
| **Server desk build** | `spx-desk.ts` hysteresis + `isAboveFlipFromRegime` + extensive comments |
| **Playbook verdict guard** | `playbook-verdict-guard.ts` + `PLAYBOOK_VERDICT_GUARD_ASSERT=1` in CI test script |
| **Cortex gate** | Fail-closed veto path tested in zerodte + nighthawk suites |
| **Gate stack** | `src/lib/zerodte/gates.ts` — broad unit coverage |
| **Bootstrap / hydration** | `SpxDashboard.tsx` hydration fix in `5a9962ff`; `useMergedDesk` session cache |
| **Staging vs prod isolation** | `isStagingDeploy()` / `spx-staging-full-enablement.test.ts` — prod conservative path unchanged |
| **Test coverage** | 3762 tests green; dedicated suites for signals, synthesis, playbook FSM, promotion eval, shadow matcher |

---

## Staging-only configuration notes

- **All playbooks paper-live on staging** via `NEXT_PUBLIC_SITE_URL=https://staging.blackouttrades.com` (see full-enablement tests).
- **Clerk satellite** auth — prod keys, primary sign-in on `blackouttrades.com` (AGENTS.md).
- **UW budget:** `UW_MAX_RPS=1`, narrowed WS tickers — expect slower tape vs prod.
- **RDS:** point-in-time copy from prod; live ingest independent (not streamed from prod).

---

## Recommended fix order (sandbox PRs only)

1. **P1-a + P1-b** — single PR: pulse merge + voice snapshot coherence + tests (highest user trust impact).
2. **P1-c** — desk verifier invariant update (ops / admin accuracy).
3. **P2** — OR intel + session override + governor stress test (can split).

Do **not** cherry-pick to prod `main` without explicit user request.

---

## Validation commands (staging)

```bash
npm test                                    # full suite — blocking
npx tsc --noEmit                            # CI blocking
npm run lint:brand                          # CI blocking
npm run validate:staging                    # deploy + warm harness
npm run validate:staging-rth                  # weekday RTH — sockets, spx/play
npm run validate:spx-rth                     # SPX matrix + alerts (if configured)
```

---

## Open questions

1. **Pulse crossing UX:** Product intent — should UI flip side-of-flip **instantly** on spot cross, or stay aligned with hysteresis regime until GEX lane refreshes? Current code tries both and conflicts.
2. **Verifier in prod admin:** Is `/admin` desk verifier shown to operators during RTH? If yes, P1-c false flags are user-visible today.
3. **Prod merge:** When staging fixes land, plan a focused prod PR (not this audit branch) with RTH validation on `validate:rth-open`.

---

## Related commits (recent sandbox SPX history)

| Commit | Summary |
|--------|---------|
| `5a9962ff` | Desk side-of-flip / regime / narration coherence (server path) |
| `93ffa3d5` | Zerodte honest SKIP narration (#355) |
| #312–#330 | Gates, Cortex, exit engine, tier wiring, OPEN latch |
| `91b606f4` | Uniform spot 1s / GEX 5s refresh (#393) |

---

*Audit authored on branch `cursor/spx-slayer-deep-audit-261c`. Documentation only — no runtime code changes in this PR.*
