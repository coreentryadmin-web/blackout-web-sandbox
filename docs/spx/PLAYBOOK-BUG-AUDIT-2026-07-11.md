# SPX Playbook — Consolidated Bug Audit (Rounds 1–2 + Cursor)

**Date:** 2026-07-11 (updated 2026-07-11T03:30Z — foundation assessment + third-pass Q&A)  
**Repo:** `coreentryadmin-web/blackout-web-sandbox` (staging)  
**Branch:** `blackout-web-sandbox`  
**Staging URL:** https://staging.blackouttrades.com  

**Merged PRs (this session):**

| PR | Title | Commit area |
|----|--------|-------------|
| [#80](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/80) | Playbook bugfix stack (consolidated audit) | matcher, gates, governor, telemetry |
| [#81](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/81) | Lifecycle hygiene — single FSM writer + unified OR | `spx-service`, `playbook-shadow-log` |
| [#82](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/82) | `playbook_instance_id` on outcomes | `db.ts`, `spx-play-engine`, evidence join |
| [#83](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/83) | Option PnL + gamma hysteresis + PB-04 debounce | `spx-play-engine`, `gamma-desk`, exit engines |
| [#84](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/84) | Audit doc fix-order strikethroughs | docs only |

| [#86](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/86) | Staging connect guide | docs only |
| [#88](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/88) | WATCH→ENTRY buy-cooldown bypass (#12) | `spx-play-engine`, `spx-play-gates` |
| [#89](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/89) | Shadow state key content fingerprint | `playbook-shadow-log` |
| [#90](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/90) | Cron single OR resolve thread-through | `spx-evaluator`, `playbook-engine-telemetry` |
| [#91](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/91) | Synthetic theta + net PnL floor | `playbook-option-pnl` |
| [#92](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/92) | Gate A17 telemetry bucket (#26) | `playbook-gate-categories` |
| [#93](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/93) | Promotion-eval data-quality gate inert (#20a) | `playbook-promotion-eval` |
| [#94](https://github.com/coreentryadmin-web/blackout-web-sandbox/pull/94) | Second-pass validation + fix status in audit handoff | docs only |

**Staging deploy:** ECR push + ECS rollout for #80–#93 merged to `blackout-web-sandbox`. Second-pass code fixes #88–#93 shipped; confirm image after next ECS rollout.  
**Validation (2026-07-11 off-hours):** `validate:staging` GREEN, `validate:staging-playbook` PASS. RTH open-play / cron FSM not re-proven in this window.

This document merges Claude’s two review rounds with Cursor’s CTO deep-dive. Each item: **status**, **agree/disagree**, **action**.

Legend: ✅ fixed in PR · 🔧 partial · 📋 documented/deferred · ❌ disagree with severity/claim

---

## Handoff for Claude — TODO summary

Use this section first. For **foundation verdict** (what's good vs what's not closed yet), read **Foundation assessment** below. Full item tables retain per-finding detail.

### ✅ Done (agreed items — shipped to staging)

**P0 / lifecycle (PR #81)**

- [x] Single FSM writer — member `/api/market/spx/play` uses `persist_instances: false`; cron `syncPlaybookTelemetryAfterEvaluate` uses `persist_instances: true`
- [x] Unified OR break memory per request — `spx-service` refreshes once, threads through play + shadow panel + shadow-log
- [x] Pass-through `resolved` match — no triple `resolveGuardedPlaybookMatch` on member reads
- [x] Shadow-log dual-writer race — `resolved` + `persist_instances` gate on FSM upserts

**P1 / evidence join (PR #82)**

- [x] `playbook_instance_id` column on `spx_play_outcomes` (schema via `ensureSchema`)
- [x] Engine commits FSM `entry_pending` → `open` before `openPlay`, then stamps instance id on outcome row
- [x] Evidence joins: `playbook_instance_id = instance_id` with legacy fallback `(playbook_id, session_date, direction)` for pre-deploy rows

**P2 / open-play + regime stability (PR #83)**

- [x] `estimateOptionPnl` wired on open-play HOLD path; `open_play.option_pnl_est` on payload
- [x] `gammaRegimeWithHysteresis` (2pt buffer) on desk GEX paths
- [x] PB-04 gamma pin-release SELL debounced (3 consecutive non-`mean_revert` polls)

**Critical / high bugfix stack (PR #80)**

- [x] **#1** PB-01/PB-03 preconditions in triggers + verdict guard requires `precondition_match`
- [x] **#3** `synthetic_fields[]` on greeks snapshot
- [x] **#6** Theta capped at `-entry_premium`
- [x] **#8** Per-PB try/catch in matcher (one throw no longer kills all 14)
- [x] **#10** m5 EMA/RSI from 5m resample only
- [x] **#11** PB exit branch (`priority >= 82`) fires `maybeLogSpxPlay` + Discord
- [x] **#12** Single buy-cooldown path — **reopened & fixed #88** (promote bypass on both governor calls)
- [x] **#14** Allowlist requires `executionModeMeets(…, paper_executable)`
- [x] **#16** Verdict-guard tautology removed — armed polls + precondition only (🔧 prev state still not load-bearing)
- [x] **#34** `console.log` gated behind `SPX_PLAY_DEBUG=1`

**Second-pass P1 (PRs #88–#93)**

- [x] **#12** WATCH→ENTRY `buyCooldownBypass` on gates + `optionGovernor` (#88)
- [x] `playbookShadowStateKey` content fingerprint (#89)
- [x] Cron path single OR resolve thread-through (#90)
- [x] Theta in `synthetic_fields[]` + `net_premium_pnl` floor (#91)
- [x] Gate A17 `playbook_validity` classification (#92)
- [x] **#20a** Promotion-eval data-quality gate inert (#93) — **#20b** sample-builder + caller still open

**Cursor-only P0/P1 (included in #81)**

- [x] Dual FSM writers, split-brain OR, member polls mutating FSM, triple resolver

**Tests:** 2048 pass · `tsc` clean (post second-pass fixes)

---

### 🔧 Partial (agreed — improved but not complete)

| # | Item | What shipped | What remains |
|---|------|--------------|--------------|
| **2** | Session trigger cap 0–1 / invalidate bypass | `loadPlaybookTriggerCountsByPb` expanded | Full episode-level cap audit under concurrent invalidate loops |
| **4** | VWAP volume-weighted honesty | `vwap_volume_weighted` flag on desk | **F1:** fix math or fail-closed; flag alone insufficient — see foundation assessment |
| **22** | PB-14 OR break-memory reset | Fresh break wave clears re-entry latch | Long-session soak / edge cases around multi-wave days |
| **31** | Doc/comment drift | This doc + exit-policy header | Registry comment (#36), architecture SSOT sync |
| **35** | Options tests direction-only | Theta cap + synthetic field tests | Full open-play management integration tests |

---

### 📋 Not done (agreed deferred — Claude review candidates)

Prioritized for a follow-up pass. **Not blocking staging deploy.**

| Priority | # | Item | Why deferred | Suggested next step |
|----------|---|------|--------------|---------------------|
| P1 | **20** | Data-quality gate not in promotion-eval | **#20a done #93** — inert gate landed; **#20b** sample-builder + production caller still required | Build DB sample query + admin route/cron calling `evaluatePlaybookPromotion` |
| P1 | **26** | Gate A17 miscategorized in telemetry | **Done #92** | `not paper-executable` → `playbook_validity` |
| P2 | **19** | Blocked counters primary-only | Shadow analytics | Count blocked events for non-primary armed instances |
| P2 | **21** | Simulated-trade gate OR-fallback | Promotion evidence | Tighten OR-fallback when `execution_sim` missing |
| P2 | **25** | `rolling_30m` no min-session guard | Session stats edge case | Min bars before rolling window surfaces |
| P2 | **27** | Mixed-tape threshold inversion | Env edge case | Reproduce with `MIXED_TAPE_*` env matrix |
| P2 | **29** | Fragile string match on exit/re-entry lock | Engine exit strings | Replace with structured exit reason codes |
| P3 | **9** | Two “ready” status systems | Documented, not unified | Single SSOT or explicit registry vs runtime table in UI |
| P3 | **13** | `playbook-exit-policy.ts` dead duplicate | Header only | Delete or merge into `playbook-exit-engines.ts` |
| P3 | **15** | Primary ranking static family table | By design (OOS priors) | Promotion roadmap doc only |
| Hygiene | **30** | `state` unconstrained TEXT | DB migration risk | `CHECK` constraint on `spx_playbook_instances.state` |
| Hygiene | **32** | 11+ files without tests | Incremental | `playbook-shadow-log`, `spx-service`, FSM sync unit tests |
| Hygiene | **33** | God-files | Large refactor | Split `playbook-shadow-matcher.ts`, `spx-play-engine.ts` |
| Hygiene | **36** | Registry comment false | One-line | Fix `playbook-registry.ts` “never used in live gating” |

**Not validated this session (operational — F4 foundation gap):**

- Staging **browser** E2E with Cognito auth (dashboard redirects to hosted UI; API validation passed)
- **RTH** proof of cron FSM writes + open-play `playbook_instance_id` on a **real** tick sequence with open position — **required for foundation closure**
- **Prod** — all work merged to `blackout-web-sandbox` only; not merged to `blackout-web` `main`
- **Promotion pipeline** — manual script only until **#97** GHA step lands (**F2**)

---

### Key files (for Claude diff review)

| Area | Paths |
|------|--------|
| Matcher / preconditions | `src/features/spx/lib/playbook-shadow-matcher.ts`, `playbook-verdict-guard.ts` |
| Shadow telemetry / FSM | `playbook-shadow-log.ts`, `playbook-engine-telemetry.ts`, `spx-service.ts` |
| Play engine | `spx-play-engine.ts`, `spx-play-store.ts`, `spx-play-outcomes.ts` |
| Evidence / DB | `src/lib/db.ts`, `scripts/playbook-evidence-report.mjs` |
| Option PnL | `playbook-option-pnl.ts` |
| Gamma / exits | `src/lib/providers/gamma-desk.ts`, `spx-desk.ts`, `playbook-exit-engines.ts` |
| Architecture SSOT | `docs/spx/PLAYBOOK-ARCHITECTURE-STATUS.md` |
| **Staging access (AWS, Cognito, scripts)** | `docs/ops/STAGING-CONNECT.md` |

---

### Questions for Claude — second-pass (answered 2026-07-11)

| # | Question | Answer | Status |
|---|----------|--------|--------|
| 1 | Are **#2** and **#22** still P0 under live RTH? | **No** for capital risk today. #2 bypass affects shadow attempt counts, not `openPlay` commits. #22 (PB-14) is shadow-only + not allowlisted — gate A17 blocks real opens. Fix both before the next gate loosens (PB-14 to allowlist, shadow stats trusted for research). | ✅ Answered |
| 2 | Is **`playbookShadowStateKey`** too coarse? | **Was yes** — fingerprint used block count only. **Fixed #89** (sorted block content join, same pattern as `BLOCKED_CURSOR_KEY`). | ✅ Fixed |
| 3 | Does **`playbook_instance_id`** need backfill migration? | **Not now.** ~90 min legacy window on staging only. Run diagnostic: count NULL `playbook_instance_id` rows with ambiguous `(playbook_id, session_date, direction)` groups. Zero → no migration; legacy fallback join is permanent for pre-#82 rows. | ✅ Answered |
| 4 | Minimal wiring for promotion-eval **#20**? | **Two parts:** (a) inert gate **#93** done. (b) `playbook-evidence-report.mjs` already calls `evaluatePlaybookPromotion` manually — **#97** wires it into staging GHA weekly + passes `data_quality_session_fraction`. Not zero callers after #97; still no admin UI. | 🔧 #97 in flight |
| 5 | Regression in dual-path shadow mode (`mode: "live"` on staging)? | **No.** `playbookLiveGateEnabled()` is env-correct per deploy target. `mode: "live"` tightens BUY gating only; **no broker/order execution code** exists in repo. Live staging: `vwap_volume_weighted: false` confirmed on desk payload. | ✅ Answered |

Full reasoning: see **Claude — second-pass validation** section below.

---

### Foundation assessment — human review (2026-07-11)

**Verdict:** Good instincts, good process, fast honest self-correction — **not** a finished strong foundation yet. Architecture is being built well; three closure conditions are still open.

#### What is genuinely good (agree — keep crediting this)

- **Layered design is the right shape:** matcher → FSM → governor → gates → exit engines → promotion pipeline. No shortcut around core safety gates was found in review.
- **Concurrency model is sound:** advisory lock on evaluator, single FSM writer on cron path (#81), member reads observations-only.
- **Test discipline is real:** 2048+ unit tests, blocking `tsc` + `lint:brand` in CI; fixes ship with regression tests.
- **Honest epistemic posture:** external review said *"unproven strategy — don't confuse sophistication for evidence it works"* — team wrote that into docs (`PLAYBOOK-ARCHITECTURE-STATUS`, promotion thresholds) and kept repeating it. Rare and matters.

#### Why "strong foundation" is not true yet (five gaps)

| # | Gap | Current state | What "closed" looks like |
|---|-----|---------------|--------------------------|
| **F1** | **Bottom-of-stack input unverified** | SPX VWAP on live staging is **not volume-weighted** (`vwap_volume_weighted: false` on desk). Flag discloses; math unchanged (`spx-session.ts` ISSUE-16). Most playbooks read VWAP. | Either fix VWAP source (real index bar volume) **or** formally downgrade VWAP-dependent playbooks until verified; re-tune matchers against correct signal. |
| **F2** | **Zero production evidence of edge** | `evaluatePlaybookPromotion` never runs in prod/cron/admin. Historical evidence: **n=19, all long, net negative** (`scripts/playbook-evidence-report.mjs`). Promotion stats (trimmed mean, walk-forward, slippage stress) are well-built but idle. | **#20b:** sample-builder + scheduled/admin caller; first real promotion report against ≥N sessions of instance-linked outcomes. |
| **F3** | **Recurring bug shape — no structural guardrail** | Same failure mode patched individually: precondition computed but not wired (PB-01/03); tautology "fixed" by deleting dead code without making check load-bearing (#16); cooldown bypass fixed at one `evaluateTradeGovernor` call site, not the second (#12). Suggests more instances exist unseen. | Structural fixes: single governor result threaded (not dual call); lint/type enforcing trigger fns consume `precondition_match`; verdict guard test that `prev` state changes outcome when intended; audit for duplicate evaluation paths. |
| **F4** | **Nothing proven under real RTH** | All verification (Claude second-pass + Cursor fixes) = static code read or off-hours API (`market_open: false`). FSM commits, trigger cap, option PnL on HOLD, PB-04 debounce: **not watched through a real RTH tick sequence with an open position.** | One documented RTH session: cron FSM writes, triggered→open path, `playbook_instance_id` on outcome, PB-04 debounce under regime flip. Runbook: `docs/ops/RTH-OPEN-RUNBOOK.md` + `validate:staging-rth`. |
| **F5** | **Complexity outpaces deduplication** | Parallel systems: two exit-policy files (one dead #13), two readiness status systems (#9), temporal contract vs matcher hardcoded windows, god-files (#33). Each layer tested in isolation; integration surface grows → more F3-class bugs likely. | Hygiene sprint: delete/merge dead exit-policy; single readiness SSOT; temporal windows sourced from one registry; split `spx-play-engine` / `playbook-shadow-matcher` with integration tests. |

**Foundation closure checklist (all three required before "strong"):**

1. [x] VWAP question **closed** — **#96** fail-closed PB-01/PB-02; live staging `vwap_volume_weighted: false`, PB-02 `eligible=false`
2. [x] Promotion pipeline **runs against real data** — **#97** GHA + **`GET /api/admin/playbook/promotion-report`** (#20b) + **#99** GHA fail signal on `data_quality` gate
3. [ ] At least **one RTH session** observed end-to-end — **next weekday** (`validate:staging-rth`); **`GET /api/admin/playbook/fsm-today`** enables proof from constrained sandboxes

---

### Cursor executive decision (2026-07-11) — no further Claude review gate

**Decision:** Stop routing through another Claude pass for prioritization. The foundation gaps are unambiguous; execute directly on `blackout-web-sandbox`.

| Priority | Action | Owner | PR |
|----------|--------|-------|-----|
| **P0** | F1 — fail-closed VWAP playbooks until feed fixed | Cursor | **#96** |
| **P0** | F4 — RTH observation on next weekday open | Cursor + GHA | `validate:staging-rth` (existing) |
| **P1** | F2 / **#20b** — promotion sample-builder + admin route | Cursor | **this PR** |
| **P1** | F3 — single governor thread + option overlay (no dual `evaluateTradeGovernor`) | Cursor | **this PR** |
| **P1** | Q4 — `assertPlaybookVerdictGuardInvariants` (`PLAYBOOK_VERDICT_GUARD_ASSERT=1`) | Cursor | **this PR** |
| **P2** | F5 — delete dead exit-policy, unify readiness SSOT | Deferred | #13, #9 |

**What we are NOT doing this sprint:**
- Merging to prod `blackout-web` `main`
- Loosening allowlist or gates before F1/F2 close
- Calling the foundation "strong" in docs until checklist is green

**Claude role going forward:** Answer **third-pass questions** in this doc when asked — not own the sprint queue. Human verdict (foundation assessment above) is the north star.

---

### Questions for Claude — third pass (2026-07-11)

Read **Foundation assessment** above first. These are the open questions for the next review:

1. **F1 / #4 VWAP:** Given `vwap_volume_weighted: false` on staging today, which playbooks are *structurally invalid* until VWAP is fixed vs merely degraded? Should matchers fail-closed when the flag is false?
2. **F2 / #20b:** Propose the minimal sample-builder query (tables, joins on `playbook_instance_id`, session filters) and where the first production caller should live (admin route vs weekly cron vs `playbook-evidence-report.mjs` extension).
3. **F3:** Audit the codebase for **other dual-evaluation paths** like #12 (same pure function called twice with different bypass/context). Priority files: `spx-play-engine.ts`, `spx-play-gates.ts`, `playbook-verdict-guard.ts`, `playbook-shadow-matcher.ts`.
4. **F3 / #16:** Should `armed_polls >= min` incorporate `prev` FSM state, or is the current honest-but-non-load-bearing design acceptable if docs stop claiming prev matters?
5. **F4:** What is the minimum RTH observation script/checklist to elevate confidence from "code review" to "observed working live"? Cross-check against `validate:staging-rth` and `docs/ops/STAGING-CONNECT.md`.
6. **F5:** Rank the deduplication items (#9, #13, #33, temporal vs matcher windows) by **risk of next F3-class bug** if left alone one more sprint.

**Before reviewing live behavior:** read `docs/ops/STAGING-CONNECT.md` (AWS profile, Cognito, CRON bearer, validation commands).

---

## Claude — third-pass answers (2026-07-11, foundation-focused)

Method: 3 independent agents doing exhaustive full-file reads (not sampling) against the current code, plus my own direct read of `playbook-verdict-guard.ts` for Q4. Cross-checked against live staging (`market_open` confirmed closed at review time — RTH proof, Q5, could not be executed this session; see below). No files edited during investigation.

### Q1 (F1 / #4) — Which playbooks are structurally invalid vs merely degraded by `vwap_volume_weighted: false`? Fail-closed?

Read all 14 matchers in full. Result:

| Verdict | Playbooks | Basis |
|---|---|---|
| **Structurally invalid** | **PB-01 (VWAP Reclaim), PB-02 (VWAP Reject)** | VWAP *is* the thesis — entry level, dwell-time, reclaim/reject trigger all derive directly from `desk.vwap`/`minutes_above_vwap`/`minutes_below_vwap`/`breakout.vwap_reclaim`/`vwap_lost` |
| **Degraded, not invalid** | PB-08 (Power Hour), PB-10 (EMA Stack Pullback) | VWAP is a secondary AND-condition; primary trigger (HOD/LOD break + flow for PB-08; independent EMA9/20/SMA50 stack for PB-10) is unaffected |
| **Unaffected** | PB-03, 04, 05, 06, 07, 09, 11, 12, 13, 14 | Zero VWAP field reads, confirmed by grep, not inferred from name |

**No blast radius beyond direct readers** — `gamma-desk.ts` has zero VWAP references (gamma flip/regime/GEX walls are independently computed), and there is no `market_breadth.pct_above_vwap` aggregate anywhere in this codebase to contaminate.

**This is not theoretical — PB-01 is on staging's default live allowlist today** (`PLAYBOOK_LIVE_ALLOWLIST` default = PB-01–03).

**Fail-closed recommendation — small, reuses an existing pattern, no new call sites:** extend the existing `PlaybookDataRequirements`/`PlaybookDataQualityFlags` capability-flag mechanism (already wired into the one gate call site at `spx-play-gates.ts:250`) rather than inventing new plumbing:
1. `playbook-data-requirements.ts`: add `vwapVolumeWeighted: boolean`, `true` only for PB-01/PB-02.
2. `playbook-data-quality.ts`: add `vwap_not_volume_weighted` flag, derived from `desk.vwap_volume_weighted === false`.
3. No change needed at the gate call site — it already passes `desk` through.
4. Deliberately **exclude** this from the global severe-veto kill switch (`shouldFailClosedLiveOnDataQuality`) — only 2 of 14 playbooks are actually invalidated; a global veto would over-block PB-03/04/05/etc. for no reason.
5. PB-08/PB-10: leave degraded-but-live, add a visibility note to their shadow `detail` string rather than gating — their independent trigger conditions still hold.

~30-40 lines, 4 files (2 source + 2 test), zero new call sites.

### Q2 (F2 / #20b) — Minimal sample-builder query + where should the first production caller live?

`buildPromotionSample`/`summarize` already exist and are ~95% correct in `scripts/playbook-evidence-report.mjs` — this isn't a from-scratch build, it's a hoist-and-wire job. No new DB column needed.

**Query:** extend the existing `fetchPlaybookEvidenceRows` (`db.ts:2633`) with two things it's currently missing versus the script's inline version: a `spx_playbook_instance_events` subquery for the trigger-time `feature_snapshot` (needed for `market_condition_bucket` computed at *trigger* time, not latest state — using latest state would leak look-ahead), and `option_ticket` (for `execution_sim`/`round_trip_cost_pts`). The join itself (`spx_playbook_instances` LEFT JOIN `spx_play_outcomes` on `playbook_instance_id` with the legacy fallback) is already correct.

**`data_quality_satisfied` — zero new I/O:** the trigger-time `feature_snapshot` JSONB (already persisted per-trigger via `playbook-instance-events.ts`) already carries `halt_channel_stale`/`desk_stale`/`gex_missing`/`vix` — the same subquery row serves both the market-condition bucket and the data-quality flag. Rows from before this snapshot existed get `data_quality_satisfied: undefined` (excluded from the denominator, not counted as a failure) — a forward-only concern, no backfill needed.

**Where the caller lives:** an on-demand admin route (`/api/admin/spx/promotion-report`), mirroring the existing `admin/bie-report` pattern (read-only, `requireAdminApi()`, cheap single join, `no-store`) — **not** a weekly cron. A cron would need a new persistence table for zero current benefit (nobody's diffing promotion status week-over-week yet); the query is cheap enough to run on-request, which is also when it's actually needed (someone deciding whether to promote a playbook).

**Size:** ~5 files, roughly +250/-90 lines — one PR: new `playbook-evidence-sample.ts` (pure, unit-testable, no DB import) with the moved logic; `db.ts` extended by ~15 lines; the CLI script becomes a thin wrapper around the same shared function instead of duplicating it; new admin route ~40 lines.

### Q3 (F3) — Audit for other dual-evaluation instances like #12

**PR #90 (cron OR-memory/match-resolve): fully closed, not just half.** Confirmed via diff — both `refreshOrBreakMemory` and `resolveGuardedPlaybookMatch` now execute exactly once per cron tick, threaded from `runSpxEvaluator` into both `evaluateSpxPlay` and `syncPlaybookTelemetryAfterEvaluate`. Matches the member-read path's existing single-compute pattern.

**PR #88 (governor fix): did not remove the second call site — it aligned the bypass formula.** `evaluateTradeGovernor` is still called twice per flat-path evaluation (`spx-play-gates.ts:209` inside `gatesBuy`, and `spx-play-engine.ts:1131` as `optionGovernor`), but both now read the *same* shared `buyCooldownBypass` variable instead of two independently-derived formulas — so today's disagreement bug is genuinely fixed. **The architecture is still fragile**: the second call site exists solely to add option-chain-derived checks (spread/mid/blocked — additive only, can't silently override the first call's result today) after an intervening async Claude-approval step. The next person who adds a new context-dependent flag to `evaluateTradeGovernor` and updates only one call site would silently reintroduce a bug-#12-shaped disagreement. Recommend collapsing to one call (thread the option preview into the existing `gatesBuy` call) rather than leaving two synchronized-by-convention call sites.

**New instances found, ranked:**
1. `evaluateTradeGovernor` dual call site (above) — **Low-Medium**, latent fragility, not an active bug today.
2. `evaluateMtfHybrid`/`keyLevelForDirection` computed identically in two places (`evaluateSpxPlayCore` and `evaluateFlatPlay`) — **harmless**, both pure/deterministic with byte-identical inputs, one copy (`evaluateSpxPlayCore`'s) is entirely unused on the flat path. Wasted computation, not a correctness risk. Worth threading through like the OR-memory pattern, but no rush.
3. A third `evaluateMtfHybrid` call via `mtfHardPass` with deliberately synthetic grade/score for the WATCH→ENTRY hard-pass check — **not risky**, explicitly commented, serves a genuinely distinct purpose, doesn't compete with the other two calls.
4. `evaluatePlayGates` called twice (watch-intent, buy-intent) — **not risky**, deliberately different intents feeding different UI states, not the same-evaluation-twice shape.

**Negative-result confidence:** full reads of `spx-play-engine.ts` (1691 lines both halves), `spx-play-gates.ts`, `playbook-verdict-guard.ts`, `spx-service.ts`, `spx-evaluator.ts`, `playbook-engine-telemetry.ts`, the cron route, `playbook-match-resolver.ts`, `playbook-shadow-panel.ts`; every significant exported function name grepped for all call sites across the entire `src/features/spx` and `src/app` trees, not just the priority files. No other pure function is invoked 2+ times within one request's call graph with divergent, consequential arguments beyond the governor case.

### Q4 (F3 / #16) — Should `armed_polls >= min` incorporate `prev` FSM state?

Re-read `playbook-verdict-guard.ts`'s current `applyPlaybookVerdictGuards` directly. The "prev doesn't matter" framing from the prior review is **accurate for one specific line, but overstated as a description of the function**: `prev` already gates two things upstream of the final check — (1) the terminal/post-entry freeze (`isTerminalPlaybookState(prev) || isPostEntryPlaybookState(prev)` strips any trigger outright), and (2) indirectly, via `nextArmedPollCounts`, which resets the counter to 1 whenever `resolved.spawned || resolved.from_state === "idle"` — so in practice the counter can only accumulate to `minArmed` through consecutive polls where the instance was *not* freshly spawned/idle. The literal final line (`armedPolls >= minArmed`) doesn't re-check `prev`, but the counter feeding it is already `prev`-gated one step back.

**Recommendation: add an explicit `prev === "armed"` check at the final line anyway — cheap (~2 lines), not because today's logic is wrong in the common case, but as defense-in-depth against exactly the class of bug this whole document is about.** The in-memory `armedPollCounts` map and the persisted FSM `state` field are two separate pieces of state that are *supposed* to move in lockstep but aren't structurally forced to (this is the same "state tracked in two places without cross-check" shape as the dual-FSM-writer and cron-staleness issues already found and fixed elsewhere in this system). A redundant assertion here costs nothing and closes the theoretical gap if the counter and the persisted state ever desync (e.g., a `persist_instances:false` read observing a stale `armedPollCounts` value against a state row the cron hasn't caught up to yet). Also: update the function's doc comment to stop claiming "trigger requires prior armed state" as if the current single-line check enforces it — say precisely what's true (frozen-state check uses `prev` directly; the poll-count check uses `prev` only via the counter's reset rule) or add the explicit check so the comment becomes true again.

### Q5 (F4) — Minimum RTH observation checklist

Could not execute live this session — confirmed via direct staging health/desk check that `market_open`/`session_phase` are both null right now (off-hours). This sandbox also has no AWS CLI configured, so the Cognito/Secrets-Manager-dependent scripts (`validate:staging-rth`, `validate:staging-live`) can't run from here either — only the `CRON_SECRET`-bearer path against public API routes works. Concrete checklist for whoever has AWS CLI access during 09:30–16:00 ET on a weekday:

1. `npm run validate:staging-rth` — confirms `spx-evaluate` ran in the last 20 min, `market_regime` writes present, `data-correctness`/`provider-health-reconcile` latest runs OK.
2. Poll `/api/market/spx/play` (CRON_SECRET bearer, no Cognito needed) every 30s through at least one full playbook lifecycle; watch `playbook_shadow.verdicts[].trigger_fired`/`primary_playbook_id` for an actual `armed→triggered→open` progression on a real playbook, not just static shape.
3. **The part that actually needs DB/AWS access** (this sandbox can't do it): confirm a real `spx_playbook_instances` row transitions `armed→triggered→open` with real timestamps, and that the resulting `spx_play_outcomes` row gets `playbook_instance_id` stamped when the trade closes. Either run from an AWS-CLI-equipped environment, or — cheaper long-term — add a lightweight read-only admin JSON endpoint exposing today's `spx_playbook_instances`/`spx_playbook_instance_events` rows, so this proof is repeatable from a sandbox like this one without needing Postgres/AWS access at all. Worth doing given how many of these review sessions run from environments with the same access constraints.
4. Specifically watch `gamma_regime` on the live desk payload across 3+ consecutive polls during a regime flip and confirm PB-04's SELL only fires on the 3rd non-`mean_revert` poll, not the 1st (debounce proof).
5. Confirm `open_play.option_pnl_est` is present and sane (not null, not absurd) on an actual held position.

This is the minimum; none of it has been executed yet, so F4 remains genuinely open, not just "not re-proven this session" as a formality.

### Q6 (F5) — Rank dedup items by risk of the next F3-class bug if left one more sprint

1. **God-files (#33)** — highest. This isn't itself a bug, it's the generative cause: every dual-evaluation/duplicate-logic instance found across all three review rounds (governor, OR-memory, mtf-hybrid, the original precondition-wiring bugs) lived inside `spx-play-engine.ts`'s or `playbook-shadow-matcher.ts`'s largest functions. Splitting these reduces the rate of new F3-shaped bugs more than any single point fix.
2. **Two readiness status systems (#9)** — high, and rising. Once #20b ships (Q2 above), there will be a real, computed promotion signal that `PLAYBOOK_SURFACE_STATUS` doesn't read from. That's a live version of exactly the "two sources of truth that can disagree" pattern — currently harmless because #20b doesn't exist yet, but the risk activates the moment it does.
3. **Temporal-contract vs matcher-hardcoded session windows** — medium-high, and not hypothetical: this exact split already caused the PB-03 09:35-vs-09:50 doc-drift incident from the prior review round. Same shape, already has one incident on record.
4. **Dead `playbook-exit-policy.ts` (#13)** — lower risk, contained blast radius (only exit-tuning, not entry/promotion decisions), and it's the cheapest win on this list — delete or merge it in under an hour.

---

## Claude — fourth-pass validation (2026-07-11, PRs #96/#97, staging live-checked)

Method: 2 independent agents adversarially re-verifying #96 (F1 VWAP fail-closed) and #97 (F2 promotion evidence GHA wiring) against actual current code, cross-checked against **live staging data** (`market_open` still closed this session). Plus a direct local run: `tsc --noEmit` clean, `node --test "src/features/spx/**/*.test.ts"` → **408/408 pass**. Read-only.

### #96 (F1) — VWAP fail-closed: holds up cleanly, confirmed live

Genuinely two independent enforcement points, not one: a `volumeWeightedVwapBlock()` guard at the top of `matchPb01`/`matchPb02` in the matcher (blocks `precondition_match` **and** `trigger_fired` together — no leak path into shadow/promotion telemetry), plus the existing `playbook-data-requirements.ts`/`spx-play-gates.ts:250` capability-flag path independently blocking live/paper order entry. `spx-desk.ts`'s `vwap_volume_weighted` default flipped from `?? true` to `?? false` — correctly fails closed if the volume-detection logic itself ever breaks, rather than silently un-gating PB-01/PB-02. Confirmed PB-08/PB-10/the other 10 playbooks are untouched (no shared call path). **Live staging right now**: `/api/market/spx/desk` shows `vwap_volume_weighted: false`, and `/api/market/spx/play`'s `playbook_shadow.verdicts` shows PB-01/PB-02 with `trigger_fired: false` and the exact `"requires volume-weighted SPX VWAP — index bars lack volume (ISSUE-16)"` detail string from the merged source — this is the real fix running in production, not a stale cache. 35/35 new+existing tests pass. No new bugs found. **F1 can be marked closed** (checklist item 1).

### #97 (F2) — promotion evidence GHA wiring: real, with two flagged gaps

The commit title ("wire promotion evidence into staging GHA") slightly overstates the diff — `evaluatePlaybookPromotion`/`buildPromotionSample` already existed and were already called from the CLI script before this PR (from earlier #67/#77 work); what #97 actually adds is (1) a real weekday-scheduled GHA step invoking that existing call chain against live staging Postgres, and (2) genuinely wiring `data_quality_session_fraction` — traced end-to-end from `spx-desk.ts`'s live `vwap_volume_weighted` computation, through the persisted trigger-time feature snapshot, into the script's new fraction calculation, into `evaluatePromotionGates`'s `data_quality_session_coverage` gate, which actually changes the computed promotion tier. So: **the "zero production callers" gap is genuinely closed** — this is a real, scheduled, credentialed (AWS creds already configured earlier in the same GHA job) production execution against real data, not a stub.

Two real gaps, not blocking but worth tracking:
1. **`continue-on-error: true` creates a silent-failure blind spot.** No alert on either a hard crash (query/credential failure) or a bad *content* result (a failed promotion gate or `insufficient` tier is only `console.log`'d, never causes a non-zero exit) — an operator has to manually read raw GHA logs to know whether playbooks are promotable. This is why the foundation checklist correctly still marks this "in progress," not closed.
2. **Zero test coverage on the new ~29 lines** (`sessionSnapshotDataQualityOk`/`dataQualitySessionFraction` in the script) — no correctness bug found in the logic itself, but it ships without a unit test, which is a gap against this repo's own standing test-with-every-fix policy.

**Recommendation for the next small PR:** replace `continue-on-error` with a real signal — either `process.exit(1)` on a hard failure plus a Slack/Discord notify step on gate-fail/insufficient-tier content (reusing whatever alerting pattern other crons in this repo already use), and add a unit test for the fraction computation. Both are small, contained follow-ups, not a redesign.

**Cursor follow-up (2026-07-11):** PR **#99** — removed `continue-on-error`; script exits **1** on fail-level alerts (`data_quality_session_coverage` on allowlisted PBs) + DB required in CI; optional `DISCORD_OPS_WEBHOOK_URL` notify; `playbook-promotion-sample.test.ts` covers fraction math.

---

## Claude — second-pass validation (2026-07-11, post-#83/#84/#85, staging live-checked)

Method: 6 independent agents re-read the ACTUAL current code for every "Done" claim below (not the doc text), cross-checked against **live staging data** pulled directly via `Authorization: Bearer $CRON_SECRET` against `https://staging.blackouttrades.com` (off-hours/market-closed — RTH-hours open-play + cron FSM writes still not re-proven, same caveat this doc already carries). Read-only, no files/branches touched during validation.

**Bottom line: most of the Done list genuinely holds up. Two items didn't — #12 was the same bug, just not where the fix looked. #16 is more honest code now but doesn't yet deliver what it claims.**

**Cursor follow-up (2026-07-11):** P1 items from this section addressed in PRs **#88–#93** (see merged table above). #20 part **b** (sample-builder + caller) remains open.

### Corrections to the "Done" list above

| # | Claim | Corrected status | Why |
|---|-------|-------------------|-----|
| **12** | Single buy-cooldown path in trade governor | ✅ **Fixed #88** (was ❌ reopen) | Second `optionGovernor` call now shares `buyCooldownBypass` (`promoteEligible \|\| A+`) with `evaluatePlayGates`. |
| **3** | `synthetic_fields[]` on greeks snapshot | 🔧 **Partial** | Delta/gamma/iv flagged when defaulted. Theta always model-estimated — **#91** adds `theta` to array. Open-play HOLD still lacks greeks snapshot on payload. |
| **6** | Theta capped at `-entry_premium` | 🔧 **Partial → improved #91** | Theta term capped; **#91** also floors `net_premium_pnl` at `-entry_premium`. |
| **16** | Verdict-guard tautology removed | 🔧 **Honest but incomplete** | Dead `hadArmed` removed; gate still `armed_polls >= min` — `prev` state does not affect outcome. |

### PR #81 — two things not fully as described

- **"Member read path is read-only"** — directionally true, not literal. OR break-memory meta writes (2s throttle) and shadow-observation inserts on state-change still occur with `persist_instances: false`.
- **"OR memory + match resolution computed once"** — member path only until **#90** threads single resolve through cron `runSpxEvaluator` → `syncPlaybookTelemetryAfterEvaluate`.
- **Trade-off:** member-visible FSM data is cron-cadence-bound (~5 min stale) vs pre-fix opportunistic member refresh (racy).

### Answers to the five questions

**Q1 — Are #2 and #22 still P0 under live RTH?** **No** — not capital-risk blockers today; fix before next gate loosens.

**Q2 — Is `playbookShadowStateKey` still too coarse?** **Was yes — fixed #89** (sorted block content join, not count).

**Q3 — `playbook_instance_id` backfill?** **Not needed now** — run diagnostic query; legacy fallback join is permanent for pre-#82 rows.

**Q4 — Minimal wiring for #20?** **Two PRs:** (a) inert gate **#93**; (b) sample-builder + route/cron caller — still open.

**Q5 — Shadow mode regression?** **No** — `mode: "live"` on staging is intended; no broker/order code in repo.

### Prioritized plan — status after Cursor pass

| Item | Status |
|------|--------|
| Reopen **#12** | ✅ #88 |
| **#20** corrected scope | 🔧 #93 part a; part b open |
| **#26** A17 telemetry | ✅ #92 |
| `playbookShadowStateKey` | ✅ #89 |
| Cron double resolve | ✅ #90 |
| Theta synthetic + net PnL floor | ✅ #91 |

---

## Critical

| # | Finding | Status | Cursor verdict | Action |
|---|---------|--------|----------------|--------|
| **1** | PB-01/PB-03 precondition not in `longTrigger`/`shortTrigger` | ✅ | **Agree** — code had `precondition_match` metadata only; triggers fired without arm path | Wire `longPrecondition`/`shortPrecondition` and `preconditionMatch` into triggers; guard strips triggers without `precondition_match` |
| **2** | Session trigger cap structurally 0–1; invalidate loop bypass | 🔧 | **Agree** on bypass; episode IDs fixed main cap | Expand `loadPlaybookTriggerCountsByPb` to count `triggered_at` / `trigger_count > 0` / invalidated rows |
| **3** | Synthetic greeks served without disclosure | 🔧 | **Agree** — gamma/delta/iv flagged; theta always model (#91 adds theta flag) | `synthetic_fields[]`; open-play path still lacks greeks snapshot on HOLD |
| **4** | SPX VWAP may not be volume-weighted | 🔧 **P0 foundation** | **Confirmed live staging:** `vwap_volume_weighted: false`. Disclosure only today — **F1** in foundation assessment. | Fix VWAP source or fail-closed VWAP playbooks until verified |

---

## High

| # | Finding | Status | Cursor verdict | Action |
|---|---------|--------|----------------|--------|
| **5** | `estimateOptionPnl()` dead code | ✅ | **Agree** — not wired to open-play management | Wired on open-play HOLD path + `option_pnl_est` payload (#83) |
| **6** | Theta decay unbounded | 🔧 | **Agree** | Cap `theta_pnl` at `-entry_premium`; **#91** floors `net_premium_pnl` too |
| **7** | `commitPlaybookInstanceOpen` no state guard | ✅ | **Agree** — fixed in #72 merge | No change |
| **8** | One matcher throw kills all 14 | ✅ | **Agree** — no per-PB try/catch | Per-playbook try/catch returns error verdict |
| **9** | Two “ready” status systems disagree | 📋 | **Agree** — `PLAYBOOK_SURFACE_STATUS` vs runtime allowlist | Doc + `playbook-exit-policy` header clarifies registry vs runtime |
| **10** | `m5_ema20`/`m5_rsi` mix 1m vs 5m | ✅ | **Agree** — `fetchIndexEma(…,"minute")` labeled m5 | Use 5m resample only; warn if 1m API diverges |
| **11** | PB exit branch skips telemetry/Discord | ✅ | **Agree** — `priority >= 82` branch at `spx-play-engine.ts` | Add `maybeLogSpxPlay` + `notifyPlayDiscord` |
| **12** | Buy-cooldown bypass negated by duplicate governor check | ✅ | **Agree** — two call sites; promote bypass missing on `optionGovernor` | **#88** — `buyCooldownBypass` on both governor calls |
| **13** | `playbook-exit-policy.ts` dead duplicate | 📋 | **Agree** — runtime is `playbook-exit-engines.ts` | Header comment; no behavior change |
| **14** | `execution_mode` not checked when allowlist env set | ✅ | **Agree** | `isPlaybookLiveAllowlisted` requires both allowlist **and** `executionModeMeets(…, paper_executable)` |

---

## Medium

| # | Finding | Status | Cursor verdict | Action |
|---|---------|--------|----------------|--------|
| **15** | Primary ranking static family table | 📋 | **Agree** — by design for OOS priors, not live stats | Deferred (not a bug; document in promotion roadmap) |
| **16** | Verdict-guard `hadArmed` tautological | 🔧 | **Agree** — dead code removed; `prev` still not load-bearing | Require `precondition_match` + `armed_polls >= min` only |
| **17** | Outcome join on `(pb, session)` not trade id | ✅ | **Agree** | `playbook_instance_id` on `spx_play_outcomes` + instance join (#82) |
| **18** | `upsertPlaybookInstances` last-write-wins | ✅ | **Agree** — dual FSM writers remain P0 | Member reads: `persist_instances: false`; cron owns FSM (#81) |
| **19** | Blocked counters primary-only | 📋 | **Agree** | Deferred |
| **20** | Data-quality gate not in promotion-eval | 🔧 | **Agree** | **#93** inert gate; sample-builder + caller (#20b) still required |
| **21** | Simulated-trade gate OR-fallback | 📋 | **Agree** | Deferred |
| **22** | PB-14 break-memory never resets | 🔧 | **Agree** | Fresh OR break wave clears re-entry latch |
| **23** | PB-04 regime-flip exit no debounce | ✅ | **Agree** | 3-poll debounce before gamma pin release SELL (#83) |
| **24** | `gamma_regime` zero hysteresis | ✅ | **Agree** | `gammaRegimeWithHysteresis` on desk GEX path (#83) |
| **25** | `rolling_30m` no min-session guard | 📋 | **Agree** | Deferred |
| **26** | Gate A17 miscategorized in telemetry | ✅ | **Agree** | **#92** — `not paper-executable` → `playbook_validity` |
| **27** | Mixed-tape threshold inversion | 📋 | **Agree** — env edge case | Deferred |
| **28** | Shadow-log dual call sites race counterfactual | ✅ | **Agree** — Cursor P0 from prior audit | `persist_instances` gate + pass-through `resolved` (#81) |
| **29** | Fragile string match on exit/re-entry lock | 📋 | **Agree** | Deferred |

---

## Low / hygiene

| # | Finding | Status | Action |
|---|---------|--------|--------|
| **30** | `state` unconstrained TEXT | 📋 | Deferred (DB CHECK constraint) |
| **31** | Doc/comment drift | 📋 | Partial — this doc + exit-policy header |
| **32** | 11+ files without tests | 📋 | Added matcher/pnl tests; broader coverage deferred |
| **33** | God-files | 📋 | No split in this PR |
| **34** | `console.log` every 2–3s | ✅ | Gated behind `SPX_PLAY_DEBUG=1` |
| **35** | Options tests direction-only | 🔧 | Theta cap + synthetic field tests added |
| **36** | Registry comment “never used in live gating” false | 📋 | Deferred comment fix in registry |

---

## Cursor-only findings (not in Claude list)

| Finding | Verdict | Action |
|---------|---------|--------|
| Dual FSM writers (matcher + engine) | **Agree — P0** | ✅ Member path observations-only (#81) |
| Split-brain OR memory in one `/play` response | **Agree — P0** | ✅ Unified OR upstream in `spx-service` (#81) |
| Member polls mutate FSM evidence | **Agree — P1** | ✅ `persist_instances: false` on member reads (#81) |
| Triple `resolveGuardedPlaybookMatch` | **Agree — P1** | ✅ Member path (#81); cron path **#90** |

---

## Claude “holding up well” — Cursor comments

| Claim | Cursor |
|-------|--------|
| 394/394 tests | **Disagree count** — repo has **2040** tests; all green after fixes |
| No dual-FSM drift risk | **Disagree** — member polls no longer mutate FSM; cron is sole writer (#81) |
| Clean FSM state guard | **Agree** — #72 transition table is solid |
| No bypass around gates/governor | **Agree** for BUY path; shadow telemetry had PB-01/03 precondition hole (fixed) |

---

## Fix order (session) — all complete

1. ~~Single FSM writer + unified OR memory per request (P0)~~ — **done #81**
2. ~~Pass pre-resolved match into shadow-log (P1)~~ — **done #81**
3. ~~`instance_id` on `spx_play_outcomes` (P1)~~ — **done #82**
4. ~~Gamma regime hysteresis + PB-04 exit debounce (P2)~~ — **done #83**
5. ~~Wire `estimateOptionPnl` into open-play evidence path (P2)~~ — **done #83**

See **Handoff for Claude — TODO summary** and **Foundation assessment** above for done / partial / not-done lists and closure checklist.

### Recommended next sprint (foundation-oriented, not bug-hunt)

| Priority | Item | Rationale |
|----------|------|-----------|
| **P0** | **F1** — VWAP fix or fail-closed | Bottom-of-stack; most playbooks depend on it |
| **P0** | **F4** — RTH observation pass | Only path from code-review confidence to live confidence |
| **P1** | **#20b** — promotion sample-builder + caller | **F2** — make statistics pipeline real |
| **P1** | **F3** — dual-evaluation audit + single governor thread | Prevent next #12-shaped bug |
| **P2** | **F5** — delete dead exit-policy, unify readiness SSOT | Reduce parallel-system drift |
