# SPX Playbook — Architecture & Status (Single Source of Truth)

**Repo:** `coreentryadmin-web/blackout-web-sandbox` → `https://staging.blackouttrades.com`  
**Last updated:** 2026-07-10  
**Scope:** Staging playbook lab only — do **not** merge to Railway prod `blackout-web` `main` unless explicitly requested.

This document consolidates architecture, implementation status, per-playbook fidelity, four setup families, what is fixed, what remains, validation tiers, and code map. Older docs (`PLAYBOOK-ARCHITECTURE-DEEP-DIVE.md`, `PLAYBOOK-IMPLEMENTATION-ROADMAP.md`, etc.) remain as detail appendices; **start here** for current truth.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Architecture — layered decision stack](#2-architecture--layered-decision-stack)
3. [Four setup families](#3-four-setup-families)
4. [What changed from the old model](#4-what-changed-from-the-old-model)
5. [Runtime flow (today)](#5-runtime-flow-today)
6. [Per-playbook status matrix](#6-per-playbook-status-matrix)
7. [Shipped fixes (PR trail)](#7-shipped-fixes-pr-trail)
8. [Open gaps & phase plan](#8-open-gaps--phase-plan)
9. [Gates, flags, and live allowlist](#9-gates-flags-and-live-allowlist)
10. [Telemetry & evidence promotion](#10-telemetry--evidence-promotion)
11. [External assessment scores](#11-external-assessment-scores)
12. [Data & research requirements](#12-data--research-requirements)
13. [Instance schema — 20 required fields](#13-instance-schema--20-required-fields)
14. [Expectancy metrics (not win rate alone)](#14-expectancy-metrics-not-win-rate-alone)
15. [Hard constants — OOS validation bands](#15-hard-constants--oos-validation-bands)
16. [Code map](#16-code-map)
17. [Validation commands](#17-validation-commands)
18. [Related docs](#18-related-docs)

---

## 1. Executive summary

| Dimension | Status |
|-----------|--------|
| **Model** | Playbook-first BUY on staging (14 named setups PB-01…PB-14) replacing opaque confluence score |
| **Staging deploy** | Playbook lab **hardwired** via `isStagingDeploy()` — live gate always on |
| **Live allowlist** | PB-01, PB-02, PB-03, PB-04 only (`PLAYBOOK_LIVE_ALLOWLIST`) |
| **Prod Railway** | Legacy confluence BUY unless `PLAYBOOK_LIVE_GATE=1` (off) |
| **Primary selection** | FULL-SPEC §5 order minus PB-09 (HELIX modifier only) |
| **State machine** | Per-instance transitions with **invalidation**; still tick-recomputed matchers |
| **Evidence** | n=19 prod outcomes mined; autonomous prod BUY frozen until tier thresholds |

**Bottom line:** Staging is the evidence lab. Architecture is promising; **trading edge remains unproven**. Do not confuse explainability with profitability. Four families validate edge before per-PB label splits. PB-09 demoted. Unknown regime and severe data quality fail-closed on live BUY. MVP matchers stay shadow-only until promotion tiers met.

> **Critical takeaway:** Do not interpret the sophistication of the architecture as evidence that the strategy works. The architecture enables falsifiable hypotheses; profitability requires clean prospective evidence, execution realism, and risk controls.

---

## 2. Architecture — layered decision stack

```mermaid
flowchart TD
  subgraph L0["Layer 0 — Data"]
    D[SpxDeskPayload]
    T[PlayTechnicals]
    M[OrBreakMemory]
  end

  subgraph L1["Layer 1 — Matcher (14 PBs)"]
    R[PLAYBOOK_REGISTRY]
    RM[playbook-regime-router]
    SM[matchPlaybooksShadow]
    PR[pickPrimaryPlaybook — PB-09 excluded]
  end

  subgraph L2["Layer 2 — Gates A1–A17"]
    G[evaluatePlayGates]
    A17[Gate A17: live allowlist + regime + data quality]
  end

  subgraph L3["Layer 3 — Engine"]
    E[evaluateSpxPlay]
    O[openPlay + playbook_id + execution_sim]
  end

  subgraph L4["Layer 4 — Management"]
    X[evaluateOpenPlay — legacy exits]
  end

  D --> SM
  T --> SM
  M --> SM
  R --> SM
  RM --> SM
  SM --> PR
  PR --> G
  SM --> E
  G --> E
  E --> O
  O --> X
```

### Layer responsibilities

| Layer | Owns | Does not own |
|-------|------|--------------|
| **Matcher** | Preconditions (ARM), triggers (FIRE), direction, session window, regime eligibility | Position sizing, exits |
| **Gates** | Session/risk vetoes, macro windows, halt, grade floors, **A17 playbook live gate** | Direction pick |
| **Engine** | BUY/SCANNING/WATCHING, confluence score (legacy), open play lifecycle | Per-PB invalidation after entry |
| **Management** | STOP/TARGET/TRIM/THESIS/THETA | Named setup identity on exit |

### Gate categories (post-hoc labels today)

`blocks_by_category` on `PlayGateResult`: `operational`, `risk`, `validity`, `quality`. Evaluation is still flat AND — **split evaluation order is phase 2**.

### Data quality modes (live gate)

| Mode | Condition | Live BUY effect |
|------|-----------|-----------------|
| `normal` | All feeds fresh | Standard per-PB rules |
| `degraded` | 1 issue (halt stale **or** desk stale **or** gex missing) | Event/breakout PBs blocked (PB-03,05,09,13,14) |
| `severe` | 2+ issues simultaneously | **Fail-closed** all live playbook BUY |

Global halt channel remains **fail-open** with warning in `spx-play-gates.ts` (confirmed live halt still blocks).

---

## 3. Four setup families

Validate **family edge first**, then test whether individual PB labels separate outcomes.

| Family | Playbooks | Role | Live allowlist today |
|--------|-----------|------|----------------------|
| **Trend continuation** | PB-03, PB-05, PB-06, PB-08, PB-10 | Breakouts, wall rides, power hour, EMA stack | PB-03 |
| **Mean reversion** | PB-02, PB-04, PB-07, PB-11 | VWAP reject, pin fade, max pain, chop scalp | PB-02, PB-04 |
| **Reversal / failure** | PB-01, PB-12, PB-13, PB-14 | VWAP reclaim, lotto reversal, gap fade, failed ORB | PB-01 |
| **Flow / event (modifier)** | PB-09 | HELIX surge — **never primary** | None |

Registry fields: `setup_family`, `fidelity` (`high` | `mvp`) on each `PlaybookDefinition` in `playbook-registry.ts`.

### Primary priority (FULL-SPEC §5 minus PB-09)

```
PB-13 → PB-14 → PB-03 → PB-05 → PB-06 → PB-04 → PB-07 → PB-08 → PB-01 → PB-02 → PB-10 → PB-11 → PB-12
(PB-09 never primary — flow modifier only)
```

Implemented in `playbook-primary-rank.ts` → `pickPrimaryPlaybook()`. Family fields drive `family_audit` telemetry rollup.

---

## 4. What changed from the old model

| Old (confluence) | New (playbook) |
|------------------|----------------|
| Scalar score + grade | Named setup with ARM/TRIGGER/INVALIDATION |
| Direction = sign(score) → long-only bias | Per-PB direction + short pipeline audit |
| "Factor soup" — no audit trail | `playbook_id` on open + shadow telemetry |
| Bought breakouts inside gamma pin | Regime router + family-aware primary |
| HELIX could dominate primary | PB-09 demoted to modifier |

**Evidence (prod n=19):** 31.6% win rate, grade did not predict, 18/19 entries in `mean_revert` γ at entry. See `PLAYBOOK-EVIDENCE-BASE.md`.

---

## 5. Runtime flow (today)

Every ~2s play poll on staging:

1. `buildPlayTechnicals(desk)` — OR, VWAP streaks, EMA9 curl, breakout flags
2. `matchPlaybooksShadow(desk, technicals, now, { or_break_memory })` — 14 verdicts
3. `pickPrimaryPlaybook(verdicts)` — excludes PB-09; family-grouped tie-break
4. `evaluatePlayGates(..., { playbook_primary_id, playbook_primary_direction })` — A17 on BUY
5. `buildPlaybookShadowPanel()` → API `playbook_shadow` with `pipeline_audit` + `family_audit`
6. `maybeLogPlaybookShadowMatch()` → Postgres + instance transitions
7. If gates pass + lab path → `openPlay()` with `playbook_id`, `execution_sim` on option ticket

### State machine (stub → P1)

| State | Meaning |
|-------|---------|
| `idle` | Window closed, regime ineligible, or no precondition |
| `armed` | `precondition_match` true |
| `triggered` | `trigger_fired` true |
| `invalidated` | Lost precondition after armed, or trigger dropped after fired |

`collectPlaybookInstanceTransitions()` uses `resolvePlaybookLifecycleState()` — persisted to `spx_playbook_instances` / shadow row `instance_transitions`.

**Still tick-recomputed:** matchers do not require prior armed duration or blocked-while-armed ordering (phase 2).

---

## 6. Per-playbook status matrix

| ID | Name | Family | Fidelity | Matcher | Live | Notes |
|----|------|--------|----------|---------|------|-------|
| PB-01 | VWAP Reclaim | reversal_failure | **high** | Strict `minutes_below_vwap >= 15` | ✅ allowlist | #61 |
| PB-02 | VWAP Reject | mean_reversion | **high** | Flow materiality ≥100k | ✅ allowlist | Not z-score/persistence yet |
| PB-03 | OR Breakout | trend_continuation | **high** | OR break + flow; static MTF buffer | ✅ allowlist | Buffer not VIX/OR-normalized |
| PB-04 | Gamma Pin Fade | mean_reversion | mvp | Wall proximity proxy | ✅ allowlist | Shadow-quality matcher |
| PB-05 | Wall Break Cont. | trend_continuation | mvp | Wall break, no VEX streak | ❌ shadow | Degraded-feed block on live |
| PB-06 | Flip Level Ride | trend_continuation | mvp | Flip break + EMA stack proxy | ❌ shadow | |
| PB-07 | Max Pain Gravitation | mean_reversion | mvp | Time + distance proxy | ❌ shadow | |
| PB-08 | Power Hour Mom. | trend_continuation | mvp | Net flow + micro-range | ❌ shadow | Parallel `spx-power-hour-engine` |
| PB-09 | HELIX Flow Surge | flow_event | mvp | HELIX tier + desk align | ❌ **never primary** | Modifier; degraded block if live |
| PB-10 | EMA Stack Pullback | trend_continuation | mvp | Uses `minutes_above_vwap` as EMA proxy | ❌ shadow | Needs real EMA stack fields |
| PB-11 | Range Chop Scalp | mean_reversion | **high** | Rolling 30m high/low | ❌ shadow | #61 |
| PB-12 | Lotto Reversal | reversal_failure | mvp | Session change % proxy | ❌ shadow | Parallel `spx-lotto-engine` |
| PB-13 | Gap Fade | reversal_failure | mvp | Gap + fail-to-extend | ❌ shadow | Degraded-feed block |
| PB-14 | Failed ORB Reversal | reversal_failure | **high** | OR break memory + re-entry | ❌ shadow | Memory #64; not on allowlist |

---

## 7. Shipped fixes (PR trail)

| PR | What shipped |
|----|--------------|
| **#59–60** | Deep-dive docs, external review response, promotion tiers |
| **#61** | PB-11 rolling 30m range; PB-01 strict 15m VWAP pre |
| **#62** | `PLAYBOOK_LIVE_ALLOWLIST` enforced at gate A17 |
| **#63** | State machine stub, pipeline audit, feature snapshot, unknown regime fail-closed, degraded feed PB blocks, PB-02 flow materiality, option sim stub |
| **#64** | Gate `blocks_by_category`, `execution_sim` on open, PB-14 OR break memory, validate `pipeline_audit` |
| **This branch** | `setup_family` + `fidelity` on registry; `playbook-primary-rank` (PB-09 demoted); `family_audit` rollup; invalidation transitions; `liveDataQualityMode` severe fail-closed; this doc |

---

## 8. Open gaps & phase plan

### P0 — Done on staging

- [x] Live allowlist gate A17
- [x] Instance id + transitions + feature snapshot
- [x] Pipeline audit (long/short + family rollup)
- [x] Unknown regime fail-closed (live)
- [x] Per-PB degraded feed blocks (event set)
- [x] PB-01/02/11/14 matcher hardening
- [x] PB-09 excluded from primary
- [x] Invalidation state transitions
- [x] Severe data quality global fail-closed

### P1 — In progress / next

| Item | Status | Detail |
|------|--------|--------|
| Evidence-aware primary ranking | 🟡 Partial | Family priority + candidate score; no historical win-rate weight yet |
| Layered gate evaluation (4 layers) | ⏳ Planned | Categories are labels only today |
| Armed duration / blocked-while-armed | ⏳ Planned | Tick-recomputed ARM is optimistic |
| Precondition → trigger ordering guard | ⏳ Planned | Can fire trigger same tick as arm |
| Global live size reduction on `degraded` | ⏳ Planned | Only per-PB blocks today |
| PB-03 VIX/OR-normalized buffer | ⏳ Planned | Static `playMtfBufferPts()` |
| PB-02 z-score / persistence | ⏳ Planned | Materiality threshold only |
| PB-10 real EMA stack fields | ⏳ Planned | VWAP minutes proxy |
| Playbook-specific exits | ⏳ Planned | Legacy engine owns exits |
| Merge lotto/power-hour into PB-08/12 | ⏳ Decision | Parallel engines still exist |

### P2 — Production discipline

| Item | Status |
|------|--------|
| Session risk governor | 🟡 Partial (`playSessionMaxEntries` / `playSessionMaxLosses`) |
| Limited-live prod with min size | ❌ Blocked until evidence tiers |
| Autonomous prod BUY | ❌ Frozen |
| Expand beyond 14 playbooks | ❌ Frozen |

### P3 — Catalog hygiene

| Item | Status |
|------|--------|
| Typed registry → doc matrices CI check | ⏳ Planned |
| PB-14 allowlist expansion | ⏳ Blocked on evidence |
| Family-level outcome mining | ⏳ Planned (SQL on `playbook_id` + `setup_family`) |

---

## 9. Gates, flags, and live allowlist

### Staging (always on)

- `playbookStagingLabEnabled()` → `isStagingDeploy()` at Docker build
- `playbookLiveGateEnabled()` → true on staging
- Default allowlist: `PB-01,PB-02,PB-03,PB-04` (`PLAYBOOK_LIVE_ALLOWLIST_DEFAULT_STAGING`)
- Infra: `blackout-infra` `apply-staging-env-overrides.mjs` sets `PLAYBOOK_LIVE_ALLOWLIST`

### Gate A17 checklist (live BUY)

1. `playbook_primary_id` not null (fired primary, PB-09 excluded)
2. Primary in `PLAYBOOK_LIVE_ALLOWLIST`
3. Not `isUnknownPlaybookRegime(desk)`
4. Not `severe` data quality mode
5. Not `isDegradedForLivePlaybook(pbId, flags)` for event PBs
6. Direction aligns with staging lab path when applicable

### Prod

- Playbook live gate **off** unless `PLAYBOOK_LIVE_GATE=1`
- No autonomous BUY expansion without evidence sign-off

---

## 10. Telemetry & evidence promotion

### Tables

| Table | Content |
|-------|---------|
| `spx_playbook_shadow_observations` | Verdicts, `pipeline_audit`, `family_audit`, `feature_snapshot`, `instance_transitions` |
| `spx_playbook_instances` | Durable per-day per-PB state |
| `spx_open_play.playbook_id` | PB on entry |
| `spx_play_outcomes.playbook_id` | PB on close for joins |

### Promotion tiers (unchanged)

| Tier | Threshold |
|------|-----------|
| Research | ≥30 triggers, ≥20 simulated trades |
| Staging-qualified | 50–75 prospective, cost-adjusted expectancy |
| Limited-live prod | Min size + risk governor + per-trade quote reconciliation |

**Do not** enable prod autonomous BUY or expand allowlist without meeting tiers.

---

## 11. External assessment scores

Independent review (2026-07-10) — aligned with repo policy:

| Dimension | Score | Assessment |
|-----------|-------|------------|
| **Architecture** | 8/10 | Layered model, shadow rollout, named setups, state-machine direction, telemetry path are strong |
| **Strategy specification** | 6/10 | Thoughtful rules, but static thresholds, weak proxies, incomplete fields, overlapping playbooks |
| **Evidence quality** | 2/10 | n=19 prod trades, all long, negative avg P&L, no playbook-specific prospective sample |
| **Production readiness** | 3/10 | Appropriate for shadow/staging; not trusted autonomous 0DTE generation |
| **Potential** | 8/10 | Could become serious if next work is prospective evidence + execution realism + risk controls |

---

## 12. Data & research requirements

ChatGPT research checklist (2026-07-10). **Policy already matches** several items; implementation gaps below.

### 12.1 Capture every eligible setup — not only opens

**Requirement:** Log armed, triggered, blocked, and invalidated setups so gate impact on expectancy can be measured.

| Capability | Status |
|------------|--------|
| Shadow observations on state change | ✅ `maybeLogPlaybookShadowMatch` (throttled) |
| Per-PB verdicts every observation | ✅ `verdicts` JSONB |
| `pipeline_audit` funnel (long/short + family) | ✅ Shipped |
| `blocked_*` when gates veto primary | 🟡 Partial — only when engine evaluates BUY with `gate_blocks` passed in |
| Per-instance row for **non-primary** armed setups | ❌ One instance per PB per day, but no `reason_blocked` / `executable` flag |
| Counterfactual path for blocked triggers | ❌ Not logged |

**Next:** Emit one durable row per `(instance_id, transition)` including blocked-primary events even when action ≠ BUY.

### 12.2 Freeze feature values at decision time

**Requirement:** Gamma walls, max pain, regime, flow, derived levels must be **timestamped and immutable** at arm/trigger/block — no look-ahead relabeling.

| Field | Status |
|-------|--------|
| `PlaybookFeatureSnapshot` at observation | ✅ `captured_at` + desk slice |
| Snapshot on instance arm/trigger | ✅ Upsert writes `feature_snapshot` |
| Full GEX wall geometry frozen | ❌ Only `gex_wall_count` today |
| Max pain / king strike frozen | ❌ Not in snapshot |
| Per-transition snapshot (not overwritten) | ❌ Instance row overwrites latest snapshot |

**Next:** Append-only `spx_playbook_instance_events` with immutable snapshot per transition.

### 12.3 Separate hypothesis generation from validation

**Requirement:** The n=19 prod outcomes that **motivated** the playbook redesign are **training only** — never used to validate new rules.

| Rule | Status |
|------|--------|
| `PLAYBOOK-EVIDENCE-BASE.md` documents n=19 as motivation | ✅ |
| PB-04, PB-08, all non-allowlist PBs | Must validate **prospectively** from post-design sessions only |
| Promotion tiers require new sample sizes | ✅ Research ≥30 triggers; staging ≥50–75 |
| Automated firewall excluding pre-2026-07-07 outcomes from promotion SQL | ❌ Manual discipline only |

**Next:** `scripts/playbook-evidence-report.mjs` with `TRAIN_CUTOFF_DATE` and OOS-only promotion queries.

### 12.4 Evaluate gates — blocked vs non-opened

**Requirement:** Without blocked-setup logging, cannot tell if safety gates improve or hurt expectancy.

| Signal | Status |
|--------|--------|
| `blocks_by_category` on gate result | ✅ Labels only |
| `pipeline_audit.blocked_long/short` | 🟡 When opts passed |
| Per-playbook block reason on primary candidate | ❌ |
| Shadow log when primary fired but gates blocked | ❌ Not always persisted |

---

## 13. Instance schema — 20 required fields

Target row per playbook instance (research contract):

| # | Field | Status | Where today |
|---|-------|--------|-------------|
| 1 | `session_date` | ✅ | `spx_playbook_instances` |
| 2 | `playbook_id` | ✅ | same |
| 3 | `instance_id` | ✅ | `{session}:{playbook_id}` |
| 4 | `armed_at` | ✅ | COALESCE on first armed |
| 5 | `triggered_at` | ✅ | COALESCE on first triggered |
| 6 | `invalidated_at` | ❌ | State exists; **no column** |
| 7 | `opened_at` | ❌ | Only on `spx_open_play` join |
| 8 | `closed_at` | ❌ | Only on `spx_play_outcomes` join |
| 9 | `direction` | ✅ | instance row |
| 10 | regime snapshot | 🟡 | `feature_snapshot.regime` + obs row |
| 11 | input feature snapshot | 🟡 | Partial `PlaybookFeatureSnapshot` |
| 12 | data-quality flags | 🟡 | `halt_channel_stale` only in snapshot |
| 13 | reason armed | 🟡 | `detail` string |
| 14 | reason triggered | 🟡 | `detail` on trigger transition |
| 15 | reason blocked | ❌ | Not persisted per instance |
| 16 | reason invalidated | ❌ | Transition logged in JSONB only |
| 17 | underlying entry reference | ❌ | No spot/level at open on instance |
| 18 | option contract candidate | 🟡 | `execution_sim` on open play only |
| 19 | counterfactual MFE/MAE | ❌ | Not tracked for non-opens |
| 20 | actual outcome | 🟡 | `spx_play_outcomes` when opened |

**Coverage today: ~9/20 complete, ~6/20 partial, ~5/20 missing.**

---

## 14. Expectancy metrics (not win rate alone)

Per playbook (and per family), compute from **prospective OOS sample only**:

| Metric | Status |
|--------|--------|
| armed / triggered / executable counts | 🟡 Funnel in `pipeline_audit`; no SQL report |
| win rate | 🟡 `spx_play_outcomes` when opened |
| mean & median return | ❌ No playbook report script |
| profit factor | ❌ |
| expectancy | ❌ |
| downside deviation | ❌ |
| median MAE / MFE | ❌ |
| MFE capture % | ❌ |
| tail loss | ❌ |
| time in trade | 🟡 On outcomes table generally |
| results after cost assumptions | 🟡 `execution_sim` stub at open |
| performance by VIX / gamma regime | ❌ |

> A 40% win-rate system can be excellent. A 60% win-rate system can lose money. Promotion decisions must use expectancy and cost-adjusted returns, not win rate alone.

**Next:** `npm run playbook:evidence-report` aggregating instance events + outcomes + `execution_sim`.

---

## 15. Hard constants — OOS validation bands

Several thresholds are **documented but lightly motivated**. Do **not** optimize each independently on n=19. Use **stability bands** — a real edge should survive 8↔12 pts proximity, not disappear at small moves.

| Constant | Default | Env override | Validation band (proposed) |
|----------|---------|--------------|----------------------------|
| Wall proximity | 10 pts | `SPX_PLAY_STRUCTURE_PROX_PTS` | 8–12 |
| MTF breakout buffer | 1 pt | `SPX_PLAY_MTF_BUFFER_PTS` | 0.5–2 |
| Wall stop offset | 3 pts | code | 2–4 |
| HELIX stop | 5 pts | code | 4–6 |
| Gap threshold (PB-13) | 0.3% | matcher | 0.25–0.35% |
| Range chop (PB-11) | 0.35% | matcher | 0.30–0.40% |
| RSI stretch (PB-12) | 72/28 | matcher | 70–74 / 26–30 |
| VWAP duration (PB-01) | 15 min | matcher | 12–18 min |
| Flow materiality (PB-02) | 100k | `PLAYBOOK_FLOW_MATERIALITY_MIN` | 75k–150k |

**Next:** Parameter sweep harness on **OOS shadow instances only** (post 2026-07-10), report sensitivity not optimum.

---

## 16. Code map

| Module | Role |
|--------|------|
| `playbook-registry.ts` | PB-01…14 + `setup_family` + `fidelity` |
| `playbook-primary-rank.ts` | `pickPrimaryPlaybook`, `PLAYBOOK_PRIMARY_PRIORITY` |
| `playbook-regime-router.ts` | Regime eligibility + `isUnknownPlaybookRegime` |
| `playbook-shadow-matcher.ts` | 14 matchers → verdicts |
| `playbook-shadow-panel.ts` | API/UI snapshot |
| `playbook-shadow-log.ts` | Postgres telemetry |
| `playbook-pipeline-audit.ts` | Long/short funnel + `family_audit` |
| `playbook-state.ts` | Lifecycle + invalidation transitions |
| `playbook-data-quality.ts` | Flags + `liveDataQualityMode` |
| `playbook-break-memory.ts` | PB-14 OR break memory |
| `playbook-option-sim.ts` | `execution_sim` on option ticket |
| `playbook-gate-categories.ts` | Gate block category labels |
| `spx-play-gates.ts` | A1–A17 including playbook live gate |
| `spx-play-engine.ts` | `evaluateSpxPlay` integration |
| `spx-play-config.ts` | Flags, allowlist, flow materiality min |

---

## 17. Validation commands

```bash
# Local
npm test -- --test-name-pattern 'playbook'
npx tsc --noEmit
npm run lint:brand

# Staging (after ECS deploy)
npm run validate:staging-playbook
```

Expected staging playbook validate:

- `playbook_shadow.mode === "live"`
- 14 verdicts
- `pipeline_audit` present (includes `family_audit`)
- Primary never PB-09 when other PBs fire

---

## 18. Related docs

| Doc | Use when |
|-----|----------|
| `PLAYBOOK-FULL-SPEC-v2.md` | Field-level PB rules, gates A1–A17 |
| `PLAYBOOK-EVIDENCE-BASE.md` | Prod SQL mining, why we changed |
| `PLAYBOOK-EXTERNAL-REVIEW-2026-07-10.md` | ChatGPT + Claude review response |
| `PLAYBOOK-ARCHITECTURE-DEEP-DIVE.md` | Long narrative + UI surfaces |
| `PLAYBOOK-E2E-FOUNDATION.md` | Mermaid rollout phases |
| `PLAYBOOK-CTO-BRIEF-2026-07-10.md` | Executive RTH snapshot |
| `PLAYBOOK-IMPLEMENTATION-ROADMAP.md` | Short tracker (points here) |

---

*Maintainers: update this file when merging playbook PRs to `blackout-web-sandbox`. Run `validate:staging-playbook` after ECS deploy.*
