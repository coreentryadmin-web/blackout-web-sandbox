# Railway cron schedules (production)

**Important:** Railway stores and displays cron times in **UTC**. The dashboard text
“11:00 am – 9:59 pm” is **not Eastern Time** — it is UTC hours 11–21.

## RTH band convention (`11-21 * * 1-5`)

Most market-hours crons use:

```cron
*/N 11-21 * * 1-5
```

| UTC hours | ≈ Eastern (EDT, Mar–Nov) | ≈ Eastern (EST, Nov–Mar) |
|-----------|--------------------------|---------------------------|
| 11–21     | 7:00 AM – 5:59 PM        | 6:00 AM – 4:59 PM         |

**US equity RTH is 9:30 AM – 4:00 PM ET.** Routes apply an in-app ET gate
(`inMarketHours` / `inOptionsMarketHours`) so fires before 9:30 or after 4:00
are cheap no-ops — the wide UTC band avoids maintaining separate EDT/EST cron lines.

## All 23 cron trigger services

| Job key | Railway service | Cron (UTC) | Purpose / notes |
|---------|-----------------|------------|-----------------|
| flow-ingest | Flow-Ingest-Cron | `*/2 11-21 * * 1-5` | HELIX flow persist |
| spx-evaluate | SPX-Engine-Evaluation | `*/5 11-21 * * 1-5` | SPX engine |
| uw-cache-refresh | UW-Cache-Refresh-New | `*/2 11-21 * * 1-5` | UW REST cache warm |
| nights-watch-warm | Night's Watch-Warm-New | `* 11-21 * * 1-5` | Every minute in band; ET gate in route |
| heatmap-warm | heatmap-warm | `* 11-21 * * 1-5` | Thermal matrix warm |
| grid-warm | Grid-Warm-Cron | `*/2 11-21 * * 1-5` | Grid panels warm |
| gex-alerts | GEX-Alerts | `*/5 11-21 * * 1-5` | GEX push alerts |
| data-integrity | Data-Integrity-Cron | `*/5 11-21 * * 1-5` | Data integrity verifier |
| data-correctness | Data-Correctness-Cron | `0,30 11-21 * * 1-5` | :00/:30 each hour in band |
| provider-health-reconcile | provider-health-reconcile | `*/10 11-21 * * 1-5` | Provider health |
| market-regime-detector | Market-Regime-Detector | `*/5 11-21 * * 1-5` | Regime writes |
| spx-signal-observe | SPX-Signal-Observe | `*/5 11-21 * * 1-5` | Signal observe |
| **socket-health** | **Socket-Health-Cron** | **`*/15 11-21 * * 1-5`** | **WS probe every 15m; ET gate on route** |
| gex-eod-snapshot | GEX-EOD-Snapshot | `10 20,21 * * 1-5` | ~4:10 PM ET close snapshot (dual UTC hour for DST) |
| nighthawk-outcomes | NightHawk-Outcomes-Cron | `30 20,21 * * 1-5` | Post-close outcomes |
| positions-expiry | Positions-Expiry-Cron | `30 21 * * 1-5` | ~5:30 PM ET expiry pass |
| nighthawk-playbook | NightHawk-Playbook | `30/15 21-23 * * 1-5` | Evening edition window |
| nighthawk-morning-confirm | NightHawk-Morning-Confirm | `15 13 * * 1-5` | ~9:15 AM ET |
| spx-signal-weight-optimize | SPX-Signal-Weight-Optimize | `0 22 * * 1-5` | ~6 PM ET post-close |
| membership-reconcile | Membership-Reconcile | `0 */6 * * *` | Every 6h, 24/7 |
| db-cleanup | DB_CLEANUP | `0 7 * * *` | Daily 07:00 UTC |
| largo-cleanup | Largo-Chat-CleanUp | `0 8 * * 0` | Sunday 08:00 UTC |
| cron-staleness-watchdog | Cron-Staleness-Watchdog | `*/20 * * * *` | 24/7 staleness monitor |

## Socket-Health-Cron specifically

- **Cron:** `*/15 11-21 * * 1-5` → every **15 minutes**, UTC hours **11–21**, Mon–Fri.
- **Railway UI:** “every 15 minutes, between 11:00 am and 09:59 pm” — those are **UTC** times.
- **Effective RTH checks:** only when `inOptionsMarketHours()` is true (9:30 AM–4:00 PM ET).
- **Regions:** `iad` + `us-west2` (Railway may label `us-west2` as “SFO” in the app).

Verify live config:

```bash
unset RAILWAY_API_TOKEN
node scripts/railway-audit-apply.mjs --dry-run
node scripts/railway-cron-schedule-audit.mjs
```
