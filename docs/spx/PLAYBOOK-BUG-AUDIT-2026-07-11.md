# SPX Playbook — Consolidated Bug Audit (Rounds 1–2 + Cursor)

**Date:** 2026-07-11  
**Repos:** `blackout-web-sandbox` (staging)  
**PR:** `cursor/playbook-bugfix-stack-261c` → `blackout-web-sandbox`

This document merges Claude’s two review rounds with Cursor’s CTO deep-dive. Each item: **status**, **agree/disagree**, **action**.

Legend: ✅ fixed in PR · 🔧 partial · 📋 documented/deferred · ❌ disagree with severity/claim

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
| **5** | `estimateOptionPnl()` dead code | 📋 | **Agree** — not wired to open-play management | Deferred; theta cap added for when wired |
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
| **17** | Outcome join on `(pb, session)` not trade id | 🔧 | **Agree** | Evidence report join adds `direction`; full `instance_id` join needs schema |
| **18** | `upsertPlaybookInstances` last-write-wins | 📋 | **Agree** — dual FSM writers remain P0 | **Deferred to follow-up PR** (single-writer) |
| **19** | Blocked counters primary-only | 📋 | **Agree** | Deferred |
| **20** | Data-quality gate not in promotion-eval | 📋 | **Agree** | Deferred |
| **21** | Simulated-trade gate OR-fallback | 📋 | **Agree** | Deferred |
| **22** | PB-14 break-memory never resets | 🔧 | **Agree** | Fresh OR break wave clears re-entry latch |
| **23** | PB-04 regime-flip exit no debounce | 📋 | **Agree** | Deferred (gamma hysteresis) |
| **24** | `gamma_regime` zero hysteresis | 📋 | **Agree** | Deferred |
| **25** | `rolling_30m` no min-session guard | 📋 | **Agree** | Deferred |
| **26** | Gate A17 miscategorized in telemetry | 📋 | **Agree** | Deferred |
| **27** | Mixed-tape threshold inversion | 📋 | **Agree** — env edge case | Deferred |
| **28** | Shadow-log dual call sites race counterfactual | 📋 | **Agree** — Cursor P0 from prior audit | Deferred (pass-through match + cron-only FSM) |
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
| Dual FSM writers (matcher + engine) | **Agree — P0** | Deferred follow-up |
| Split-brain OR memory in one `/play` response | **Agree — P0** | Deferred follow-up |
| Member polls mutate FSM evidence | **Agree — P1** | Deferred follow-up |
| Triple `resolveGuardedPlaybookMatch` | **Agree — P1** | Deferred follow-up |

---

## Claude “holding up well” — Cursor comments

| Claim | Cursor |
|-------|--------|
| 394/394 tests | **Disagree count** — repo has **2040** tests; all green after fixes |
| No dual-FSM drift risk | **Disagree** — dual writers still exist; state guard helps post-entry only |
| Clean FSM state guard | **Agree** — #72 transition table is solid |
| No bypass around gates/governor | **Agree** for BUY path; shadow telemetry had PB-01/03 precondition hole (fixed) |

---

## Fix order (remaining)

1. Single FSM writer + unified OR memory per request (P0)
2. Pass pre-resolved match into shadow-log (P1)
3. `instance_id` on `spx_play_outcomes` (P1)
4. Gamma regime hysteresis + PB-04 exit debounce (P2)
5. Wire `estimateOptionPnl` into open-play evidence path (P2)
