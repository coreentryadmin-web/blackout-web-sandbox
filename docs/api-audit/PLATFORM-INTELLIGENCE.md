# BlackOut Platform Intelligence
**Last updated:** 2026-06-28 05:41 ET
**Reports analyzed (last 26h):** 16 — cto-audit, 5× deep-audit, pentest, https-monitor, connectivity-matrix, night-hawk, whop, OPEN-ISSUES, error-log
**Today's findings:** 21 (8 P1 · 1 P0-class systemic · 8 P2 · 2 P3 · 2 WARN) — **6 recurring · 15 new**
**Platform trend:** **STABLE / HEALTHY** (user-facing) — audit *coverage* deepening, not platform degrading
**History:** 31 findings on record (day 1) → 52 after today (day 2 of learning)

> **One-line read:** The live platform is healthy — 0 open P0, all pages 200, all data routes correctly 401, no 5xx, no error logs, connectivity STRONG. Every material finding this cycle clusters into **two root causes**: (1) an **auth boundary with no default-deny** keeps leaking a new endpoint each audit, and (2) **code that was built but never wired to a running writer**, leaving durable tables empty against the live-data mandate.

---

## THE TWO ROOT CAUSES (fix these, ~15 findings collapse)

### ROOT CAUSE #1 — Auth enforced by convention, no default-deny → a new leak every audit
This is the single most important pattern on the platform. There is **no structural guarantee** that an API route is authorized — each route self-guards, and nothing fails the build when one forgets. The result is a steady drip: **every audit cycle discovers a *different* unguarded route.**

Two manifestations of the *same* missing guarantee:

**(a) Unauthenticated premium GET endpoints — now 5 found:**
| Route | Leaks | Found |
|---|---|---|
| `/api/market/anomalies`, `/api/market/regime` | market regime / flow anomalies | 06-27 (now annotated-public) |
| `/api/signals/open` | paid signals: grade/ticker/strike/expiry/entry_mark/confluence | 06-28 |
| `/api/brief/premarket` | SPX price, call/put wall, king strike, net GEX, bias | 06-28 (pentest) |
| `/api/platform/intel` | **live JSON body** — regime, anomalies, coaching, win-rates by source | 06-28 (pentest) |

**(b) Fail-open cron-write guards — now 4 instances:** `if (cronSecret && auth !== Bearer)` accepts unauthenticated POST when `CRON_SECRET` is unset (and is non-constant-time): `coaching/alerts` (P0, CTO), `market/anomalies`, `market/regime`, `track-record/publish:9`. Latent today (secret is set in prod) but one missing env var = an open public write endpoint.

**THE FIX (one PR closes the whole class):** add a CI/build grep-test asserting every `src/app/api/**/route.ts` calls one of `{requireTierApi, isCronAuthorized, authorizeCronOrTierApi, resolveAdminApi/requireAdminApi}` — fail the build on an un-allowlisted miss. Then sweep the 4 known endpoints onto `authorizeCronOrTierApi(req,'premium')` / `isCronAuthorized` (fail-closed). *Until the default-deny test exists, the next audit will find leak #6.*

### ROOT CAUSE #2 — "Built but never running" → empty durable tables vs the live-data mandate
A cluster of tables have **live consumers but no live writer**, so users (or admins) see blank/degraded surfaces — a direct hit on the values-live-correct-grounded rule.

