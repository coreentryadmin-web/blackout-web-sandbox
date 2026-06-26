# error-triage — 2026-06-25 (OVERNIGHT-4 run, daily slot)

Autonomous daily production error triage (SDLC §3). **Ninth error-triage run today.** Checks the
durable error sink, incidents, admin health, and the 24h provider telemetry dashboard on the LIVE app
(`blackouttrades.com`, logged-in admin session via the Chrome bridge) for NEW/spiking error
signatures **since the prior run (OVERNIGHT-3, ~02:41 UTC @ base `744fa4d`)**, root-causes each, then
applies the FIX-vs-FLAG policy.

Repo: `C:/Users/raidu/blackout-cron` (isolated cron clone). `git pull` clean → base `dd9c724`,
**tsc-green (exit 0)**. Market CLOSED (~10:40 PM PT / weekday). Prior logs today:
`error-triage-2026-06-25.md` (12:45) · `-pm` · `-night` · `-late` · `-evening` · `-overnight` ·
`-overnight2` · `-overnight3` (02:41).

---

### A. NEW error signature found + FIXED → main (`40fcc24`)

**Signature:** UW `400 Invalid sector` on `/api/market/{sector}/sector-tide`, recurring on every
2-min `uw-cache-refresh` cron tick.

| at (UTC) | endpoint | upstream body |
|---|---|---|
| 03:29:08 | `/api/market/financials/sector-tide` | `{"error":"Invalid sector: financials"}` |
| 03:29:09 | `/api/market/consumer_discretionary/sector-tide` | `{"error":"Invalid sector: consumer_discretionary"}` |
| 03:46:53 | `/api/market/financials/sector-tide` | `{"error":"Invalid sector: financials"}` (next tick, pre-deploy) |

This was the **only** new signal on the dashboard (`recent_errors`), and the **two of five**
sectors that error every tick. It did NOT raise an incident or hit the durable sink (it's a handled
upstream 4xx absorbed by `uwGetSafe`→null), so it was invisible to §B's clean surfaces — only the
24h API-telemetry dashboard exposed it.

**Root cause:** UW's Sector Tide enum uses Yahoo/ETF-style **GICS names** — `Financial Services`,
`Consumer Cyclical` — matched case-insensitively. The cron's `SECTORS` list and Night Hawk's
`SECTOR_WATCH` used the **classic GICS labels** `financials` / `consumer_discretionary` (and NW's
generic `consumer`), which UW rejects with `Invalid sector`. The three single-word sectors
(`technology`/`energy`/`healthcare`) matched by luck (lowercased enum name == slug). Verified the
correct enum against the official UW docs (`sec_indst`): the documented values are
`Basic Materials, Communication Services, Consumer Cyclical, Consumer Defensive, Energy,
Financial Services, Healthcare, Industrials, Real Estate, Technology, Utilities`. Impact: Night Hawk
`sector_tides` + Largo `get_sector_flow` silently got `null` rotation data for financials/consumer
on every run.

**Fix (`40fcc24`, 2 files, +44/-4):**
- `src/lib/providers/unusual-whales.ts` — added `normalizeUwSector()` mapping GICS/legacy aliases
  (`financials→financial services`, `consumer*`/`discretionary→consumer cyclical`,
  `materials→basic materials`, `health care→healthcare`, `reit→real estate`, …) to UW's exact enum
  name; `encodeURIComponent` on the sector path segment. Applied inside `fetchUwSectorTide` so it
  fixes **all three** call sites (cron + Largo + Night Hawk) at one point, and canonicalizes the
  cache key (no alias-duplicated keys).
- `src/app/api/cron/uw-cache-refresh/route.ts` — canonicalized `SECTORS` to the UW enum names.

`npx tsc --noEmit` exit 0 · `npm run build` exit 0. High-confidence, small, isolated, build-gated →
pushed to `main` (clean ff from `dd9c724`; no concurrent work lost).

**LIVE post-deploy verification (the critical step — the space-vs-hyphen slug was the only
uncertainty):** after Railway deployed `40fcc24`, force-ran the cron via
`POST /api/admin/cron/run {name:"uw-cache-refresh"}` (fresh replica → empty cache → real UW calls on
the new keys): returned `{ok:true, refreshed:24, total:24}` and **zero** sector-tide 400s in
`recent_errors` afterward. A wrong separator would have produced a fresh `Invalid sector: financial
services` 400 in the sink — none appeared. The lowercased space form (`%20`-encoded) is **accepted by
live UW**. Fix confirmed end-to-end.

---

### B. Rest of the live surface — CLEAN

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `events:[]` — 0 |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`; critical/warning/info/api_errors all 0; `issues:[]`; `route_errors:[]`; `redis_degraded:false`; `market_health_ok:true` |
| Provider health (5m) | `/api/admin/health` | ✅ polygon `101 calls / 0 err` (200), UW `35 calls / 0 err` (200, `/greek-exposure/expiry`), anthropic idle; all WS OPEN+auth (polygon-indices SPX 7357.49/VIX 18.89, UW 5 channels, Massive options 1 shard); rate-limiters healthy (uw circuit closed `recent429s:0`, polygon `consecutive429:0`) |
| API dashboard (24h) | `/api/admin/apis/dashboard` | after fix: `recent_errors:[]`, `active_retries:0`; ops `db_pool` 3/3 idle, headroom all `ok` (polygon 17%, UW 6%, anthropic 0%) |

The only non-clean diagnostic is `play_engine.critical_stale:true` — the previously-verified benign
**off-hours suppression** (last cron tick 20:10Z; engine doesn't tick while market closed; not wired
to escalate, no incident, `health_ok:true`). Self-clears at next RTH tick. No action (anti-theater).

---

### Result

**✅ ONE new signature found + FIXED + LIVE-VERIFIED.** The recurring UW `Invalid sector` 400s
(financials/consumer_discretionary, every cron tick) root-caused to wrong sector slugs and fixed at
`40fcc24` — verified accepted by live UW via a forced post-deploy cron run (24/24, 0 errors). All
other surfaces (durable sink, incidents, health, route_errors) clean. Net: sector rotation data now
populates for all 5 sectors across cron + Largo + Night Hawk.

### Carry-forward (toward 0-open-issues — human merge-or-close)
- Open auto branches awaiting review: `auto/error-triage-2026-06-25-anthropic-timeout`,
  `auto/error-triage-2026-06-25` (db-cleanup allSettled + options-socket map eviction),
  `auto/anthropic-caching-2026-06-25`, `auto/clerk-webhook-2026-06-25`, `auto/far-dated-gex-2026-06-25`.
- UW upstream-503 blips remain a handled transient class (`uwGetSafe` 5xx retry + stale fallback);
  escalate only on sustained spikes.
- `play_engine.critical_stale` off-hours: cosmetic-only; LOW-VALUE candidate to gate behind an RTH
  check so it doesn't read alarming overnight. Flag-only.
- Pre-existing low-value hardening (no prod signature): client per-line `JSON.parse` at `api.ts:537`;
  `admin/health` counting SLA-latency breaches as "errors"; `spx-desk` GEX-Anchor tone (#80, UI).
