# BlackOut Railway deploy + cron monitor log — 2026-06-25

Autonomous hourly monitor (`blackout-railway-deploy-monitor`, cron `17 6-19 * * 1-5`, durable) — watches the Railway dashboard for service crashes, failed deploys, stale/unwired crons (#90 class), and the after-hours edition cron (#77). Cross-checks live-app freshness so a "cron Online but data frozen" trap is caught.

### ~10:50 PDT — BASELINE (manual, monitor setup)
- ✅ INFRA: Postgres Online · Redis Online · blackout-web Online.
- ✅ CRONS recurring/healthy: Flow-Ingest-Cron "Next in 16s" · SPX-Engine-Evaluation "Next in 16s" · UW-Cache-Refresh-New / Night's-Watch-Warm-New / heatmap-warm = "Completed" between their every-1–2-min runs (live data confirmed fresh this cycle → they ARE firing) · Cron-Staleness-Watchdog "Completed" (every 20m) · NightHawk-Outcomes "Next in 3h" · Largo-Chat-CleanUp "Next in 2 days" · Membership-Reconcile / DB_CLEANUP / NightHawk-Playbook Online.
- ✅ No failed/crashed services; no red-dot alerts on the canvas. The #90 fix (config-as-code wired per service) is holding — all warmers present + recurring.
- CROSS-CHECK (app): UW 0×429 / circuit closed; SPX gex spot tracking live (≈7357, not frozen). Healthy.
- VERDICT: Railway green. Monitor armed — next autonomous run ~hourly 6 AM–7 PM PT weekdays.

### ~11:23 PDT (14:23 ET, RTH open) — AUTONOMOUS RUN
- ✅ INFRA: Postgres Online · Redis Online · blackout-web Online · Membership-Reconcile / DB_CLEANUP / NightHawk-Playbook Online. No login wall, no failed/crashed services, no red-dot canvas alerts.
- ✅ DEPLOYS: active deploy wave in progress — commit `fix(uw): stop cron poisoning fetchUwFlow0dte cache with wrong shape (flow_per_strike collision)` deployed ~2–3 min ago across services, all "Deployment successful". (Explains the fresh "Completed" badges + reset exec histories below.)
- ✅ CRONS — drilled into all 4 "Completed"-badge crons (the #90 trap) via their Cron Runs tab. ALL confirmed WIRED + scheduled, **not** unwired:
  - **UW-Cache-Refresh-New**: "Next run in 3s", every 2 min 11am–9:59pm M–F; full healthy execution list (all green, 2–11s).
  - **Cron-Staleness-Watchdog**: "Next run in 14 min", every 20 min; full healthy execution list (11:20/11:00/10:40/10:21… all green, 1–3s). The meta-monitor itself is alive → internal staleness detection NOT blind.
  - **heatmap-warm**: "Next run in <1 min", every minute 11am–9:59pm M–F; counting down live. ⚠️ "no previous executions" — consistent with the just-now redeploy resetting per-deployment history (not a failure; schedule active + GEX data fresh, see below).
  - **Night's-Watch-Warm-New**: "Next run in 32s", every minute 11am–9:59pm M–F; counting down live. ⚠️ same "no executions" as heatmap-warm (fresh redeploy).
  - Recurring/healthy as before: Flow-Ingest "Next in X" · SPX-Engine "Next in X" (both showed "Next 1s ago" mid-fire) · NightHawk-Outcomes "Next in 2h" · Largo-Chat-CleanUp "Next in 2 days".
  - FINDING: the canvas "Completed" badge = latest BUILD/deploy status, NOT cron health. The real #90 signal (a service with NO schedule on click-in) appears on none of them. False-alarm pattern confirmed for the 2nd run.
- ✅ CROSS-CHECK (live app, RTH):
  - `/api/admin/health`: 0 critical · rate limiters healthy (UW circuitOpen=false, recent429s=0; Polygon consecutive429=0) · redis_degraded=false · Postgres no pool errors · market_health_ok=true · SPX spot 7372.69 age **586 ms** (LIVE) · VIX 18.77 fresh · Polygon-indices WS OPEN+auth · Massive options WS OPEN+auth · UW channels OPEN+auth: flow_alerts/market_tide/off_lit_trades/interval_flow/trading_halts.
  - `/api/market/gex-positioning?ticker=SPX`: spot 7372.96, **asof 18:21:57Z (live, seconds old)**, rolling shift_summary over "last 3h25m", source Massive — NOT frozen. Confirms heatmap-warm path is producing live data despite its reset exec history.
- ⚠️ DEGRADED-FEATURE WARNINGS (non-critical, `health_ok=false` from these 5; site NOT down):
  - ⚠️**PERSISTENT** — UW **gex** + **net_flow** WS channels stuck `CONNECTING` + unauthenticated (gex_updated_at=null, net_flow_updated_at=null). Re-checked at 18:27:38Z (6 min later, after the deploy wave): STILL CONNECTING/unauth — so NOT a transient deploy-restart reconnect. The OTHER 5 UW channels (flow_alerts/market_tide/off_lit_trades/interval_flow/trading_halts) are all OPEN+authenticated → the failure is *specific* to the gex + net_flow subscriptions (auth_failed=false, just never completes the handshake — smells like a UW entitlement/subscription issue for those two channels, or a subscribe bug). GEX *walls* unaffected (sourced from Massive, confirmed fresh) — user impact limited to any surface reading the live UW net-flow / UW-gex stream. **ACTION: investigate UW gex/net_flow WS subscribe + plan entitlement; not site-down but a real degraded feature persisting across this session.**
  - I:TICK / I:TRIN / I:ADD breadth feeds price=0, age≈epoch (never populated this session) — affects market-breadth indicators only; appears persistent, monitor.
- ⏳ NIGHT HAWK EDITION (#77): not yet due — 11:23 PT / 14:23 ET; publish window 17:30 ET. Will verify on the after-hours run.
- VERDICT: **Railway GREEN, live data FRESH.** No #90 (all warmers wired+firing), no #77 yet. **One real open item:** UW gex + net_flow WS channels persistently stuck CONNECTING/unauth (degraded feature, not site-down) — flagged for investigation. Breadth feeds (TICK/TRIN/ADD) zero, likely persistent.
