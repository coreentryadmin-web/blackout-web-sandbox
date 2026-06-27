# BlackOut Daily Error Triage Log

> Automated morning triage of production Railway logs. Reads yesterday's logs across all services,
> categorizes errors, auto-fixes safe high-confidence issues, and flags the rest with a diagnosis.
> Append-only — newest run at the top.

---

## 2026-06-27 (Sat) Daily Error Triage

### Summary
- **New errors found:** 4 (first log — no prior baseline)
- **Recurring errors:** 0 tracked (this is the first run; baseline established)
- **Auto-fixed:** 0 (no findings met the safe/<10-line/clearly-code-bug bar — all are env-config or judgment-call behavior changes)
- **Requires human attention:** 2 (HIGH: alerting blind spot · MEDIUM: heatmap pagination truncation)
- **False alarms identified:** 2 (nighthawk weekend staleness · GEX 0-contracts on a non-trading Saturday)

No runtime exceptions, stack traces, OOM, connection-pool exhaustion, or unhandled rejections appeared in any service log. RTH crons (flow-ingest, uw-cache-refresh, cron-staleness-watchdog) all returned **200 OK** with healthy payloads.

### New Errors (first occurrence)
| Service | Error | Count | Root Cause | Status |
|---|---|---|---|---|
| blackout-web | `[notify] DISCORD_OPS_WEBHOOK_URL not set` → `ops alert DROPPED` → `ALERT NOT DELIVERED for 1 stale/failed cron(s)` | 3 lines (1 cascade) | Neither `DISCORD_OPS_WEBHOOK_URL` nor `DISCORD_PLAY_WEBHOOK_URL` is set in prod → the watchdog detected a problem but had nowhere to deliver the alert. **Alerting is effectively blind.** | ⚠️ HUMAN — env config |
| Cron-Staleness-Watchdog | `problems=1 problem_keys=["nighthawk-playbook"]` | 1 | `nighthawk-playbook` has `stale_after_min: 240` (4h) but runs **weekdays 5:30 PM ET only**. On a Saturday-morning check (~10 AM ET) the last run was Friday 5:30 PM ET (~16h ago) → flagged stale. **Generation did NOT fail — this is a weekend/overnight false positive.** (`src/lib/cron-registry.ts:66`) | ℹ️ FALSE ALARM — see note |
| blackout-web | `[polygon-gex] fetchHeatmapBand(I:SPX) truncated: hit 16-page guard with next_url still set — chain incomplete, walls/OI/IV understated` | 1 | The I:SPX option-chain paginator stops at a 16-page guard while `next_url` is still set, so heatmap walls / OI / IV are computed from an incomplete chain and understated. Data-correctness concern. | ⚠️ HUMAN — judgment call |
| blackout-web | `[polygon-gex] 0 I:SPX contracts for 2026-06-27 @ 7354.02 via api.massive.com — GEX walls will be empty` | 1 | massive.com returned 0 I:SPX contracts for **2026-06-27 (a Saturday, non-trading day)**, so the GEX path fell back to `greek-exposure/strike` cumulative (805 strikes, succeeded). 0 contracts for a non-session date is plausibly expected weekend behavior, not necessarily a key/access fault. Low confidence. | ℹ️ LIKELY BENIGN — re-check on a weekday |

### Recurring Errors (seen before, not yet fixed)
| Service | Error | Days Recurring | Escalation |
|---|---|---|---|
| _none — first run, no baseline_ | | | |

### Auto-Fixed This Run
| Error | File | Fix Applied | Commit |
|---|---|---|---|
| _none — no finding met all safe-auto-fix criteria (clear code root-cause, <10 lines, non-breaking, reversible, tsc-clean). All findings are env-var config or behavior-policy changes._ | | | |

### Requires Human Attention
| Error | Severity | Why It Needs Human | Suggested Fix |
|---|---|---|---|
| Discord alerting unconfigured → all cron alerts silently dropped | **HIGH** | Cannot be fixed in code and I don't hold the webhook URL value. With both `DISCORD_OPS_WEBHOOK_URL` and `DISCORD_PLAY_WEBHOOK_URL` unset, **any real cron failure or RTH staleness goes completely unnoticed** — the safety net is off. | Set `DISCORD_OPS_WEBHOOK_URL` (and/or `DISCORD_PLAY_WEBHOOK_URL`) in the blackout-web Railway service env. Until then the watchdog is detect-only. |
| Heatmap I:SPX chain truncated at 16-page guard → walls/OI/IV understated | **MEDIUM** | Raising the page guard or switching to full pagination increases UW/Polygon API cost and latency — a deliberate trade-off, not a mechanical fix. Touches the GEX data contract. | Decide between (a) raising the page guard, (b) paginating fully with a hard cap + telemetry on truncation rate, or (c) accepting understatement and surfacing a "partial chain" flag in the heatmap. Located in the polygon-gex `fetchHeatmapBand` path. |
| Watchdog over-flags `nighthawk-playbook` on weekends/overnight | **LOW (P3)** | The 4h `stale_after_min` for a weekday-evening-only cron means every weekend morning and every weekday before 5:30 PM ET trips a (false) stale alert. Making the staleness window schedule-aware is a behavior change >10 lines — not a safe blind auto-fix. | Make `stale_after_min` schedule-aware for `nighthawk-playbook`: skip Sat/Sun and don't enforce until after the evening publish window. Matches the prior #77 hardening intent (catch a *missed weekday* night) without crying wolf overnight/weekends. |

### Services With No Errors
- **Flow-Ingest-Cron** — `/api/cron/flow-ingest → 200`, `ok=true ingested=0 polled=100` (clean; 0 ingested expected off-session)
- **UW-Cache-Refresh-New** — `/api/cron/uw-cache-refresh → 200`, `ok=true refreshed=24 total=24` (all 24 refreshed)
- **Cron-Staleness-Watchdog** — `/api/cron/cron-staleness-watchdog → 200`, `checked=16 rth_stale=0` (the 1 problem is the benign nighthawk weekend false-positive above)
- **NightHawk-Playbook** — no log output (evening-only worker; idle on Saturday morning, as expected)

### Triage Notes
- This is the **first run** of daily error triage — no prior `error-log.md` existed, so there is no recurring-error baseline yet. Subsequent runs will diff against this entry.
- The two HUMAN items (Discord webhook, heatmap pagination) and the LOW watchdog item are **not** tracked in `docs/api-audit/OPEN-ISSUES.md` as of 2026-06-27 07:15 ET — they are net-new from log analysis.
- No secrets were printed; no log line contained a credential value requiring redaction.
