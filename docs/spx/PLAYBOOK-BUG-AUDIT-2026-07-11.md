# SPX Playbook — Consolidated Bug Audit (Rounds 1–2 + Cursor)

**Date:** 2026-07-11 (session close-out updated 2026-07-11T02:50Z)  
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

**Staging deploy:** ECR push + ECS rollout succeeded for #80–#83. Running image ≈ `5470b1a7` (#83).  
**Validation (2026-07-11 off-hours):** `validate:staging` GREEN, `validate:staging-playbook` PASS. RTH open-play / cron FSM not re-proven in this window.

This document merges Claude’s two review rounds with Cursor’s CTO deep-dive. Each item: **status**, **agree/disagree**, **action**.

Legend: ✅ fixed in PR · 🔧 partial · 📋 documented/deferred · ❌ disagree with severity/claim

---

## Handoff for Claude — TODO summary

Use this section first. Full item tables below retain per-finding detail.

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
- [x] **#12** Single buy-cooldown path in trade governor
- [x] **#14** Allowlist requires `executionModeMeets(…, paper_executable)`
- [x] **#16** Verdict-guard tautology removed — armed polls + precondition only
- [x] **#34** `console.log` gated behind `SPX_PLAY_DEBUG=1`

**Cursor-only P0/P1 (included in #81)**

- [x] Dual FSM writers, split-brain OR, member polls mutating FSM, triple resolver

**Tests:** 2043 pass · `tsc` clean (post-#83)

---

### 🔧 Partial (agreed — improved but not complete)

| # | Item | What shipped | What remains |
|---|------|--------------|--------------|
| **2** | Session trigger cap 0–1 / invalidate bypass | `loadPlaybookTriggerCountsByPb` expanded | Full episode-level cap audit under concurrent invalidate loops |
| **4** | VWAP volume-weighted honesty | `vwap_volume_weighted` flag on desk | Live magnitude verification vs UW/index bars |
| **22** | PB-14 OR break-memory reset | Fresh break wave clears re-entry latch | Long-session soak / edge cases around multi-wave days |
| **31** | Doc/comment drift | This doc + exit-policy header | Registry comment (#36), architecture SSOT sync |
| **35** | Options tests direction-only | Theta cap + synthetic field tests | Full open-play management integration tests |

---

### 📋 Not done (agreed deferred — Claude review candidates)

Prioritized for a follow-up pass. **Not blocking staging deploy.**

| Priority | # | Item | Why deferred | Suggested next step |
|----------|---|------|--------------|---------------------|
| P1 | **20** | Data-quality gate not in promotion-eval | Scope — promotion pipeline separate from matcher fixes | Wire `evaluatePlaybookDataSatisfaction` into promotion-eval path |
| P1 | **26** | Gate A17 miscategorized in telemetry | Telemetry taxonomy | Map A17 to correct `playbook-gate-categories` bucket |
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

**Not validated this session (operational, not code gaps):**

- Staging **browser** E2E with Cognito auth (dashboard redirects to hosted UI; API validation passed)
- **RTH** proof of cron FSM writes + open-play `playbook_instance_id` backfill on real trades
- **Prod** — all work merged to `blackout-web-sandbox` only; not merged to `blackout-web` `main`

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

---

### Questions for Claude (second-pass review)

1. Are **partial** items #2 and #22 still P0 under live RTH, or acceptable for paper-executable staging?
2. Is **`playbookShadowStateKey`** still too coarse (gate fingerprint = block count only)? Should it hash block categories?
3. Does **`playbook_instance_id`** backfill strategy need a one-time migration for same-session legacy outcomes?
4. Promotion-eval **#20** — what is the minimal gate wiring to unblock paper→live promotion on staging?
5. Any regressions in **dual-path** shadow mode (`playbook_shadow.mode === "live"` on staging vs `"shadow"` locally)?

---

## Critical

| # | Finding | Status | Cursor verdict | Action |
|---|---------|--------|----------------|--------|
| **1** | PB-01/PB-03 precondition not in `longTrigger`/`shortTrigger` | ✅ | **Agree** — code had `precondition_match` metadata only; triggers fired without arm path | Wire `longPrecondition`/`shortPrecondition` and `preconditionMatch` into triggers; guard strips triggers without `precondition_match` |
| **2** | Session trigger cap structurally 0–1; invalidate loop bypass | 🔧 | **Agree** on bypass; episode IDs fixed main cap | Expand `loadPlaybookTriggerCountsByPb` to count `triggered_at` / `trigger_count > 0` / invalidated rows |
| **3** | Synthetic greeks served without disclosure | ✅ | **Agree** — `buildGreeksSnapshot` defaulted gamma 0.02 | Add `synthetic_fields[]` on greeks snapshot |
| **4** | SPX VWAP may not be volume-weighted | 🔧 | **Agree** on code path (`spx-session.ts` ISSUE-16); live magnitude unverified | Add `vwap_volume_weighted` on desk payload when index bars lack volume |

---

## High

| # | Finding | Status | Cursor verdict | Action |
|---|---------|--------|----------------|--------|
| **5** | `estimateOptionPnl()` dead code | ✅ | **Agree** — not wired to open-play management | Wired on open-play HOLD path + `option_pnl_est` payload (#83) |
| **6** | Theta decay unbounded | ✅ | **Agree** | Cap `theta_pnl` at `-entry_premium` |
| **7** | `commitPlaybookInstanceOpen` no state guard | ✅ | **Agree** — fixed in #72 merge | No change |
| **8** | One matcher throw kills all 14 | ✅ | **Agree** — no per-PB try/catch | Per-playbook try/catch returns error verdict |
| **9** | Two “ready” status systems disagree | 📋 | **Agree** — `PLAYBOOK_SURFACE_STATUS` vs runtime allowlist | Doc + `playbook-exit-policy` header clarifies registry vs runtime |
| **10** | `m5_ema20`/`m5_rsi` mix 1m vs 5m | ✅ | **Agree** — `fetchIndexEma(…,"minute")` labeled m5 | Use 5m resample only; warn if 1m API diverges |
| **11** | PB exit branch skips telemetry/Discord | ✅ | **Agree** — `priority >= 82` branch at `spx-play-engine.ts` | Add `maybeLogSpxPlay` + `notifyPlayDiscord` |
| **12** | Buy-cooldown bypass negated by duplicate governor check | ✅ | **Agree** — two cooldown blocks in `trade-governor.ts` | Single cooldown branch; sell-after-exit takes precedence |
| **13** | `playbook-exit-policy.ts` dead duplicate | 📋 | **Agree** — runtime is `playbook-exit-engines.ts` | Header comment; no behavior change |
| **14** | `execution_mode` not checked when allowlist env set | ✅ | **Agree** | `isPlaybookLiveAllowlisted` requires both allowlist **and** `executionModeMeets(…, paper_executable)` |

---

## Medium

| # | Finding | Status | Cursor verdict | Action |
|---|---------|--------|----------------|--------|
| **15** | Primary ranking static family table | 📋 | **Agree** — by design for OOS priors, not live stats | Deferred (not a bug; document in promotion roadmap) |
| **16** | Verdict-guard `hadArmed` tautological | ✅ | **Agree** — `prev===triggered` bypassed poll count | Require `precondition_match` + `armed_polls >= min` only |
| **17** | Outcome join on `(pb, session)` not trade id | ✅ | **Agree** | `playbook_instance_id` on `spx_play_outcomes` + instance join (#82) |
| **18** | `upsertPlaybookInstances` last-write-wins | ✅ | **Agree** — dual FSM writers remain P0 | Member reads: `persist_instances: false`; cron owns FSM (#81) |
| **19** | Blocked counters primary-only | 📋 | **Agree** | Deferred |
| **20** | Data-quality gate not in promotion-eval | 📋 | **Agree** | Deferred |
| **21** | Simulated-trade gate OR-fallback | 📋 | **Agree** | Deferred |
| **22** | PB-14 break-memory never resets | 🔧 | **Agree** | Fresh OR break wave clears re-entry latch |
| **23** | PB-04 regime-flip exit no debounce | ✅ | **Agree** | 3-poll debounce before gamma pin release SELL (#83) |
| **24** | `gamma_regime` zero hysteresis | ✅ | **Agree** | `gammaRegimeWithHysteresis` on desk GEX path (#83) |
| **25** | `rolling_30m` no min-session guard | 📋 | **Agree** | Deferred |
| **26** | Gate A17 miscategorized in telemetry | 📋 | **Agree** | Deferred |
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
| Triple `resolveGuardedPlaybookMatch` | **Agree — P1** | ✅ Single resolve + pass-through `resolved` (#81) |

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

See **Handoff for Claude — TODO summary** above for the full done / partial / not-done lists.