| Table / feature | State | Why empty | Consumer that degrades |
|---|---|---|---|
| `market_regime`, `flow_anomalies` | 0 rows all-time | **Writer is fully built in code** but the Railway cron *service* was never created (not in the 23-service list) | FlowAnomalyBanner (paid /flows) never renders; NH morning-confirm → regime=UNKNOWN |
| `spx_play_outcomes`, `spx_open_play` | 0 rows all-time | Engine never reached a BUY (198 SCANNING/24 WATCHING/**0 BUY** over 3 days); gates not approving, NOT the veto | SPX Slayer P&L / track-record panels empty |
| `spx_signal_log` | 0 rows (was 06-17) | No writer anywhere | Any admin/analytics reader |
| `spx_pulse_snapshots`, `spx_watch_setups` | 0 rows, no INSERT refs | Dead/legacy | none (drop them) |
| Night Hawk editions | 1 row; 4 trading days missing | #77 synthesis-zeroing (resolved 6/26, one-deep) | Launch-gated → admin-only impact |

**THE FIX:** (1) create the `market-regime-detector` Railway service via Config-as-code (no code change) and confirm first write; (2) **verify Monday 2026-06-29 RTH** that SPX plays open AND write an outcome row — if still 0 BUY after a full session, escalate P2-C→P1 and read the `63567cb` gate-diagnostic logs; (3) retire the dead tables.

---

## PLATFORM HEALTH SCORECARD
| Surface | Status | Evidence |
|---|---|---|
| Availability / TLS | ✅ PASS | 12/12 routes healthy, no 5xx, cert 78d, all <650ms |
| Security headers | ✅ PASS | HSTS preload, nosniff, CSP, Referrer/Permissions all present |
| Injection / secrets / XSS / IDOR | ✅ CLEAN | pentest: 0 reachable; `$n` params, allow-lists, no `dangerouslySetInnerHTML` |
| Auth boundary | ⚠️ **ROOT #1** | self-guard-by-convention, 5 leaks + 4 fail-open guards found |
| Cross-service connectivity | ✅ STRONG | 16–19 channels PASS, 0 FAIL; W1 converged, W2 resolved |
| Durable data correctness | ⚠️ **ROOT #2** | flagship ledger + regime/anomaly tables empty |
| Distributed-systems seams | ⚠️ latent | UW WS no leader election; reconcile serial/unlocked (masked at ~2–5 replicas) |
| WebSocket health | ⚠️ minor | options-socket shard 0 in 1006 loop (benign off-hours; verify Mon RTH) |
| Payments (Whop) | ⚠️ coverage gap | `payment.failed` + dunning lifecycle unhandled (revenue leak window) |

---

## TRADING / MONEY IMPACT (ranked)
| Impact | Severity | Findings |
|---|---|---|
| Empty flagship track record (SPX P&L blank) | 🔴 CRITICAL | spx-ledger-empty, recordPlayEntry swallow, force-close w/o outcome |
| Premium signal/brief leaked free | 🔴 CRITICAL | signals/open, brief/premarket, platform/intel unauthenticated |
| Revenue leak on failed payments | 🟠 HIGH | whop `payment.failed` unhandled → premium through full dunning window |
| Stale/degraded signals shown | 🟠 HIGH | NH edition built on Thursday data for Monday; regime=UNKNOWN; engine/health static |
| Disconnected / divergent numbers | 🟡 MEDIUM | W1 (converged, monitor), macro_indicators+earnings not scored into SPX confluence |
| Wrong *price* shown to user | 🟢 NONE | no wrong-price finding this cycle |

---

## RECURRING (root causes not yet fixed — these are where to spend effort)
| # | Issue | Days seen | Note |
|---|---|---|---|
| 1 | **Audit tooling stale probes** | 2 | #1 by frequency — re-rediscovered this cycle by deep-audit-04 + https-monitor + connectivity. The audit *instruments* are miscalibrated, wasting cycles re-finding the same tooling bug. Fix the SKILL probe paths/env names at source. |
| 2 | **Fail-open cron guards** (Root #1b) | 2 | Grew from 1→4 instances. |
| 3 | **Auth no-default-deny** (Root #1) | 2 | Grew from 2→5 leaked endpoints. |
| 4 | **SPX ledger empty** (Root #2) | 2 | WATCH Mon 2026-06-29 RTH. |
| 5 | **spx_signal_log empty** | 2 | Was 06-17-stale, now 0 rows. |
| 6 | **W1 dual GEX path** | 2 | Now structurally CONVERGED (cache-reader); downgrade to monitor-for-drift. |

---

## SYSTEMIC PATTERNS (multi-service)
- ⚠️ **Auth boundary erosion** — 5 unauth GETs + 4 fail-open POSTs across `market/`, `signals/`, `brief/`, `platform/`, `coaching/`, `track-record/`. One root: no default-deny. *(Root #1)*
- ⚠️ **Built-but-not-running** — `market_regime`, `flow_anomalies`, `spx_play_outcomes`, `spx_signal_log` all have code and 0 rows. *(Root #2)*
- ⚠️ **Off-hours WS churn masks RTH failures** — options-socket 1006 loop counter unbounded; reconnect/heartbeat not gated off-hours like the stall watchdog is. Park sockets off-hours so the failure counter means something.
- ⚠️ **Distributed-systems seams unguarded** — UW WS has no leader election (Polygon does); `reconcileAllMemberships` serial+unlocked. Both masked at current replica count; first to break on horizontal scale-out.

---

## LEARNING VELOCITY (what improved since 06-27)
**Resolved / improving — the platform IS learning:**
- ✅ **`X-Powered-By` leak FIXED** — `poweredByHeader:false` now live (was P3 06-27).
- ✅ **W2 (NW panel verdict omitted HELIX flows) RESOLVED** — `verdict.ts` now consumes `ctx.flows` on both list + detail paths.
- ✅ **W1 dual GEX path CONVERGED** — `getGexPositioning` is now a pure `fetchGexHeatmap` cache-reader.
- ✅ **anomalies/regime auth** — annotated intentionally-public (no paid data); substance folded into Root #2.
- ✅ **VAPID push armed** — alerts no longer inert.
- ✅ **https-monitor self-corrected** its own recurring CSP false-alarm (Step-3 now probes the canonical apex).
- ✅ **Confirmed-fixed re-verified live:** #97 dark-pool card, #100 pg pool handler, #101 Clerk webhook, #102 Polygon leader election, SPX veto neuter, Redis `family:0`.

**Velocity stats:** 31 findings day 1 → 6 recurred + 15 net-new day 2. ~5 findings resolved/downgraded. The audit fleet is widening (pentest + whop came online and surfaced latent auth/payment gaps) — so the rising new-finding count reflects **deeper coverage, not a degrading platform.**

---

## INTELLIGENT RECOMMENDATIONS (priority order)
1. **[ROOT #1] Add the default-deny CI test, then sweep 4 endpoints + 4 fail-open guards.** Closes ~9 findings and prevents leak #6. Highest leverage, mostly mechanical.
2. **[ROOT #2 — verify first] Monday 2026-06-29 RTH:** confirm SPX plays open + write outcome rows, and create the `market-regime-detector` Railway service. These two unblock the flagship's headline proof (track record) and the paid /flows banner. *No code needed for the regime service.*
3. **[REVENUE] Handle Whop `payment.failed` + dunning lifecycle.** Lowest-effort/highest-leverage payment gap — stops premium being served free through the entire dunning window. Reuse the existing `syncWhopMembershipForEmail` + `notifyOpsDiscord` path.
4. **[NIGHT HAWK] Make the evening cron authoritative** (force-rebuild when published `session_date` is older than the latest completed RTH) + reap orphaned `running` jobs >2h. Keep #77 open until ≥2 clean evening cycles.
5. **[TOOLING] Fix the audit SKILL probe paths/env names at source** so the fleet stops burning cycles re-finding stale-probe false positives every run.
6. **[SCALE — pre-emptive] Port Polygon's SETNX leader election to the UW socket** + advisory-lock `reconcileAllMemberships`. Not urgent at current scale; the trigger is the first horizontal scale-out.

---

## WHAT GOOD LOOKS LIKE
- ✓ Every `route.ts` provably calls an auth helper (enforced by CI, not convention)
- ✓ Zero "built-but-not-running" tables: every table with a consumer has a live writer
- ✓ SPX `spx_play_outcomes` accrues rows each RTH; track-record panel non-empty
- ✓ Night Hawk publishes a fresh edition every evening off that day's close
- ✓ Whop `payment.failed`/dunning observed in real time, not inferred from `membership.deactivated`
- ✓ Recurring-issue count → 0 (every finding is new = platform fully learning)
- ✓ All GEX/flow/price values match provider ground truth within tolerance during RTH

---
*Generated by the platform-learning-brain cron (05:30 ET). Reads every audit report from the prior 24h, finds cross-report patterns, tracks recurrence/trend, and drives the one goal: users see 100% correct real data. No secrets/keys/DB-URLs/user values printed. Source findings: `docs/api-audit/learning/history.jsonl`.*
