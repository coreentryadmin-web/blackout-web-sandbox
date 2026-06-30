# BlackOut Open Issues Log
Last updated: 2026-06-30 16:15 ET

> **Shipping log:** Audit backlog batch 1 → **PR #132** (merged): cron timing-safe auth, dead code,
> Track Record nav, db-cleanup, Grid bootstrap. Closed duplicate PRs **#127–#130** — ignore those.
> Canonical audit probe list: `docs/api-audit/AUDIT-SKILL-REFERENCE.md` (in-repo SKILL:
> `.cursor/skills/platform-audit/SKILL.md`).

## RTH comprehensive sweep — 2026-06-30 ~16:04–16:15 ET (pass 5 — close)

**Session:** Tue 30 Jun 2026, 16:04–16:15 ET (RTH final 15m + close). Agent: autonomous RTH cloud session. Premium Clerk admin session (`claude-audit-temp@blackouttrades.com`, `role:admin` + `tier:premium`).

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` (initial) | ❌ `pg` missing locally; ❌ `grid-warm` + `nights-watch-warm` no ok run in 20m |
| `npm install` + cron warm | ✅ deps restored; manual `grid-warm?force=1` + `nights-watch-warm?force=1` |
| `npm run validate:rth-open` (final) | ✅ GREEN — deploy + all RTH session checks |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed (`market_open: false` at close) |
| `npm run ops:collect` | ✅ 0 action items |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (49 pass) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN (49 pass) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 matrix flags |

### API sweep (CRON bearer — ~16:05 ET)

| Endpoint | HTTP | Notes |
|---|---|---|
| `/api/grid/*` (8 panels) | 200 | all `available=true`, finite payloads |
| `/api/market/spx/pulse` | 200 | `available=false` — **expected** post-16:00 close |
| `/api/market/flows` | 200 | finite |
| `/api/market/gex-positioning?ticker=SPX` | 200 | flip/walls finite |
| `/api/public/track-record` | 200 | **9 closed** (0W/9L) — live sync ✅ (post #132 fix) |
| `/api/market/news` | 200 | 15 articles |

**SPX oracle:** desk 7499.23 vs Polygon 7499.23 (Δ 0.00).

### Browser sweep (premium admin — all 7 pages)

| Page | Hard load | Soft-nav | Live update | Console | Notes |
|---|---|---|---|---|---|
| `/dashboard` | instant | <1s | static 25s obs | CSS preload warn | EXTENDED+OFFLINE; VIX/VWAP/GEX/HOD `—` **expected** at close; GEX walls live (7,480–7,520) |
| `/flows` | ~1s | <1s | static (after-hours banner) | React #418 + CSS | IWM/QQQ/SPX flows populated |
| `/heatmap` Matrix | ~1s | instant tab | LIVE badge, spot ticks | CSS warn | SPY 745.99; flip 746, call 750, put 745/740 |
| `/heatmap` Profile | instant | tab switch | same | same | Positioning alert + gamma profile charts |
| `/grid` | ~1s | <1s | N/A | 1 issue | **P2 watch:** agent saw skeleton lattice; APIs 200 — likely backdrop + slow SWR paint (same as pass 2/4) |
| `/nighthawk` | ~1s | <1s | EDITION LIVE | React #418 | 3 plays 2026-06-30; 62% target hit, 75% profitable |
| `/terminal` (Largo) | instant | <1s | ~20s AI response | CSS warn | NVDA flow $10.19M+$3.83M+$2.25M; dark pool cluster grounded; follow-ups offered |
| `/track-record` | ~1s | <1s | LIVE counter ticks ~60s | React #418 | ODTE 0W/9L; Night Hawk 60% (3W/2L) |

### Missing-field audit (pass 5)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| VIX, VWAP, GEX, HOD/POD/LvD/PDL, REGIME | `/dashboard` | `spx/pulse` `available=false` | **Expected off-hours** | none |
| Grid panel bodies slow/blank | `/grid` | `/api/grid/*` all 200 | **Cold client render** / backdrop lattice | **P2 watch** (pass 2/4 same) |
| `nope`, `dark_pool.pcr` | desk/flows | UW optional null | **Upstream gap** | Expected |
| TSLA/AMD flip `—` | heatmap matrix audit | far-dated chain sparse | **Upstream gap** | Expected |

### Ops watch

| ID | Item | Status |
|---|---|---|
| **OPS-6** | `grid-warm` + `nights-watch-warm` stale >20m at 16:04 ET | Transient — manual warm cleared; watchdog `problems:0` (crons skip after 16:00 ET gate) |
| **OPS-7** | Sentry 4× `Not Found` + `fetch failed` | Watch — unchanged from pass 4 |
| **OPS-13** | React #418 on `/flows`, `/nighthawk`, `/track-record` | **P2** — known hydration class (`FlowBrief`, `FreshnessChip`); regression tests exist |
| **OPS-14** | CSS preload warnings (all pages) | **P2** — non-blocking perf |

**No new P0/P1** — all validation GREEN after cron warm. No code fix required this pass.

## RTH comprehensive sweep — 2026-06-30 ~14:27–15:00 ET (pass 4)

**Session:** Tue 30 Jun 2026, 14:27–15:00 ET (RTH mid-afternoon). Agent: autonomous RTH cloud session. Premium Clerk admin session (browser).

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` (initial, stale main) | ❌ pg missing locally; then ❌ data-correctness 2 flags + socket log false-fail |
| `git pull origin main` | ✅ #116 socket-health, #126 halt cluster, nw15 fixes |
| `npm run validate:rth-open` (post-pull + cron warm) | ✅ GREEN — options-socket authenticated (1 shard, 6 contracts) |
| `GET /api/cron/data-correctness?force=1` | ⚠️ transient 2–5 writer-stale flags → watchdog self-heal + manual `?force=1` → ✅ 0 flags |
| `npm run ops:collect` | ✅ 0 action items |
| `node scripts/full-site-deep-audit.mjs` | ⚠️ **P0** `OUTCOMES-VS-PUBLIC`: spx/outcomes closed=8 vs public=7 |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (49 pass) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 matrix flags |

### Fix shipped (branch `fix/public-track-record-live-sync`)

| ID | Issue | Fix |
|---|---|---|
| **P1 track-record split-brain** | `/api/public/track-record` ISR `revalidate=300` served stale `total_closed=7` while `/api/market/spx/outcomes` + `/api/track-record` showed 8 after play #8 closed | `dynamic = "force-dynamic"` + `no-store` — public ledger now reads live `fetchPlayOutcomeStats()` like outcomes |

### API sweep (CRON bearer — ~14:50 ET)

| Endpoint | HTTP | Notes |
|---|---|---|
| `/api/market/spx/desk` | 200 | SPX ~7495, VIX ~16.6; oracle Δ ≤0.04 |
| `/api/market/gex-heatmap?ticker=SPY` | 200 | 68 strikes × 14 expiries; gex.cells populated |
| `/api/market/flows` | 200 | 200 rows, Σ ~$100M premium finite |
| `/api/market/spx/outcomes` | 200 | 8 closed (5 today + 3 prior); 0 wins today |
| `/api/public/track-record` | 200 | **stale 7** (pre-fix cache) |
| `/api/grid/*` (8 panels) | 200 | all finite |

### Browser sweep (premium admin session — all 7 pages)

| Page | Hard load | Soft-nav | Live update | Console | Notes |
|---|---|---|---|---|---|
| `/dashboard` | ~8s | <1s | ✅ SPX/GEX/alerts tick ~30–60s | AudioContext warn | AVG WIN `—` — **expected** (0W/4L today) |
| `/flows` | — | <1s | ⚠️ static in 15s obs (flow-ingest was stale pre-heal) | forced-reflow | ~15 anomaly rows populated |
| `/heatmap` Matrix | — | <1s | Profile ✅ LIVE; Matrix reported OFFLINE in agent pass | forced-reflow | **API has full matrix** — likely transient cold tab / badge misread; matrix audit GREEN |
| `/grid` | — | <1s | partial (~5s panel paint) | clean | Unified News + GEX Regime populated |
| `/nighthawk` | — | <1s | static edition | clean | 3 plays 2026-06-30; 60% resolved win rate |
| `/terminal` (Largo) | — | <1s | on-demand | clean | NVDA dark pool + flow answer grounded ($18.1M @200c, $4.4M DP, $198.49 spot) |
| `/track-record` | ~1s | <1s | static ledger | clean | ODTE 0% (7 closed public pre-fix); Night Hawk 60% |

### Missing-field audit (pass 4)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| AVG WIN `—` | `/dashboard` Today | `spx/outcomes` — 0 wins today | **Expected** — avg only when wins exist | none |
| `nope`, `dark_pool.pcr` | desk/flows | UW optional null | **Upstream gap** | Expected |
| `gex-heatmap` overlays | heatmap | overlay channel off | **Expected** | none |
| Public `total_closed` lag | `/track-record` embed | ISR cache on public route | **UI/cache bug** | **FIX** PR `fix/public-track-record-live-sync` |

### Ops watch

| ID | Item | Status |
|---|---|---|
| **OPS-6** | Railway writer cadence gaps (flow-ingest, heatmap-warm, grid-warm ~12–26m) | Watch — self-heal clears; triggered 5 writers at 14:53 ET |
| **OPS-7** | Sentry `TypeError: fetch failed` + 4× `Not Found` (18:28 UTC) | Watch — 14 error_events / 1h during audit session |
| **OPS-12** | `error_events` spike during forced cron self-heal | Transient — cleared post-warm |

## RTH comprehensive sweep — 2026-06-30 ~13:50–14:20 ET (pass 3)

**Session:** Tue 30 Jun 2026, 13:50–14:20 ET (RTH mid-session). Agent: autonomous RTH cloud session.

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` | ✅ GREEN (deploy + RTH session checks) |
| `GET /api/cron/data-correctness?force=1` (initial) | ⚠️ 1 flag: `writer_uw_cache_refresh` stale — watchdog self-healed |
| `GET /api/cron/data-correctness?force=1` (post-heal) | ✅ 0 flags, 7 oracle-confirmed |
| `npm run ops:collect` | ✅ 0 action items |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN — 49 pass / 0 issues |

### Fixes shipped (branch `fix/uw-halt-cluster-freshness` → PR #126)

| ID | Issue | Fix |
|---|---|---|
| **P1 halt feed false-stale (#125)** | `halt_channel_stale=true` on 100% of `/api/market/spx/pulse` hits during RTH — non-leader replicas (4/5) lack in-process UW timestamps → dashboard "Halt feed offline" banner + play-entry fail-closed | Leader writes `uw:ws:last_msg_at` Redis heartbeat; standbys poll + merge via `mergeFreshestTimestamps()` |

### API sweep (CRON bearer — 14:11 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/spx/pulse` | 200 | ~0.2–2.8s | **`halt_channel_stale: true` on all replicas (pre-fix #126)** |
| `/api/market/spx/merged` | 200 | ~32s | Slow cold build; spot finite when warm |
| `/api/market/gex-positioning?ticker=SPX` | 200 | ~0.8s | oracle Δ 0.13 vs desk |
| `/api/grid/*` (8 panels) | 200 | 54–7984ms | all finite |

### Browser sweep (partial)

| Page | Result | Notes |
|---|---|---|
| `/track-record` | ✅ | ~1s load, all fields populated |
| `/terminal` (Largo) | ✅ | NVDA query grounded; sources cited |
| `/dashboard` | ⚠️ | Live SPX tick ~3–5s; "Halt feed offline" banner (pre-fix) |
| `/flows`, `/heatmap`, `/grid`, `/nighthawk` | ⚠️ | Test user `tier:free` after `membership-reconcile` |

## RTH comprehensive sweep — 2026-06-30 ~12:37–13:44 ET (pass 2)

**Session:** Tue 30 Jun 2026, 12:37–13:44 ET (RTH). Premium Clerk session + full browser sweep.

### Validation summary (final)

| Check | Result |
|---|---|
| `npm run validate:rth-open` | ✅ GREEN (post #116 + #118 deploy) |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags (was 1 P0: QUBT unlisted strike — cleared) |
| `npm run ops:collect` | ✅ 0 action items |
| `GET /api/cron/socket-health` | ✅ `options: enabled, no held contracts` |
| `node scripts/full-site-deep-audit.mjs` | ✅ 48 pass (transient stale-cron flags self-healed) |

### Fixes shipped

| PR | Issue | Fix |
|---|---|---|
| **#116** | P1 options-socket RTH false-fail (log grep missed cluster leader) | `GET /api/cron/socket-health` + HTTP probe in `rth-open-check.mjs` |
| **#118** | P0 `nw15 is not defined` ReferenceError; P0 data-correctness unlisted strike | nights-watch-warm Postgres gate; `autoCloseUnlistedOpenPositions` on snapshot unfound |

### Browser sweep (premium session — all 7 pages)

| Page | Load | Live update | Console | Missing fields |
|---|---|---|---|---|
| `/dashboard` | ~3s hard | ✅ alerts tick ~20s (SCANNING→BUY CALL) | AudioContext warn only | none |
| `/flows` | ~1s soft-nav | ✅ sentiment banner ~20s | forced-reflow verbose | none |
| `/heatmap` Matrix+Profile | ~2s | ✅ LIVE badge; matrix GEX walls populated | forced-reflow verbose | brief OFFLINE before VEX tab click |
| `/grid` | ~15s (slowest) | partial — many panels slow to paint | forced-reflow verbose | **P2 watch:** ~6–8/12 panels empty at 15s (APIs 200; client render cadence) |
| `/nighthawk` | ~2s | static edition (expected) | clean | none |
| `/terminal` (Largo) | instant | N/A | clean | none — NVDA dark pool answer grounded ($10.19M @ $200.50p) |
| `/track-record` | ~1s | static ledger | clean | none (5 closed SPX Slayer plays) |

**SPX cross-tool:** dashboard SPX 7,498 vs heatmap **SPY** 746.85 — not a discrepancy (heatmap defaults to SPY ticker; API `gex-heatmap?ticker=SPX` spot 7498.28 ✅).

### Missing-field audit (pass 2)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| Grid panel bodies slow/blank | `/grid` | `/api/grid/*` + `/api/market/*` all 200 | **Cold client render** — 12 parallel SWR panels; not upstream gap | **P2 watch** — consider staggered fetch or skeleton timeout UX |
| Heatmap brief OFFLINE | `/heatmap` | gex-heatmap warms on tab switch | **Transient cold** | Clears on interaction; no fix needed |
| `nope` / dark_pool optional | desk/flows | UW optional fields null | **Upstream gap** when channel quiet | Expected — honest unavailable |

### Ops watch

| ID | Item | Status |
|---|---|---|
| **OPS-6** | Railway cron cadence gaps (flow-ingest, grid-warm) | Watch — self-heal clears |
| **OPS-7** | Sentry `TypeError: fetch failed` (06:38 UTC) | Watch — 1 error_events / 24h |
| **OPS-9** | options-socket 1006 failures=1 in deploy logs (0 held contracts) | Watch — socket-health passes |
| **OPS-10** | Grid 15s load on 12-panel board | P2 UX — APIs healthy |
| **OPS-11** | `/api/market/spx/merged` ~32s cold latency | Watch — cache warm path |

## RTH comprehensive sweep — 2026-06-30 ~12:02–12:20 ET (pass 1)

**Session:** Tue 30 Jun 2026, 12:02–12:20 ET (RTH open). Agent: autonomous RTH cloud session.

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` (pre-fix) | ❌ options-socket log auth false-fail; grid-warm RTH-stale |
| `npm run validate:rth-open` (post-fix) | ✅ GREEN |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed |
| `npm run ops:collect` | ✅ 0 action items (post warm) |
| `node scripts/full-site-deep-audit.mjs` | ✅ 48 pass / 0 issues (post warm) |
| `node scripts/gha-rth-audit.mjs` | ⚠️ transient P0 spot>HOD race at 12:16; flow-ingest stale flag cleared after warm |

### Fixes shipped (branch `fix/rth-grid-warm-self-heal-socket-check`)

| ID | Issue | Fix |
|---|---|---|
| **P0 grid-warm self-heal gap** | Watchdog flagged `grid-warm` RTH-stale; self-heal skipped it (not in `CRON_DISPATCH`) | Added `grid-warm` to `cron-dispatch.ts` + `Grid-Warm-Cron` service name map |
| **P1 RTH socket false-fail** | `validate:rth-open` required options-socket auth log line — unreliable on 5-replica cluster | Postgres-backed check: `nights-watch-warm` ok + open-position count; idle when 0 positions |

### API sweep (CRON bearer — premium endpoints)

| Endpoint | HTTP | Latency | `as_of` fresh | Notes |
|---|---|---|---|---|
| `/api/market/spx/desk` | 200 | ~1.3s | ✅ | SPX ~7493, VIX ~16.7; oracle Δ 0.02 |
| `/api/market/spx/pulse` | 200 | ~2.8s | — | `price_age_ms` null (optional) |
| `/api/market/flows` | 200 | ~8.7s | — | 200 rows, Σ $211M premium finite |
| `/api/market/gex-positioning` | 200 | ~4.4s | — | no nulls |
| `/api/market/gex-heatmap` | 200 | ~0.5s | — | `overlays.flow_by_strike`, `nighthawk_context` null (optional overlays) |
| `/api/market/nighthawk/edition` | 200 | ~0.1s | — | 3 plays 2026-06-30 |
| `/api/grid/*` (8 panels) | 200 | 55–1712ms | ✅ | all finite; analysts/congress/dark-pool/sectors/movers/catalysts clean |

**Cross-tool GEX/SPX agreement:** desk spot vs Polygon oracle within 0.02 pts; GEX positioning finite; heatmap matrix 10×4 invariants pass.

### Missing-field audit (API-backed — expected vs defect)

| Field / surface | Backing API | Cause | Action |
|---|---|---|---|
| `nope`, `nope_net_delta`, `dark_pool.pcr` on desk/merged/flows | UW upstream optional | **Upstream/data gap** — fields null in API during RTH | Expected when UW channel quiet; UI should show unavailable not fabricated |
| `spx_flows[].alert_rule`, `trade_count` | flow row optional metadata | **Expected** — not every alert has rule/count |
| `grid/earnings` `eps_actual`, `surprise_pct` | pre-report rows | **Expected** — future earnings have no actual yet |
| `grid/economy` `indicators[].rows[7].value` | macro series tail | **Expected** — trailing row may be unreleased |
| `gex-heatmap` `overlays.flow_by_strike` | overlay channel | **Expected off** when overlay not warmed |
| Browser premium pages | Clerk prod auth | **Blocked** — `+clerk_test` only works locally | API sweep covers data plane; browser UI sweep needs prod premium session |

### Browser sweep

- `/track-record` (public): fast load, no console errors, no `—` fields, static data (no live tick — expected).
- `/dashboard`, `/flows`, `/heatmap`, `/grid`, `/nighthawk`, `/terminal`: **blocked** — prod Clerk rejects test credentials; redirect to sign-in.

### Ops watch (not code bugs)

| ID | Item | Status |
|---|---|---|
| **OPS-6** | Railway `Grid-Warm-Cron` / `Flow-Ingest-Cron` cadence gaps (~30–60m between fires despite `*/2` / `* *` schedule) | Watch — manual `hit-cron` clears staleness; self-heal now covers grid-warm |
| **OPS-7** | Sentry unresolved `TypeError: fetch failed` (06:38 UTC) | Watch — no recent `error_events` spike |
| **OPS-8** | Prod browser RTH UI sweep | Needs real premium Clerk session for soft-nav / SSE / Largo QA |

## ✅ Closed (2026-06-29 audit line)

| ID | Issue | Resolution |
|---|---|---|
| **P0 track-record** | `/api/track-record` disagreed with public ledger | **CLOSED #47** — `buildTrackRecordPagePayload()` from play ledger; smoke guard in `gha-http-smoke.mjs` |
| **P0 admin leaks** | Weak guards on debug/migration routes | **CLOSED #27** — `requireAdminApi()` |
| **P1-A** | Market-Regime-Detector cron not provisioned | **CLOSED** — Railway live; writes `market_regime` |
| **P1-B** | `/api/signals/open` unauthenticated | **CLOSED** — cron auth at route |
| **P1 GHA off-hours** | Deep audit false-failed on Postgres writer checks after close | **CLOSED #52 + #50** — skip off RTH |
| **P2-C** | SPX play ledger empty | **CLOSED** — Mon RTH BUY verified |
| **P2-D** | Options-socket off-hours 1006 loop | **CLOSED** — RTH-gated |
| **P2 provider monitoring gap** | Provider API errors visible in UI but no incident reconcile | **CLOSED** — `provider-health-reconcile` cron + admin Error Sink panel |
| **P2 error_events blind spot** | Durable errors had API route but no admin UI | **CLOSED** — Operations tab Error Sink panel |
| **P2 grid / regime / vendor / auth** | Various | **CLOSED** — see prior session table in git history |
| **P3 RTH automation** | Missing GitHub scheduled smokes | **CLOSED #46 + #50** — full weekday schedule + deploy smoke |
| **P3 audit SKILL drift** | Stale external probe paths | **CLOSED in-repo** — `AUDIT-SKILL-REFERENCE.md` + `.cursor/skills/platform-audit/SKILL.md` |

## 🔵 Remaining (ops / watch — not code bugs)

| ID | Item | Action |
|---|---|---|
| **OPS-1** | **`provider-health-reconcile` Railway service** | **DONE** — service live, TOML wired (`*/10 11-21 * * 1-5`), CRON_SECRET set |
| **OPS-2** | **`CRON_WATCHDOG_SELF_HEAL=1`** on `blackout-web` | **DONE** — set on Railway `blackout-web` |
| **OPS-3** | **Night Hawk edition cron** | Watch `nighthawk-playbook` during evening window; draft fixes in PR #56 |
| **OPS-4** | **`signal_outcomes` table** | Dead path after #47; optional schema cleanup |
| **OPS-5** | **External Cursor Cloud audit configs** | Copy from `.cursor/skills/platform-audit/SKILL.md` if tasks live outside this repo |

## Verified GREEN (2026-06-29 23:00 ET)

| Check | Result |
|---|---|
| `node scripts/gha-http-smoke.mjs` (prod) | ✅ track-record 3=3, SPX desk live |
| RTH deep audit (scheduled + manual) | ✅ GREEN |
| RTH post-close smoke + Sentry | ✅ token valid |
| Deploy smoke on `main` push | ✅ GREEN |
| GitHub secrets | ✅ CRON_SECRET, POLYGON, DATABASE, CURSOR, SENTRY |

## Scheduled automations (weekdays ET)

| Time | Job |
|---|---|
| on `main` push | Deploy smoke |
| 09:30 | Pre-open smoke |
| 09:32 | Cloud Agent launch |
| 09:35 | Prod smoke |
| 10:00 / 14:00 / 16:30 | Deep audit |
| 17:15 | Post-close smoke |
| every 20m | Ops auto-fix collector (#55) |
| Railway RTH | data-correctness, data-integrity, **provider-health-reconcile**, writers, watchdog |
