# Blackout — Implementation Fix Briefs (Master)

> **Master file:** `blackout-web/audits/FIX-BRIEFS.md`  
> **Engine companion:** `BlackOut-Uw-Alerts/audits/FIX-BRIEFS.md` (pointer)  
> **Generated:** 2026-06-19 · **Do not commit** per audit workflow  
> **Source:** All `AUDIT-SUMMARY.md` + `AUDIT-*.md` batch files (both repos)

---

## Recommended global fix order (merged, ~15 items)

1. **ND-C1** — Fix swing embed `_SEP` crash (engine production blocker)
2. **C1 + C2** — Clear stale SPX play UI; reset sticky desk structure (website member-facing)
3. **B06-H1 + B06-H3 + B06-H5** — Single SPX evaluator writer + advisory lock + atomic session meta
4. **B06-H2** — Transactional `insertOpenSpxPlay`; skip side effects on 23505
5. **ND-C2 + ND-H1 + ND-H2** — Wire A+ confluence gate; fix earnings filters (engine + evening)
6. **C06-01** — Fix MTF breakout window math (`mtf_levels.py`)
7. **H1** — Gate or strip `GET /api/market/health` (website ops exposure)
8. **DISC-F-01–04** — Enforce `DISCORD_COMMS_ONLY` on probes, commands, microservices
9. **WEB-001 + WEB-002** — Header auth only; fail closed without secret (engine API)
10. **F02-001** — Fix UW flow poll cursor to max batch timestamp
11. **B06-H6** — Stop admin Live tab auto-eval / 10s poll
12. **TST-F06 + TST-F05** — Fix 4 pytest failures + broken `smoke_events.py`
13. **H2 / F1** — Rotate + redact Polygon key prefix in docs
14. **B2-01** — Wire `fetchPriorDayCloses` into `buildSpxDesk` breadth
15. **SPX-F-07 + SPX-F-19** — Debounce desk WATCH+BUY; dedupe poll vs WS alerts

---

## Executive index

| ID | Title (short) | Sev | Repo | Effort | Tier |
|----|---------------|-----|------|--------|------|
| **C1** | Stale BUY/HOLD hero after session | Critical | Website | S | P0 |
| **C2** | Sticky `lastGoodStructure` cache | Critical | Website | S | P0 |
| **ND-C1** | Swing embed `NameError: _SEP` | Critical | Engine | S | P0 |
| **ND-C2** | A+ confluence gate never wired | Critical | Engine | M | P0 |
| **C06-01** | MTF breakout flags never fire | Critical | Engine | S | P0 |
| **TST-COV** | Core alert paths untested | Critical | Engine | L | P0 |
| **H1** | Unguarded `market/health` telemetry | High | Website | S | P1 |
| **H2** / **F1** | Polygon key prefix in docs | High | Website | S | P1 |
| **B06-H1** | 4-path uncoordinated evaluator | High | Website | L | P1 |
| **B06-H2** | Non-transactional `insertOpenSpxPlay` | High | Website | M | P1 |
| **B06-H3** | No cron overlap lock | High | Website | S | P1 |
| **B06-H4** | Per-process play-engine heartbeat | High | Website | M | P1 |
| **B06-H5** | Session meta last-write-wins | High | Website | M | P1 |
| **B06-H6** | Admin Live auto-polls evaluator | High | Website | S | P1 |
| **B06-H7** | Telemetry URLs expose API keys | High | Website | M | P1 |
| **B06-H8** | `consumeWatchRecord` ordering | High | Website | M | P1 |
| **MED-3** | Engine proxy allows free tier | Medium | Website | S | P1 |
| **DISC-F-01** | Deploy probe bypasses comms-only | High | Engine | S | P1 |
| **DISC-F-02** | Manual commands bypass comms-only | High | Engine | M | P1 |
| **DISC-F-03** | SPX slash cmds bypass comms-only | High | Engine | M | P1 |
| **DISC-F-04** | Microservices ignore comms-only | High | Engine | M | P1 |
| **WEB-001** | Query-string-only API auth | High | Engine | M | P1 |
| **WEB-002** | `ALLOW_NO_AUTH` bypass | High | Engine | S | P1 |
| **WEB-003** | Open Largo agent endpoint | High | Engine | M | P1 |
| **OPS-001** | Stack traces in Discord ops | High | Engine | M | P1 |
| **OPS-002** | Web server always started | High | Engine | S | P1 |
| **F02-001** | Flow poll cursor advances to oldest | High | Engine | S | P1 |
| **F02-004** | 2–4× GEX per ideal alert | High | Engine | M | P1 |
| **ND-H1** | Night Hawk missing earnings gate | High | Engine | M | P1 |
| **ND-H2** | Evening swing earnings filter dead | High | Engine | M | P1 |
| **ND-H3** | Options positioning always long | High | Engine | S | P1 |
| **ND-H4** | Leader lock split-brain w/o DB | High | Engine | M | P1 |
| **ND-H5** | `!add` ignored for scan universe | High | Engine | M | P1 |
| **ND-SP1** | Night Hawk dedup in-memory only | High | Engine | M | P1 |
| **C06-02** | Chart 20D breakout broken | High | Engine | S | P1 |
| **C06-03** | `trigger_evening_plays.py` broken | High | Engine | S | P1 |
| **C06-04** | Macro hard block needs warm cache | High | Engine | M | P1 |
| **C06-05** | Macro time format mismatch | High | Engine | M | P1 |
| **C06-SP01** | Macro hard block ignores NFP/PPI/GDP | High | Engine | M | P1 |
| **SP-01** | Three session clock divergence | High | Engine | M | P1 |
| **SPX-F-01** | Silent unified entry gate blocks | High | Engine | S | P1 |
| **SPX-F-07** | Desk WATCH+BUY same tick | High | Engine | M | P1 |
| **SPX-F-19** | Poll + WS dual emit | High | Engine | M | P1 |
| **TST-F06** | Pytest suite not green (4 fails) | High | Engine | M | P1 |
| **TST-F05** | `smoke_events.py` broken | High | Engine | S | P1 |
| **TST-F01–04** | No tests: alerts/engine/flow/ND | High | Engine | L | P1 |
| **B06-M1–M17** | SPX desk/admin mediums (17) | Medium | Website | — | P2 |
| **B2-01–03** | Provider desk/breadth/halt gaps | Medium | Website | — | P2 |
| **B5-01–08** | Largo prefetch/tool issues | Medium/Low | Website | — | P2/P3 |
| **NH-M1/M2** | Swing/leap filters; hunt tech gate | Medium | Website | M | P2 |
| **MED-1/2** | Session cache; docs tier gap | Medium | Website | S | P2 |
| **F2–F4** | Public playbook; docs auth; .env | Medium | Website | S | P2 |
| **API-M1/M2** | Cron auth dup; engine proxy tier | Medium | Website | S | P2 |
| **F02-005–020** | Flow dup/timezone/rate (16) | Med/Low/Info | Engine | — | P2/P3/P4 |
| **ND-M1–M8** | Name desk mediums (8) | Medium | Engine | — | P2 |
| **ND-SP2–SP5** | Evening timeout; EOD claim; etc. | Medium | Engine | — | P2 |
| **C06-06–17** | MTF/macro/scripts/docs (12) | Med/Low | Engine | — | P2/P3 |
| **SPX-F-02–23** | SPX scalper mediums/lows | Med/Low | Engine | — | P2/P3 |
| **SP-02–12** | SPX cross-cutting notes | Med/Low/Info | Engine | — | P2/P3/P4 |
| **WEB-004–010** | Health/CORS/rate/WS/session | Med/Low | Engine | — | P2/P3 |
| **DB-001/002** | `get_pool` await; raw_payload | Medium | Engine | S | P2 |
| **DISC-F-05–16** | Discord config med/lows | Med/Low | Engine | — | P2/P3 |
| **TST-F07–28** | Test quality gaps | Med/Low | Engine | — | P2/P3 |
| **B06-L1–L10** | SPX UI/cache polish | Low | Website | — | P3 |
| **S3-01–05** | Provider edge lows | Low | Website | — | P3 |
| **NH-LM1/L1–L5** | Night Hawk filter/embed lows | Low | Website | — | P3 |
| **LOW-1–3** | Whop grace; sync; JWT lag | Low | Website | — | P3 |
| **F5–F7** | Security headers; TV iframe; strict | Low | Website | — | P3 |
| **API-L1–L4** | API route observations | Low | Website | — | P3 |
| **F8/F9** | Railway deploy info | Info | Website | — | P4 |
| **F02-003/010/019/020** | Flow info/deferred | Info | Engine | — | P4 |
| **CODE-001/002** | ai_summary nits | Low | Engine | — | P3 |

*Effort: **S** ≤1 day · **M** 2–5 days · **L** >1 week*

---

## P0 — Ship blockers

*Critical + member-facing wrong signals / crashes. Website first, then Engine.*

### Website

### [C1] — Stale BUY/HOLD hero after session ends · Critical · Website

**Files:** `src/components/SpxTradeAlerts.tsx` (~196–211), `src/hooks/useSpxPlay.ts` (~51–70)

**Problem:** When `sessionActive=false`, polling stops but SWR cache still shows the last BUY/HOLD play. Members may act on a morning signal after RTH while header shows OFFLINE.

**Root cause:** `mergePlayWithCache` + `sessionStorage` persist play without clearing on session end; hero renders when `play != null` regardless of `live`.

**Fix:**
1. In `useSpxPlay`, when `!sessionActive`, call `clearPlayCache()` and return `play: null`.
2. Gate hero in `SpxTradeAlerts` on `live && sessionActive`.
3. Add explicit “session ended” empty state; scope cache key by ET `session_date`.
4. Depends on **B06-M13** for full cache hygiene.

**Test:** Load dashboard during RTH, reload at 4:30pm ET — hero must be empty, not morning BUY.

**Effort:** S

---

### [C2] — Sticky structure cache never resets · Critical · Website

**Files:** `src/lib/spx-desk-merge.ts` (~64–116, 205–220)

**Problem:** Module-level `lastGoodStructure` carries prior-session HOD/LOD/VWAP across days. Wrong ladder levels and play-engine inputs after overnight SPA or pulse gaps.

**Root cause:** `lastGoodStructure` is module-scoped with no reset on `session_date` change or ET midnight.

**Fix:**
1. Store `lastGoodStructureSessionDate` alongside cache; clear when `session_date !== todayEt()`.
2. Add TTL-bound sticky fallback (e.g. 30m) instead of indefinite carry.
3. Export `resetSpxDeskMergeCache()`; call from `useMergedDesk` on date change.

**Test:** Overnight tab open + pulse lane down at open → structure levels match today’s REST, not yesterday.

**Effort:** S

---

### Engine

### [ND-C1] — Swing embed crashes (`NameError: _SEP`) · Critical · Engine

**Files:** `evening_plays.py` (~1247), `_build_play_embed` (~758)

**Problem:** Phase 9 swing alerts raise `NameError` — no swing cards posted to Discord after qualifying evening run.

**Root cause:** `_build_swing_embed` references module-level `_SEP` but `_SEP` is only defined locally inside `_build_play_embed`.

**Fix:**
1. Add module constant `_EMBED_SEP = "\u200b"` (zero-width space) at top of `evening_plays.py`.
2. Replace `_SEP` references in `_build_swing_embed` with `_EMBED_SEP`.
3. Share constant with `_build_play_embed` to avoid drift.

**Test:** `pytest` unit: `_build_swing_embed({...}, 1)` renders fields without exception.

**Effort:** S

---

### [ND-C2] — A+ confluence gate never wired to auto BUY · Critical · Engine

**Files:** `name_desk/confluence_gate.py` (~80), `name_desk/engine.py` (~457)

**Problem:** Auto-scan fires A+ Weekly BUY on score alone, ignoring hard A+ rules (no soft 15m, min technical/flow, trend alignment). False-positive entries.

**Root cause:** `check_top_tier_confluence` exists but `engine.py` only calls `check_gates`, never confluence.

**Fix:**
1. Before `check_gates`, when `route_mode(event.score) == "a_plus"`, call `check_top_tier_confluence(event, session)`.
2. On failure, route to WATCH with confluence reason string.
3. Add integration test in `test_name_desk_confluence_gate.py` pass-path.

**Test:** A+ score + `confirm.soft_5m=True` → WATCH, not BUY.

**Effort:** M

---

### [C06-01] — MTF breakout flags never fire · Critical · Engine

**Files:** `mtf_levels.py` (~74–78)

**Problem:** `broke_resistance` / `broke_support` always false. Largo MTF bonuses, cascade scoring, and AI prompts never see real breakouts.

**Root cause:** Resistance window includes current bar high; `close > max(high)` is logically impossible.

**Fix:**
1. Compute `resistance = df.iloc[:-1]["high"].max()` (exclude current bar).
2. Same for support with prior lows.
3. Mirror fix in `chart_technicals.py` (**C06-02**).

**Test:** Synthetic OHLCV where last close clears prior 20-bar high → `broke_resistance is True`.

**Effort:** S

---

### [TST-COV] — Core Discord post paths untested · Critical · Engine

**Files:** `spx_scalper/alerts.py`, `spx_scalper/engine.py`, `flow.py`, `name_desk/gates.py` (gaps)

**Problem:** 325/329 pytest pass gives false confidence. Production alert wiring (engine tick → Discord post) has zero coverage; regressions ship silently.

**Root cause:** Tests cover decision math helpers only, not `alerts.py` post path or `engine.py` poll loop.

**Fix:**
1. Add mocked-Discord integration test: synthetic session → `post_structure_event` called with expected action.
2. Add flow fixture: UW row → dedup → insert → RTH gate → mock post.
3. Add Name Desk path: detector + gates + kill_switches → mock alert.
4. Fix **TST-F05/F06** first to restore CI signal.

**Test:** New tests pass; `python -m pytest tests/ -q` green.

**Effort:** L

---

## P1 — High

*Auth, concurrency, alert integrity. Website first, then Engine.*

### Website

### [H1] — Unguarded `market/health` ops telemetry · High · Website

**Files:** `src/app/api/market/health/route.ts`, `src/lib/market-health.ts`

**Problem:** Anonymous callers get DB pool stats, WS health, rate limits, play-engine state (`open_play`, `session_meta`, `last_signal`). Infrastructure recon + live trading posture exposed.

**Root cause:** Route has no auth gate; returns full `buildMarketHealthSnapshot()`.

**Fix:**
1. Option A: `requireAdminApi()` on route.
2. Option B: Public route returns `{ ok, as_of }` only; move rich snapshot to `/api/admin/health`.
3. Strip provider error bodies from public response (**B06-M16**).

**Test:** Unauthenticated `GET /api/market/health` → 401 or minimal JSON without `open_play`.

**Effort:** S

---

### [F1] — Polygon API key prefix in docs (Frontend batch) · High · Website

**Files:** `src/app/docs/api-probe/page.tsx` (~31, ~1209)

**Problem:** Same as **H2** — committed Polygon key prefix in engineering docs; visible to free-tier signed-in users via **F3** gap.

**Root cause:** Hard-coded probe example in tracked source.

**Fix:**
1. See **H2** — redact and rotate key.
2. Close **F3** docs tier gate to limit exposure.

**Test:** Same as **H2**.

**Effort:** S

---

### [H2] — Polygon API key prefix committed in docs · High · Website

**Files:** `src/app/docs/api-probe/page.tsx` (~31, ~1209)

**Problem:** Real key prefix `AUEJ8r_...` in tracked source. Aids offline guessing; appears in forks/CI. Free-tier signed-in users can read via **F3** gap.

**Root cause:** Hard-coded probe example string committed to git.

**Fix:**
1. Replace with `POLYGON_API_KEY=<redacted>` everywhere in file.
2. Rotate Polygon production key if prefix matches live key.
3. Grep repo for remaining key material.

**Test:** `rg 'AUEJ8r_'` returns zero; probe page renders with redacted placeholder.

**Effort:** S

---

### [B06-H1] — Evaluator invoked from 4 uncoordinated paths · High · Website

**Files:** `src/lib/spx-play-engine.ts`, `src/app/cron/spx-evaluate/route.ts`, `src/lib/admin-spx-dashboard.ts`, `src/app/api/market/spx/play/route.ts`, `src/lib/platform/spx-service.ts`

**Problem:** `evaluateSpxPlay` mutates DB, Discord, signal log from cron, admin live, market GET, and Largo — races duplicate opens, notifications, meta corruption.

**Root cause:** No single-writer pattern; read paths call side-effecting evaluator.

**Fix:**
1. Cron (or dedicated worker) = only mutation path.
2. Read routes return snapshot from DB/cache without evaluating.
3. Wrap mutation in `pg_try_advisory_lock(hashtext('spx-evaluate'))`.
4. Depends **B06-H3**, **B06-H5**.

**Test:** Parallel cron + market GET → only one open play per session; no duplicate Discord.

**Effort:** L

---

### [B06-H2] — `insertOpenSpxPlay` non-transactional · High · Website

**Files:** `src/lib/db.ts` (~848–886), `src/lib/spx-play-engine.ts`

**Problem:** On unique violation 23505, returns existing id but engine still runs `recordBuy` / Discord / notify side effects.

**Root cause:** Close UPDATE and INSERT are separate queries, not one transaction.

**Fix:**
1. Wrap close+insert in `BEGIN … COMMIT`.
2. Return `{ id, created: boolean }`.
3. Skip buy telemetry when `created === false`.

**Test:** Concurrent BUY ticks → one Discord notify, one signal log row.

**Effort:** M

---

### [B06-H3] — No cron overlap lock · High · Website

**Files:** `src/app/cron/spx-evaluate/route.ts` (~42–55)

**Problem:** Multi-instance Railway + ~5m schedule allows concurrent evaluations clobbering play state.

**Root cause:** `logCronRun` only — no skip-if-running or advisory lock.

**Fix:**
1. Acquire `pg_try_advisory_lock` at route start; return 409/skipped if held.
2. Optional: min interval since last successful run in `cron_job_runs`.

**Test:** Two instances hit route same minute → one runs, one logs skip.

**Effort:** S

---

### [B06-H4] — Play-engine heartbeat per-process only · High · Website

**Files:** `src/lib/play-engine-heartbeat.ts` (~1–24)

**Problem:** Admin cron-health shows healthy while no instance ticks, or misses stale replicas.

**Root cause:** `lastTickAt` / `tickCount` are module globals, not persisted.

**Fix:**
1. Persist last tick to `platform_meta` or `cron_job_runs` on each `recordPlayEngineTick`.
2. Treat in-memory values as read-through cache only.

**Test:** Kill all evaluators → admin health shows stale within `stale_after_min`.

**Effort:** M

---

### [B06-H5] — Session meta last-write-wins · High · Website

**Files:** `src/lib/spx-play-store.ts` (~72–100)

**Problem:** Concurrent evaluators overwrite `last_sell_at`, `last_stop_at` — cooldown/re-entry gates break.

**Root cause:** Read/modify/write single JSON blob without versioning or locking.

**Fix:**
1. Serialize behind **B06-H3** advisory lock, OR
2. Use atomic `jsonb_set` with optimistic CAS on version field.

**Test:** Parallel evaluators after SELL → `last_sell_at` preserved; re-entry lock enforced.

**Effort:** M

---

### [B06-H6] — Admin Live tab auto-runs evaluator every 10s · High · Website

**Files:** `src/components/admin/AdminSpxDashboard.tsx` (~840–852), `src/lib/admin-spx-dashboard.ts` (~180)

**Problem:** Entering Live tab triggers `load(true)` + 10s interval — production mutations and heartbeat noise without operator confirm.

**Root cause:** `useEffect` auto-calls `load(live)` when `section === "live"`, bypassing `ConfirmModal`.

**Fix:**
1. Remove auto `load(true)` on tab enter.
2. Never poll with `live=1`; use read-only desk refresh on interval.
3. Require `ConfirmModal` for every live evaluation.

**Test:** Open Live tab → no `evaluateSpxPlay` until operator confirms once.

**Effort:** S

---

### [B06-H7] — Telemetry UI exposes API keys in URLs · High · Website

**Files:** `src/components/admin/AdminApiEventDetail.tsx` (~115–135), `src/lib/admin-api-dashboard.ts`

**Problem:** Raw `request_url` rendered; Polygon probes embed `apiKey=` in query strings visible to admins (and persisted).

**Root cause:** No redaction before persist or display.

**Fix:**
1. Extend `api-tracked-fetch` scrubber: strip `apiKey`, `token`, `key` query params.
2. Redact on persist (`api-telemetry-persist.ts`) and on render.

**Test:** Probe Polygon → admin event detail shows `apiKey=[REDACTED]`.

**Effort:** M

---

### [B06-H8] — `consumeWatchRecord` ordering bug · High · Website

**Files:** `src/lib/spx-play-watch.ts` (~86–94)

**Problem:** Marks memory consumed before DB load completes; DB-off never persists flag; can double-promote or skip persistence.

**Root cause:** In-memory flag set before async `loadWatchRecord`; race on concurrent promotes.

**Fix:**
1. Persist `consumed` flag first (or in same TX as promote).
2. Fix load ordering: load → validate → mark consumed.
3. CAS on watch meta for concurrent promotes. Depends **B06-H1**.

**Test:** DB-off path persists consumed; concurrent promotes → single entry.

**Effort:** M

---

### [MED-3] — Engine proxy allows free tier · High · Website *(paywall integrity)*

**Files:** `src/app/api/engine/[...path]/route.ts` (~24)

**Problem:** Any signed-in free user proxies credentialed engine requests (`nighthawk/plays`, `heatmap`) via server `DASHBOARD_API_SECRET`.

**Root cause:** `authorizeCronOrTierApi(req, "free")` minimum tier too low.

**Fix:**
1. Change to `authorizeCronOrTierApi(req, "premium")`.
2. Confirm product intent for cron-only exceptions.

**Test:** Free-tier `GET /api/engine/nighthawk/plays` → 403; premium → 200.

**Effort:** S

---

### Engine

### [DISC-F-01] — Deploy health probe bypasses comms-only · High · Engine

**Files:** `bot.py:518-521, ops_monitor.py:102-122`

**Problem:** Startup probes all vendor APIs when DISCORD_COMMS_ONLY=1.

**Root cause:** post_deploy_health_report unconditional in on_ready.

**Fix:**
1. Guard with is_discord_comms_only() or Postgres-only deploy card

**Test:** Comms-only boot → zero vendor HTTP

**Effort:** S

---

### [DISC-F-02] — Manual commands bypass comms-only · High · Engine

**Files:** `bot.py:117-240, 54-95`

**Problem:** !gex/!flow/!spxpulse hit vendors on demand in comms-only.

**Root cause:** No is_discord_comms_only() on command handlers.

**Fix:**
1. Return comms-only message or gate all vendor commands

**Test:** Comms-only + !gex → no UW HTTP

**Effort:** M

---

### [DISC-F-03] — SPX slash commands bypass comms-only · High · Engine

**Files:** `bot.py:639-722`

**Problem:** /pulse /premarket fetch Polygon/UW/Claude without guard.

**Root cause:** Sniper commands registered regardless of mode.

**Fix:**
1. Guard handlers when comms-only

**Test:** Comms-only /premarket → no vendor calls

**Effort:** M

---

### [DISC-F-04] — Microservices ignore DISCORD_COMMS_ONLY · High · Engine

**Files:** `services/flow_ingest.py, market_intel.py, spx_scalper.py`

**Problem:** Split deploy still polls when comms-only set on discord service.

**Root cause:** Microservice entrypoints lack flag check.

**Fix:**
1. Check flag in main.py branches OR document ops requirement

**Test:** flow-ingest + comms-only → documented behavior

**Effort:** M

---

### [WEB-001] — Query-string-only API auth · High · Engine

**Files:** `web_server.py:343-345`

**Problem:** Keys in proxy logs, Referer, WS handshake.

**Root cause:** _auth() only checks Query key; header documented but missing.

**Fix:**
1. Implement X-Blackout-Key header auth; deprecate query on REST

**Test:** Header auth without query → 200

**Effort:** M

---

### [WEB-002] — DASHBOARD_ALLOW_NO_AUTH bypass · High · Engine

**Files:** `web_server.py:40-44`

**Problem:** All endpoints public if secret unset + opt-in.

**Root cause:** Fail-open for local dev not blocked in prod.

**Fix:**
1. Refuse start when ALLOW_NO_AUTH + RAILWAY_ENVIRONMENT

**Test:** Prod + ALLOW_NO_AUTH → exit error

**Effort:** S

---

### [WEB-003] — Open Largo agent endpoint · High · Engine

**Files:** `web_server.py:404-410`

**Problem:** Stolen key → Anthropic/UW cost amplification.

**Root cause:** Same key gates Largo as read endpoints.

**Fix:**
1. Separate key tier, rate limits, LARGO_API_ENABLED kill-switch

**Test:** Rate limit → 429

**Effort:** M

---

### [OPS-001] — Stack traces in Discord ops · High · Engine

**Files:** `api_alerts.py:115-117`

**Problem:** Ops embeds may leak secrets from tracebacks.

**Root cause:** format_exc posted verbatim.

**Fix:**
1. Redact DATABASE_URL, *_API_KEY before send

**Test:** Test exception → redacted embed

**Effort:** M

---

### [OPS-002] — Web server always started · High · Engine

**Files:** `bot.py:972-973`

**Problem:** FastAPI always on 0.0.0.0:8080.

**Root cause:** Unconditional create_task(start_web_server).

**Fix:**
1. DASHBOARD_ENABLED=1 opt-in

**Test:** No flag → no listener 8080

**Effort:** S

---

### [F02-001] — Flow poll cursor oldest row · High · Engine

**Files:** `flow.py:2551-2577`

**Problem:** Re-polls processed alerts; UW quota burn.

**Root cause:** Cursor = rows[-1] when API newest-first.

**Fix:**
1. Set cursor to max(created_at) across batch

**Test:** Newest-first fixture → newest cursor

**Effort:** S

---

### [F02-004] — 2-4x GEX per ideal alert · High · Engine

**Files:** `flow_0dte_talon.py, flow.py`

**Problem:** Talon re-fetches spot-exposures despite flow cache.

**Root cause:** flow_0dte_talon bypasses _GEX_VEX_CACHE.

**Fix:**
1. Share cache; pass enriched gv_data into Talon

**Test:** One spot-exposures call per ticker per alert

**Effort:** M

---

### [ND-H1] — Night Hawk missing earnings gate · High · Engine

**Files:** `night_hawk_scanner.py:269-295`

**Problem:** Swing alerts into earnings despite doc criteria.

**Root cause:** _qualifies never checks earnings.

**Fix:**
1. Call evaluate_earnings_proximity; block days_until<=1

**Test:** Earnings tomorrow → not qualified

**Effort:** M

---

### [ND-H2] — Evening swing earnings filter dead · High · Engine

**Files:** `evening_plays.py:1116-1121`

**Problem:** tomorrow_earnings never on dossier dict.

**Root cause:** Filter checks wrong key; data at market level only.

**Fix:**
1. Pass tomorrow_earn into _find_swing_candidates

**Test:** Earnings name excluded from swing scan

**Effort:** M

---

### [ND-H3] — Options positioning always long · High · Engine

**Files:** `night_hawk_scanner.py:248`

**Problem:** Short setups get long OI credit.

**Root cause:** direction arg omitted in score_options_positioning.

**Fix:**
1. Pass direction=direction.lower()

**Test:** Bearish + put OI scores correctly

**Effort:** S

---

### [ND-H4] — Leader lock split-brain without DB · High · Engine

**Files:** `name_desk/leader_lock.py`

**Problem:** Duplicate BUY/WATCH from multiple replicas.

**Root cause:** acquire_leader True when !db_ready; is_leader_holder False.

**Fix:**
1. acquire_leader False until DB ready + lease

**Test:** No DB → no scan loop

**Effort:** M

---

### [ND-H5] — !add ignored for scan universe · High · Engine

**Files:** `name_desk/universe.py:30-32`

**Problem:** Custom watchlist not scanned.

**Root cause:** scan_tickers returns CORE_WATCHLIST only.

**Fix:**
1. Use watchlist.list_tickers capped by max_tickers

**Test:** Added ticker in scan cycle

**Effort:** M

---

### [ND-SP1] — Night Hawk dedup in-memory only · High · Engine

**Files:** `night_hawk_scanner.py:585-598`

**Problem:** Restart same day re-alerts tickers.

**Root cause:** _POSTED_TODAY module set only.

**Fix:**
1. Persist posted keys to DB/Redis

**Test:** Restart → no duplicate post

**Effort:** M

---

### [C06-02] — Chart 20D breakout broken · High · Engine

**Files:** `chart_technicals.py:149-153`

**Problem:** broke_range_high never true on breakout day.

**Root cause:** Inclusive window includes current bar.

**Fix:**
1. Use prior 19 bars for range extrema

**Test:** Close above prior 19d high → true

**Effort:** S

---

### [C06-03] — trigger_evening_plays.py broken · High · Engine

**Files:** `scripts/trigger_evening_plays.py`

**Problem:** Manual trigger cannot import env.

**Root cause:** import env vs env_config; wrong token name.

**Fix:**
1. import env_config; use UW_DISCORD_TOKEN

**Test:** Script runs with valid .env

**Effort:** S

---

### [C06-04] — Macro hard block needs warm cache · High · Engine

**Files:** `macro_calendar.py:270-306`

**Problem:** No CPI/FOMC block on cold start.

**Root cause:** _MACRO_CACHE empty → sync returns None.

**Fix:**
1. Eager warmup on bootstrap; sync Finnhub fallback

**Test:** Cold cache + CPI soon → block reason

**Effort:** M

---

### [C06-05] — Macro time format mismatch · High · Engine

**Files:** `macro_calendar.py:77-79, name_desk/gates.py`

**Problem:** NAME_DESK macro gate never blocks.

**Root cause:** HH:MM time fails ISO parse in gates.

**Fix:**
1. Export _event_datetime_et or store ISO in rows

**Test:** 08:30 event blocks ±30m

**Effort:** M

---

### [SP-01] — Three session clock divergence · High · Engine

**Files:** `market_hours.py, session.py, engine.py`

**Problem:** Journal vs Discord misaligned under GTH configs.

**Root cause:** Different session functions per layer.

**Fix:**
1. Document config triplets; integration test alignment

**Test:** GTH+RTH-only → expected behavior verified

**Effort:** M

---

### [SPX-F-01] — Silent unified entry gate blocks · High · Engine

**Files:** `spx_scalper/alerts.py:842-856`

**Problem:** BUY blocked with console only.

**Root cause:** No post_entry_blocked_notice on gate failure.

**Fix:**
1. Post blocked notice for high-score setups

**Test:** Cooldown block → Discord notice

**Effort:** S

---

### [SPX-F-07] — Desk WATCH+BUY same tick · High · Engine

**Files:** `spx_scalper/desk_entry.py:479-512`

**Problem:** Back-to-back WATCH and BUY cards.

**Root cause:** maybe_emit_desk_entry posts both unconditionally.

**Fix:**
1. Skip WATCH when BUY will post same tick

**Test:** Starter → single alert type

**Effort:** M

---

### [SPX-F-19] — Poll + WS dual emit · High · Engine

**Files:** `spx_scalper/engine.py:1321-1334`

**Problem:** Duplicate structure alerts intrabar.

**Root cause:** Poll and WS both emit; dedup not unified.

**Fix:**
1. Suppress poll _emit_events when WS enabled

**Test:** WS on → one alert per setup

**Effort:** M

---

### [TST-F05] — smoke_events.py broken · High · Engine

**Files:** `scripts/smoke_events.py:80-81`

**Problem:** Detector smoke crashes AttributeError.

**Root cause:** evaluate returns 3-tuple not unpacked.

**Fix:**
1. Unpack graded, watches, heads = evaluate(...)

**Test:** smoke_events.py exits 0

**Effort:** S

---

### [TST-F06] — 4 pytest failures · High · Engine

**Files:** `tests/test_spx_*.py (4 files)`

**Problem:** CI misleading at 325/329 pass.

**Root cause:** Stale inline tests vs current routing.

**Fix:**
1. Fix/delete failing tests; freeze time in GTH test

**Test:** pytest -q all green

**Effort:** M

---

### [TST-F01] — alerts.py zero coverage · High · Engine

**Files:** `spx_scalper/alerts.py`

**Problem:** Discord post path untested.

**Root cause:** No test imports alerts module.

**Fix:**
1. Mock Discord integration test for post_structure_event

**Test:** New test passes

**Effort:** M

---

### [TST-F02] — engine.py poll loop untested · High · Engine

**Files:** `spx_scalper/engine.py`

**Problem:** Tick→post path untested.

**Root cause:** Only calibration helper tested.

**Fix:**
1. Synthetic session + mock alerts assert post called

**Test:** Engine tick test passes

**Effort:** M

---

### [TST-F03] — flow.py pipeline untested · High · Engine

**Files:** `flow.py`

**Problem:** Ingest→post beyond RTH gate untested.

**Root cause:** Only _flow_discord_allowed_now tested.

**Fix:**
1. UW fixture → dedup → mock post test

**Test:** Flow pipeline test passes

**Effort:** M

---

### [TST-F04] — Name Desk path untested · High · Engine

**Files:** `name_desk/gates.py, detector.py`

**Problem:** gates/kill_switches/detector/lifecycle untested.

**Root cause:** Engine test fully mocked.

**Fix:**
1. Fixture session → gates → mock alert

**Test:** ND path test passes

**Effort:** M

---


## P2 — Medium

*Website first, then Engine.*

### Website

### [B06-M1] — spx_signal_log no DB dedup · Medium · Website

**Files:** db.ts:692-727, providers/spx-signal-log.ts

**Problem:** Concurrent BUY logs duplicate signal rows.

**Root cause:** Append-only insert; cursor check-then-set without TX.

**Fix:**
1. UNIQUE (session_date, action, direction) or (signal_key) + ON CONFLICT DO NOTHING
2. Update cursor in same TX as insert

**Test:** Parallel BUY same action/direction → one row

**Effort:** M

---

### [B06-M2] — THETA exit was_loss always false · Medium · Website

**Files:** spx-play-engine.ts:307-308

**Problem:** Underwater THETA exits skip re-entry lock.

**Root cause:** Hardcoded was_loss: false on force exit.

**Fix:**
1. Derive was_loss from pnl_pts / classifyOutcome before savePlaySessionMeta

**Test:** THETA exit negative PnL → re-entry lock applies

**Effort:** S

---

### [B06-M3] — Promote threshold mismatch · Medium · Website

**Files:** spx-play-engine.ts:524-551

**Problem:** Watch shows eligible then fails adaptive gate — confusing UX.

**Root cause:** evaluateWatchPromote uses playPromoteMinScore(48); adaptive uses 58+.

**Fix:**
1. Pass effectivePromoteMinScore into watch eval after loading adaptive gates

**Test:** Watch eligible UI matches promote outcome

**Effort:** S

---

### [B06-M4] — Macro hard block ignores event time · Medium · Website

**Files:** spx-play-gates.ts:36-58

**Problem:** CPI/FOMC string blocks entire morning regardless of schedule.

**Root cause:** Blocks on macro_events string presence, not datetime.

**Fix:**
1. Filter events by scheduled datetime ±N minutes ET

**Test:** CPI tomorrow does not block today morning

**Effort:** S

---

### [B06-M5] — Fire-and-forget recordPlayEntry · Medium · Website

**Files:** spx-play-engine.ts:758-777

**Problem:** Open play persists; analytics outcome row may never write.

**Root cause:** recordPlayEntry inside void firePlayTelemetry catch.

**Fix:**
1. Await in critical path or retry with incident on failure

**Test:** BUY → open outcome row always present

**Effort:** S

---

### [B06-M6] — Missing unique open spx_play_outcomes · Medium · Website

**Files:** db.ts:966-1017

**Problem:** Duplicate open outcome rows per play.

**Root cause:** No partial unique on open_play_id where outcome=open.

**Fix:**
1. CREATE UNIQUE INDEX ON spx_play_outcomes(open_play_id) WHERE outcome = 'open'

**Test:** Second open outcome insert fails or no-ops

**Effort:** S

---

### [B06-M7] — lotto_plays lacks session+pick unique · Medium · Website

**Files:** db.ts:252-282

**Problem:** Concurrent lotto picks can duplicate same slot.

**Root cause:** Index not unique on (session_date, pick_index).

**Fix:**
1. UNIQUE (session_date, pick_index) or serialize via meta lock

**Test:** Two picks same index → one row

**Effort:** S

---

### [B06-M8] — CRON_SECRET via query string · Medium · Website

**Files:** market-api-auth.ts:8-10, cron/spx-evaluate/route.ts

**Problem:** Secret in cron URL logs/history.

**Root cause:** isCronAuthorized accepts ?secret=.

**Fix:**
1. Bearer header only; reject ?secret= query param

**Test:** Cron with query secret → 401

**Effort:** S

---

### [B06-M9] — Claude DB cache single slot + budget race · Medium · Website

**Files:** spx-play-claude.ts:65-72,278

**Problem:** Budget consumed without verdict; multi-replica races.

**Root cause:** One meta key; budget increment before Anthropic call.

**Fix:**
1. Multi-key cache; atomic budget INCR; increment after success

**Test:** Claude timeout → budget not consumed

**Effort:** M

---

### [B06-M10] — Admin cron health accuracy gaps · Medium · Website

**Files:** admin-cron-health.ts:59-218

**Problem:** False green/stale display; heartbeat override masks quiet cron.

**Root cause:** 48-run cap; stale_after display mismatch; admin live ticks satisfy heartbeat.

**Fix:**
1. Derive health from cron_job_runs + persisted heartbeat; fix display thresholds

**Test:** Broken scheduler shows stale in admin

**Effort:** M

---

### [B06-M11] — health_ok decoupled from issue severity · Medium · Website

**Files:** admin-spx-issues.ts:317-321, admin-health.ts:34-37

**Problem:** Critical desk issues show healthy banner.

**Root cause:** health_ok uses aggregate with play: null.

**Fix:**
1. Derive health_ok from issue counts or pass play snapshot

**Test:** Open play gate failure → health_ok false

**Effort:** S

---

### [B06-M12] — API dashboard provider health flicker · Medium · Website

**Files:** admin-api-dashboard.ts:281-306, AdminApiDashboard.tsx:123-126

**Problem:** Providers flash unhealthy between 8s telemetry and 120s probe.

**Root cause:** probe=false sets ok: false.

**Fix:**
1. Use probe: null when not run; separate telemetry from probe health

**Test:** 8s refresh without probe → no red ring

**Effort:** S

---

### [B06-M13] — 12h sessionStorage caches · Medium · Website

**Files:** useMergedDesk.ts, useSpxPlay.ts, SpxCommentaryRail.tsx

**Problem:** Post-close reload shows prior-session data.

**Root cause:** 12h TTL without session_date scoping.

**Fix:**
1. Scope cache by ET session_date; clear on change
2. Tie to C1 fix

**Test:** session_date change clears desk/play cache

**Effort:** S

---

### [B06-M14] — Play UI decoupled from desk merge · Medium · Website

**Files:** SpxTradeAlerts.tsx:20-25,196

**Problem:** desk prop unused; play from isolated poll.

**Root cause:** No cross-check between visible GEX/price and play levels.

**Fix:**
1. Cross-check play vs desk or remove misleading prop

**Test:** Play levels consistent with desk header

**Effort:** S

---

### [B06-M15] — Cache thundering herd · Medium · Website

**Files:** server-cache.ts, spx-play-technicals.ts, spx-play-options.ts

**Problem:** Concurrent requests duplicate Polygon fetches.

**Root cause:** SWR inflight gap; module caches lack promise dedup.

**Fix:**
1. Inflight promise dedup on SWR gap and module caches

**Test:** 10 parallel desk loads → 1 Polygon fetch

**Effort:** M

---

### [B06-M16] — Telemetry persists unsanitized bodies · Medium · Website

**Files:** api-telemetry.ts, api-telemetry-persist.ts, market-health.ts

**Problem:** API keys in persisted telemetry bodies.

**Root cause:** No scrub before persist.

**Fix:**
1. Scrub apiKey/token before persist
2. Tie to B06-H7

**Test:** Persisted body has no key material

**Effort:** M

---

### [B06-M17] — Multi-instance lotto/watch races · Medium · Website

**Files:** spx-lotto-store.ts, spx-play-watch.ts, spx-lotto-outcomes.ts

**Problem:** Lotto meta and watch state races across replicas.

**Root cause:** Same last-write-wins as B06-H5.

**Fix:**
1. Same advisory lock strategy as B06-H3/H5

**Test:** Two instances → consistent lotto meta

**Effort:** M

---

### [B2-01] — SPX desk breadth uses session-direction A/D · Medium · Website

**Files:** providers/spx-desk.ts:919-940, polygon.ts

**Problem:** Gap-up-fade mornings show wrong pct_advancing on desk + Claude commentary.

**Root cause:** buildSpxDesk calls computeMarketBreadthFromSummary without priorCloseByTicker.

**Fix:**
1. await fetchPriorDayCloses(today) in buildSpxDesk
2. Pass map into computeMarketBreadthFromSummary

**Test:** Stocks gap up, close below open but above prior close → advancing count rises

**Effort:** S

---

### [B2-02] — Trading-halt gate fails open when stale · Medium · Website

**Files:** ws/uw-socket.ts:411-418, spx-play-gates.ts:88-92

**Problem:** Missing halt data treated as safe to trade.

**Root cause:** hasActiveTradingHalt returns false when halts map empty; freshness not checked.

**Fix:**
1. If !isUwChannelFresh(trading_halts, N) during RTH, block entry or REST halt check

**Test:** Stale halts channel → entry blocked

**Effort:** M

---

### [B2-03] — buildSpxDesk bypasses Polygon WS merge · Medium · Website

**Files:** providers/spx-desk.ts:777 vs 1170

**Problem:** Desk vs pulse show different SPX price during fast tape.

**Root cause:** Full desk uses REST only; pulse merges mergeWsIndexSnapshots.

**Fix:**
1. Call ensureDataSockets + mergeWsIndexSnapshots in buildSpxDesk

**Test:** WS-fed index → desk price matches pulse

**Effort:** S

---

### [MED-1] — Session cache not cleared on account switch · Medium · Website

**Files:** SessionCacheGuard.tsx:12-18

**Problem:** User B may see User A cached desk/play for up to 12h.

**Root cause:** Guard watches isSignedIn only, not userId.

**Fix:**
1. Track userId from useAuth(); clearAllSessionCache on userId change

**Test:** Switch Clerk account without sign-out → empty sessionStorage

**Effort:** S

---

### [MED-2] — Middleware auth only; tier per-page · Medium · Website

**Files:** middleware.ts:13-16, docs pages

**Problem:** Free signed-in users read internal api-probe/system-analysis.

**Root cause:** No premium check in middleware for /docs.

**Fix:**
1. Shared docs layout with requireTier(premium) or middleware tier gate

**Test:** Free user /docs/api-probe → redirect /upgrade

**Effort:** S

---

### [F2] — Public SPX playbook docx · Medium · Website

**Files:** public/docs/SPX-Sniper-Playbook.docx, docs/spx-sniper/page.tsx

**Problem:** Full playbook downloadable without auth at /docs/SPX-Sniper-Playbook.docx.

**Root cause:** public/ excluded from Clerk middleware.

**Fix:**
1. Serve via premium API route or remove from public/

**Test:** Unauthenticated docx URL → 401/404

**Effort:** S

---

### [F3] — Inconsistent /docs authorization · Medium · Website

**Files:** middleware.ts, docs layouts

**Problem:** Internal architecture visible to any signed-in user.

**Root cause:** Some docs pages lack requireTier.

**Fix:**
1. Add src/app/docs/layout.tsx with requireTier(premium)

**Test:** Align with polygon/uw docs gating

**Effort:** S

---

### [F4] — .gitignore omits plain .env · Medium · Website

**Files:** .gitignore

**Problem:** Accidental .env commit risk.

**Root cause:** Only .env.local ignored.

**Fix:**
1. Add .env and .env.production to .gitignore

**Test:** Root .env not tracked

**Effort:** S

---

### [API-M1] — Cron auth duplicated inline · Medium · Website

**Files:** 5 cron route.ts files

**Problem:** Future cron route may omit secret check.

**Root cause:** Each re-implements CRON_SECRET vs isCronAuthorized.

**Fix:**
1. Refactor all cron routes to isCronAuthorized(req)

**Test:** Single helper used everywhere

**Effort:** S

---

### [API-M2] — Engine proxy free tier (duplicate MED-3) · Medium · Website

**Files:** api/engine/[...path]/route.ts

**Problem:** See MED-3 — listed for API batch cross-ref.

**Root cause:** Same as MED-3.

**Fix:**
1. premium tier gate

**Test:** Free → 403

**Effort:** S

---

### [NH-M1] — Swing/leap filters not applied server-side · Medium · Website

**Files:** agent-config.ts, hunt-mode.ts

**Problem:** UI filter changes have no effect on runHuntScan.

**Root cause:** normalizeHuntFilters ignores swing/leap-specific fields.

**Fix:**
1. Extend NormalizedHuntFilters + dossierPassesPrefilters for dte_min/max, catalyst

**Test:** Swing dte_max=5 excludes 10 DTE plays

**Effort:** M

---

### [NH-M2] — Hunt drops tech-null dossiers; edition does not · Medium · Website

**Files:** hunt-builder.ts:131 vs edition-builder.ts:201

**Problem:** Flow-strong tickers in evening but absent from hunt agents.

**Root cause:** Hunt requires d.tech != null; edition uses scored != null.

**Fix:**
1. Align gates — allow scored != null in hunt with UI flag

**Test:** Flow-only ticker appears in hunt with tech unavailable badge

**Effort:** M

---

### [B5-01] — SPX desk prefetched on every question · Medium · Website

**Files:** largo-live-feed.ts:40,55-64

**Problem:** Generic questions still prefetch 6 heavy SPX jobs.

**Root cause:** ticker defaults to SPX when tickerHint null.

**Fix:**
1. Gate on intent.tickerHint === SPX || needsSpxDesk || needsPlayState

**Test:** How is CPI? → no get_spx_play prefetch

**Effort:** S

---

### [B5-02] — Live feed fires 10+ parallel tools always · Medium · Website

**Files:** largo-live-feed.ts:42-53

**Problem:** Every Largo turn is expensive multi-provider burst.

**Root cause:** Prefetch ignores getToolsForIntent filtering.

**Fix:**
1. Drive prefetch from LargoQuestionIntent flags only

**Test:** Macro question → market_context + calendar only

**Effort:** M

---

### [B5-03] — Tool loop exhaustion returns stale text · Medium · Website

**Files:** providers/anthropic.ts:202-267

**Problem:** Hitting maxRounds returns mid-reasoning fragment.

**Root cause:** No final no-tools turn after last tool batch.

**Fix:**
1. On exhaustion, one messages.create without tools for final answer

**Test:** Broad multi-tool question → complete user-facing answer

**Effort:** M

---

### [B5-04] — PLAY_STATE_RE over-broad regex · Low-Med · Website

**Files:** intent-keywords.ts:13-14

**Problem:** analysis/outlook trigger SPX play prefetch.

**Root cause:** Pattern matches common words in most questions.

**Fix:**
1. Tighten regex; require SPX/desk context

**Test:** Single-name ticker question → no play prefetch

**Effort:** S

---

### [B5-05] — Embed uses legacy non-streaming terminal · Low · Website

**Files:** embeds/LargoWorkspace.tsx

**Problem:** Dashboard embed lacks SSE/session restore.

**Root cause:** Imports root LargoTerminal not desk/LargoTerminal.

**Fix:**
1. Import desk/LargoTerminal in LargoWorkspace

**Test:** Embed streams tokens like /terminal

**Effort:** S

---

### [B5-06] — buildLargoTechnicals dead export · Low · Website

**Files:** largo/technicals.ts:44-107

**Problem:** Two divergent technical pipelines.

**Root cause:** Never called; run-tool uses polygon-largo MTF.

**Fix:**
1. Remove or wire as MTF fallback

**Test:** Single technical code path

**Effort:** S

---

### [B5-07] — Tool loop hardcodes temperature · Low · Website

**Files:** providers/anthropic.ts:206

**Problem:** Callers cannot tune temperature.

**Root cause:** TEMPERATURE = 0.3 fixed in anthropicToolLoop.

**Fix:**
1. Add optional temperature param

**Test:** Commentary vs Largo can differ

**Effort:** S

---

### [B5-08] — get_analyst_ratings wrong fallback rows · Low · Website

**Files:** largo/run-tool.ts:671-676

**Problem:** Claude may cite other tickers' ratings.

**Root cause:** Returns global screener slice when ticker absent.

**Fix:**
1. Return empty analysts + note when no match

**Test:** Unknown ticker → no foreign ratings

**Effort:** S

---


### Engine

### [ND-M1] — flow_quality UTC date · Medium · Engine

**Files:** `name_desk/flow_quality.py:29-31`

**Problem:** Mis-scores flow near ET midnight.

**Root cause:** date.today() not ET.

**Fix:**
1. Use flow_calendar_day()

**Test:** ET evening → prior session window

**Effort:** S

---

### [ND-M2] — pattern_flow UTC date · Medium · Engine

**Files:** `name_desk/pattern_flow.py:52`

**Problem:** Wrong DTE bucket near midnight.

**Root cause:** as_of = date.today().

**Fix:**
1. Use flow_calendar_day()

**Test:** Same as ND-M1

**Effort:** S

---

### [ND-M3] — Index flow stale rows · Medium · Engine

**Files:** `evening_plays_data.py:118-120`

**Problem:** Undated rows bias dossier.

**Root cause:** Empty created_at passes filter.

**Fix:**
1. Require date match or exclude undated

**Test:** Prior-day row excluded

**Effort:** S

---

### [ND-M4] — Flow streak counts weekends · Medium · Engine

**Files:** `evening_plays_data.py:588-594`

**Problem:** Monday streak understated.

**Root cause:** Calendar day loop no weekday skip.

**Fix:**
1. Count trading days only

**Test:** Fri-Mon flow → streak 2

**Effort:** M

---

### [ND-M5] — WATCH watch_count always 1 · Medium · Engine

**Files:** `name_desk/engine.py:728-739`

**Problem:** Analytics under-count repeats.

**Root cause:** watch_count=1 every upsert.

**Fix:**
1. Increment from DB row

**Test:** Two refreshes → count>=2

**Effort:** S

---

### [ND-M6] — iter_expiries skips weekends · Medium · Engine

**Files:** `name_desk/options_chain.py:49-54`

**Problem:** Friday may omit Mon expiry.

**Root cause:** weekday>=5 continue in loop.

**Fix:**
1. Advance to next weekday per offset

**Test:** Friday includes Monday expiry

**Effort:** S

---

### [ND-M7] — VIX loaded as VIX not I:VIX · Medium · Engine

**Files:** `name_desk/market_context.py:162`

**Problem:** VIX headwind never fires.

**Root cause:** Wrong Polygon symbol.

**Fix:**
1. Load I:VIX index snapshot

**Test:** Non-zero VIX change

**Effort:** S

---

### [ND-M8] — UTC start_time in stock flows · Medium · Engine

**Files:** `evening_plays_data.py:98`

**Problem:** Wrong flow day tag.

**Root cause:** utcfromtimestamp for UW start_time.

**Fix:**
1. Convert epoch to America/New_York date

**Test:** 9PM ET maps correct date

**Effort:** S

---

### [ND-SP2] — settings_store EOD without DB · Medium · Engine

**Files:** `name_desk/settings_store.py:60-62`

**Problem:** Multi replica duplicate EOD fetches.

**Root cause:** Returns True without DB.

**Fix:**
1. Return False when no DB

**Test:** No DB → claim false

**Effort:** S

---

### [ND-SP3] — Evening 10min timeout · Medium · Engine

**Files:** `evening_plays.py:1383`

**Problem:** Heavy day aborts mid-pipeline.

**Root cause:** wait_for 600s timeout.

**Fix:**
1. Increase timeout or resume token

**Test:** Slow Claude completes or logs phase

**Effort:** M

---

### [ND-SP4] — Flow streak exception → {} · Medium · Engine

**Files:** `evening_plays_data.py:603-604`

**Problem:** Silent streak zero on DB error.

**Root cause:** except returns {}.

**Fix:**
1. Log warning; don't treat as zero

**Test:** DB throw → logged not zero

**Effort:** S

---

### [C06-06] — mtf_context DTE UTC · Medium · Engine

**Files:** `mtf_context.py:38-39`

**Problem:** 0DTE misclassified near midnight.

**Root cause:** date.today() UTC.

**Fix:**
1. datetime.now(ET).date()

**Test:** ET boundary DTE correct

**Effort:** S

---

### [C06-07] — chart_mtf wrong snap fallback · Medium · Engine

**Files:** `chart_mtf.py:151-154`

**Problem:** Wrong ticker price in batch.

**Root cause:** Falls back to snaps[0].

**Fix:**
1. Return None if no match

**Test:** MSFT request no AAPL price

**Effort:** S

---

### [C06-08] — Empty country = US macro · Medium · Engine

**Files:** `macro_calendar.py:50`

**Problem:** Non-US rows may enter macro.

**Root cause:** '' in _US_COUNTRIES.

**Fix:**
1. Remove ''; explicit USD rule

**Test:** Blank country handled explicitly

**Effort:** S

---

### [C06-09] — multi_timeframe_analyzer dead · Medium · Engine

**Files:** `multi_timeframe_analyzer.py`

**Problem:** Unused module false confidence.

**Root cause:** Never imported.

**Fix:**
1. Wire or delete

**Test:** CI import graph check

**Effort:** S

---

### [C06-10] — Missing relative_volume · Medium · Engine

**Files:** `chart_technicals.py`

**Problem:** rvol bucket under-rewarded.

**Root cause:** Never sets relative_volume.

**Fix:**
1. Compute vs 20d avg volume

**Test:** 2x vol → bonus

**Effort:** M

---

### [C06-11] — mtf_levels requires volume · Medium · Engine

**Files:** `mtf_levels.py:25-27`

**Problem:** Index bars return empty MTF.

**Root cause:** volume required column.

**Fix:**
1. Synthesize volume=0 for indices

**Test:** H/L/C only bars work

**Effort:** S

---

### [C06-12] — fix_db_errors destructive · Medium · Engine

**Files:** `scripts/fix_db_errors.py`

**Problem:** Accidental db.py mutation.

**Root cause:** Writes db.py in place.

**Fix:**
1. Archive or require --apply

**Test:** No accidental run

**Effort:** S

---

### [SP-02] — BUY gate stack doc · Medium · Engine

**Files:** `spx_scalper/alerts.py`

**Problem:** Steps 5-6 fail silently.

**Root cause:** See SPX-F-01.

**Fix:**
1. Document + blocked notices

**Test:** Ops runbook lists gates

**Effort:** S

---

### [SP-03] — Cooldown namespace fragmentation · Medium · Engine

**Files:** `spx_scalper/*`

**Problem:** Poll vs desk duplicate alerts.

**Root cause:** Five separate cooldown trackers.

**Fix:**
1. Shared setup_key dedup or document

**Test:** Same setup one alert

**Effort:** M

---

### [SP-04] — WATCH invalidation journal-only gap · Medium · Engine

**Files:** `watch_invalidation.py`

**Problem:** Journal WATCH not edited.

**Root cause:** Needs discord_message_id.

**Fix:**
1. Document or persist edit intent

**Test:** Discord-off path documented

**Effort:** S

---

### [SP-05] — SPX_DISCORD_PLAY_ALERTS_ONLY verified · Medium · Engine

**Files:** `discord_visibility.py`

**Problem:** Info — behavior correct.

**Root cause:** Documented.

**Fix:**
1. Keep docs in sync

**Test:** Plays-only mode test

**Effort:** S

---

### [DB-001] — get_pool not awaited · Medium · Engine

**Files:** `web_server.py:155-157`

**Problem:** Flow/play API always empty.

**Root cause:** pool = get_pool() missing await.

**Fix:**
1. pool = await get_pool()

**Test:** Recent flows returns rows

**Effort:** S

---

### [DB-002] — raw_payload in flow detail · Medium · Engine

**Files:** `db.py:4131-4141`

**Problem:** Latent leak if API wired.

**Root cause:** Full UW payload in query.

**Fix:**
1. Strip at API boundary

**Test:** No raw_payload in response

**Effort:** S

---

### [WEB-004] — Unauthenticated /health · Medium · Engine

**Files:** `web_server.py:349-351`

**Problem:** Service fingerprinting.

**Root cause:** Open by design.

**Fix:**
1. Minimal response or health token

**Test:** Health returns ok+ts only

**Effort:** S

---

### [WEB-005] — CORS vercel wildcard invalid · Medium · Engine

**Files:** `web_server.py:334-341`

**Problem:** Preview deploys fail CORS.

**Root cause:** Literal * origin.

**Fix:**
1. allow_origin_regex for vercel.app

**Test:** foo.vercel.app CORS works

**Effort:** S

---

### [WEB-006] — Largo exception to client · Medium · Engine

**Files:** `web_server.py:280-282`

**Problem:** Internal errors in JSON.

**Root cause:** Returns exc string.

**Fix:**
1. Generic client message

**Test:** Client sees generic error

**Effort:** S

---

### [WEB-007] — No API rate limiting · Medium · Engine

**Files:** `web_server.py`

**Problem:** Key leak enables scrape.

**Root cause:** No middleware limits.

**Fix:**
1. Per-key/IP rate limit

**Test:** Burst → 429

**Effort:** M

---

### [WEB-008] — WebSocket auth via query · Medium · Engine

**Files:** `web_server.py`

**Problem:** WS key in URL.

**Root cause:** Same as WEB-001.

**Fix:**
1. Header if possible; short-lived WS token

**Test:** Document WS auth pattern

**Effort:** S

---

### [DISC-F-05] — Misleading startup logs · Medium · Engine

**Files:** `bot.py:390-506`

**Problem:** Logs show polls before comms banner.

**Root cause:** Order of print statements.

**Fix:**
1. Print comms-only status first

**Test:** Comms-only log clear

**Effort:** S

---

### [DISC-F-06] — Comms-only message overstates · Medium · Engine

**Files:** `bot.py:512`

**Problem:** Says no vendor APIs but probes run.

**Root cause:** Inaccurate banner.

**Fix:**
1. Accurate message after F-01 fix

**Test:** Banner matches behavior

**Effort:** S

---

### [DISC-F-07] — Largo commands no comms guard · Medium · Engine

**Files:** `bot.py:728-731`

**Problem:** On-demand Polygon+UW.

**Root cause:** No guard on name_desk cmds.

**Fix:**
1. Gate lookups when comms-only

**Test:** !check comms-only → no fetch

**Effort:** M

---

### [DISC-F-08] — MARKET_INTEL token required · Medium · Engine

**Files:** `bot.py:857-858`

**Problem:** Cannot run trade-only comms.

**Root cause:** Hard exit without intel token.

**Fix:**
1. Optional when comms-only

**Test:** Trade token only boots

**Effort:** M

---

### [DISC-F-09] — README vs Procfile entry · Medium · Engine

**Files:** `README.md, Procfile`

**Problem:** Wrong entrypoint docs.

**Root cause:** bot.py vs main.py.

**Fix:**
1. Update README to main.py

**Test:** Docs match deploy

**Effort:** S

---

### [DISC-F-10] — README missing comms/service env · Medium · Engine

**Files:** `README.md`

**Problem:** Operators miss DISCORD_COMMS_ONLY.

**Root cause:** Undocumented.

**Fix:**
1. Document DISCORD_COMMS_ONLY, BLACKOUT_SERVICE

**Test:** README complete

**Effort:** S

---

### [DISC-F-11] — env_config DISCORD_COMMS_ONLY unused · Medium · Engine

**Files:** `env_config.py:29`

**Problem:** Dual source of truth.

**Root cause:** Guards use discord_comms only.

**Fix:**
1. Centralize on env_config constant

**Test:** Single flag source

**Effort:** S

---

### [F02-005] — get_gex/vex duplicate calls · Medium · Engine

**Files:** `unusual_whales.py:508-588`

**Problem:** !gex+!vex = 2x API.

**Root cause:** Separate fetch_spot_exposures.

**Fix:**
1. Use fetch_gex_vex_snapshot

**Test:** One call both embeds

**Effort:** M

---

### [F02-006] — Earnings double endpoint · Medium · Engine

**Files:** `unusual_whales.py:859-867`

**Problem:** 2 calls per ticker.

**Root cause:** Sequential endpoint probe.

**Fix:**
1. Cache miss path only once

**Test:** One earnings call

**Effort:** S

---

### [F02-007] — Upcoming earnings scan explosion · Medium · Engine

**Files:** `unusual_whales.py:901-920`

**Problem:** ~42 UW calls per intel bundle.

**Root cause:** Per-weekday loop.

**Fix:**
1. Batch calendar API

**Test:** Intel bundle <10 calls

**Effort:** M

---

### [F02-008] — New ClientSession per request · Medium · Engine

**Files:** `polygon_client.py, finnhub_client.py`

**Problem:** Connection overhead bursts.

**Root cause:** No session pooling.

**Fix:**
1. Shared aiohttp session

**Test:** Burst uses one pool

**Effort:** M

---

### [F02-011] — Intel semaphore unused · Medium · Engine

**Files:** `unusual_whales.py:88-94`

**Problem:** Dead parallelism code.

**Root cause:** Semaphore never acquired.

**Fix:**
1. Use or remove semaphore

**Test:** Parallel cap works or gone

**Effort:** S

---

### [F02-012] — Dual deploy doubles polling · Medium · Engine

**Files:** `service_config.py, flow.py`

**Problem:** 2x poll if misconfigured.

**Root cause:** all + flow-ingest both poll.

**Fix:**
1. Leader lock or ops checklist

**Test:** Single poller enforced

**Effort:** M

---

### [F02-014] — Finnhub today_str local TZ · Medium · Engine

**Files:** `finnhub_client.py:229-238`

**Problem:** Today/Tomorrow wrong on UTC host.

**Root cause:** date.today() not PT.

**Fix:**
1. datetime.now(PACIFIC_TZ).date()

**Test:** UTC midnight PT correct

**Effort:** M

---

### [SPX-F-02] — Stale-chase silent block · Medium · Engine

**Files:** `alerts.py:858-899`

**Problem:** No blocked notice.

**Root cause:** Console only.

**Fix:**
1. post_entry_blocked_notice

**Test:** Stale chase → notice

**Effort:** S

---

### [SPX-F-03] — Entry gate late inconsistent feedback · Medium · Engine

**Files:** `alerts.py`

**Problem:** Inconsistent notices.

**Root cause:** Ordering issue.

**Fix:**
1. Unify blocked notice path

**Test:** All blocks surfaced

**Effort:** S

---

### [SPX-F-04] — Chain liquidity silent downgrade · Medium · Engine

**Files:** `alerts.py:557-568`

**Problem:** Structure may fire when blocked.

**Root cause:** is_entry_attempt false late.

**Fix:**
1. Suppress structure when chain blocked

**Test:** Chain block → no BUY embed

**Effort:** M

---

### [SPX-F-08] — Edge starter dual-route · Medium · Engine

**Files:** `events.py:730-741`

**Problem:** WATCH+BUY same tick.

**Root cause:** Starter adds watches+graded.

**Fix:**
1. Debounce with F-07 fix

**Test:** Starter one alert

**Effort:** M

---

### [SPX-F-09] — WATCH promote origin-restricted · Medium · Engine

**Files:** `watch_entry_gate.py`

**Problem:** Only pretrade promotes.

**Root cause:** By design.

**Fix:**
1. Document in ops runbook

**Test:** Doc clarifies behavior

**Effort:** S

---

### [SPX-F-10] — Position block watch_instead stacks · Medium · Engine

**Files:** `alerts.py:804-822`

**Problem:** Multiple WATCH cards.

**Root cause:** Combined with dual-route.

**Fix:**
1. Debounce WATCH per setup_key

**Test:** One WATCH per setup

**Effort:** M

---

### [SPX-F-13] — Three session functions · Medium · Engine

**Files:** `market_hours.py`

**Problem:** Clock divergence.

**Root cause:** See SP-01.

**Fix:**
1. Align or document

**Test:** Integration test

**Effort:** M

---

### [SPX-F-14] — GTH + RTH_ONLY bar path · Medium · Engine

**Files:** `engine.py:1340-1366`

**Problem:** Overnight bars inconsistent.

**Root cause:** handle_bar early return.

**Fix:**
1. Document GTH bar policy

**Test:** GTH config tested

**Effort:** M

---

### [SPX-F-15] — Flatten mislabeled rth_close · Medium · Engine

**Files:** `engine.py:1388-1390`

**Problem:** Flatten at wrong phase.

**Root cause:** Session end not RTH 4pm.

**Fix:**
1. Rename reason session_end; log phase

**Test:** Flatten logs phase

**Effort:** S

---

### [SPX-F-19] — Poll+WS (listed P1) · Medium · Engine

**Files:** `engine.py`

**Problem:** Duplicate alerts.

**Root cause:** Dual emit paths.

**Fix:**
1. See P1 SPX-F-19

**Test:** Deduped

**Effort:** M

---

### [SPX-F-20] — SR ping dedup narrow · Medium · Engine

**Files:** `sr_ping_dedup.py`

**Problem:** Break/retest not deduped.

**Root cause:** Only support/resist test kinds.

**Fix:**
1. Extend dedup kinds

**Test:** Break deduped

**Effort:** M

---

### [TST-F07] — test_spx_entry_discord_gate stale · Medium · Engine

**Files:** `tests/test_spx_entry_discord_gate.py`

**Problem:** False confidence + fails.

**Root cause:** Inline reimplementation.

**Fix:**
1. Replace with discord_visibility tests

**Test:** Test passes

**Effort:** M

---

### [TST-F09] — Live Polygon smoke skip=pass · Medium · Engine

**Files:** `scripts/smoke_polygon_stock_mtf.py`

**Problem:** CI false green.

**Root cause:** return without key.

**Fix:**
1. sys.exit(2) without key

**Test:** No key → exit 2

**Effort:** S

---

### [TST-F10] — smoke_largo tautology · Medium · Engine

**Files:** `scripts/smoke_largo_analytics.py:45`

**Problem:** Kill switch never validated.

**Root cause:** blocked in (True,False).

**Fix:**
1. Assert specific block scenario

**Test:** Real block asserted

**Effort:** S

---


## P3 — Low

*Website first, then Engine.*

### Website

### [B06-L1] — live vs sessionActive hides premarket · Low · Website

**Files:** `useMergedDesk.ts:126-131`

**Problem:** Valid premarket desk hidden.

**Root cause:** live=false when market_open false.

**Fix:**
1. ['Separate sessionActive from market_open badge']

**Test:** Premarket desk visible

**Effort:** S

---

### [B06-L2] — useLiveSpxTape stale SSE rows · Low · Website

**Files:** `useLiveSpxTape.ts:14-17`

**Problem:** Tape not cleared when seed empty.

**Root cause:** No reset on empty seed.

**Fix:**
1. ['Clear tape state when seed clears']

**Test:** Empty seed → empty tape

**Effort:** S

---

### [B06-L3] — No ErrorBoundary on desk subtree · Low · Website

**Files:** `src/ (grep)`

**Problem:** Render error crashes whole desk.

**Root cause:** Zero ErrorBoundary.

**Fix:**
1. ['Add ErrorBoundary around desk/play']

**Test:** Thrown error → fallback UI

**Effort:** S

---

### [B06-L4] — Misleading offline UI dots · Low · Website

**Files:** `SpxDeskPanels.tsx, GexDealerPanel.tsx`

**Problem:** Always-pulse dots; hardcoded GEX.

**Root cause:** Cosmetic offline states.

**Fix:**
1. ['Gate pulse on live; wire real GEX']

**Test:** Offline shows muted state

**Effort:** S

---

### [B06-L5] — engine.ts secret in URL query · Low · Website

**Files:** `engine.ts:18-19`

**Problem:** Secret in query string to engine.

**Root cause:** fetchEngine appends ?secret=.

**Fix:**
1. ['Use header auth to engine']

**Test:** No secret in URL

**Effort:** S

---

### [B06-L6] — playClaudeGate defaults on · Low · Website

**Files:** `spx-play-config.ts:65-69`

**Problem:** Claude gate on when key present.

**Root cause:** Default enabled with key.

**Fix:**
1. ['Explicit env opt-in']

**Test:** Gate off without env

**Effort:** S

---

### [B06-L7] — Discord notify fail-open · Low · Website

**Files:** `spx-play-notify.ts, redis-pubsub.ts`

**Problem:** Notify failures permanent fail-open.

**Root cause:** Fire-and-forget no retry.

**Fix:**
1. ['Retry/backoff or incident']

**Test:** Failed notify logged

**Effort:** S

---

### [B06-L8] — Admin in-memory state per-process · Low · Website

**Files:** `admin-route-errors.ts`

**Problem:** Route errors not cross-instance.

**Root cause:** Module globals.

**Fix:**
1. ['Persist to DB or Redis']

**Test:** Errors visible all replicas

**Effort:** M

---

### [B06-L9] — SpxLiveStrip duplicate desk hook · Low · Website

**Files:** `SpxLiveStrip.tsx:9`

**Problem:** Double fetch if mounted.

**Root cause:** Duplicate useMergedDesk.

**Fix:**
1. ['Share context or document']

**Test:** Single desk fetch

**Effort:** S

---

### [B06-L10] — E2E scripts may log secrets · Low · Website

**Files:** `e2e-spx-probe.mjs`

**Problem:** Dev stdout leak.

**Root cause:** Logging in probes.

**Fix:**
1. ['Redact in scripts']

**Test:** No keys in stdout

**Effort:** S

---

### [S3-01] — RTH filter includes 16:00 bar · Low · Website

**Files:** `providers/spx-session.ts:83`

**Problem:** Minor VWAP/HOD skew.

**Root cause:** mins <= 16*60 includes close minute.

**Fix:**
1. ['Use < 16*60']

**Test:** 16:00 bar excluded

**Effort:** S

---

### [S3-02] — UW flow cache unbounded stale · Low · Website

**Files:** `providers/unusual-whales.ts:380-387`

**Problem:** Ancient flow on extended outage.

**Root cause:** Any error serves cache.

**Fix:**
1. ['Max stale age + stale flag']

**Test:** Old cache flagged stale

**Effort:** S

---

### [S3-03] — Macro events drops 2027 · Low · Website

**Files:** `providers/macro-events.ts:188`

**Problem:** Calendar breaks after 2026.

**Root cause:** Only _2026 schedule scanned.

**Fix:**
1. ['Include 2027+ schedules']

**Test:** 2027 events appear

**Effort:** S

---

### [S3-04] — GEX summary default today UTC · Low · Website

**Files:** `greek-exposure-summary.ts:31`

**Problem:** 0DTE mislabel near midnight.

**Root cause:** UTC todayYmd default.

**Fix:**
1. ['Default ET at call sites']

**Test:** ET midnight correct

**Effort:** S

---

### [S3-05] — Flow cursor skip start_time rows · Low · Website

**Files:** `providers/flow-ingest.ts`

**Problem:** Extra UW quota on overlap.

**Root cause:** Cursor ignores start_time-only rows.

**Fix:**
1. ['Document or dual cursor']

**Test:** Quota impact reduced

**Effort:** S

---

### [Largo-S3-01] — Stream error duplicate bubble · Low · Website

**Files:** `desk/LargoTerminal.tsx:76-103`

**Problem:** Empty + error assistant msgs.

**Root cause:** Placeholder not updated on catch.

**Fix:**
1. ['Map assistantId on error']

**Test:** Single error bubble

**Effort:** S

---

### [Largo-S3-02] — In-memory sessions not user-scoped · Low · Website

**Files:** `largo-store.ts:48-49`

**Problem:** Dev session ID guessing leak.

**Root cause:** No user check without DB.

**Fix:**
1. ['Document dev-only risk']

**Test:** Prod Postgres safe

**Effort:** S

---

### [Largo-S3-03] — extractTicker first-match wins · Low · Website

**Files:** `question-intent.ts:50-55`

**Problem:** Wrong ticker on multi-name thread.

**Root cause:** First KNOWN_TICKERS hit in history.

**Fix:**
1. ['Prefer latest mention or ask']

**Test:** Follow-up pins right ticker

**Effort:** S

---

### [Largo-S3-04] — NON_TICKER_CAPS incomplete · Low · Website

**Files:** `question-intent.ts:25-30`

**Problem:** IT/OR/ALL false positives.

**Root cause:** Small blocklist.

**Fix:**
1. ['Expand NON_TICKER_CAPS']

**Test:** IT in sentence not pinned

**Effort:** S

---

### [Largo-S3-05] — Duplicate desk load after feed · Low · Website

**Files:** `largo-terminal.ts:122-126`

**Problem:** Redundant loadMergedSpxDesk.

**Root cause:** resetLargoSpxDeskCache clears prefetch.

**Fix:**
1. ['Reuse feed desk in loop']

**Test:** One desk load per turn

**Effort:** S

---

### [Largo-S3-06] — Unreachable get_vol_anomaly · Low · Website

**Files:** `run-tool.ts:591-595`

**Problem:** Dead handler arm.

**Root cause:** Tool not in defs.

**Fix:**
1. ['Remove arm or add def']

**Test:** No dead code

**Effort:** S

---

### [Largo-S3-07] — User msg before assistant success · Low · Website

**Files:** `largo-terminal.ts:118`

**Problem:** Orphan user turn on failure.

**Root cause:** Persist before Claude.

**Fix:**
1. ['Acceptable; optional rollback']

**Test:** UI shows error state

**Effort:** S

---

### [Largo-S3-08] — tool_start SSE not in UI · Low · Website

**Files:** `desk/LargoTerminal.tsx:79-86`

**Problem:** No tool name during long phases.

**Root cause:** Only token handler.

**Fix:**
1. ['Surface tool_start in thinking UI']

**Test:** Tool names visible

**Effort:** S

---

### [NH-LM1] — SPX alignment passes neutrals · Low-Med · Website

**Files:** `agents/day-trade-filters.ts:44-47`

**Problem:** Vague directions pass alignment.

**Root cause:** Neutral strings pass bull filter.

**Fix:**
1. ['Require explicit long/short match']

**Test:** CALL spread blocked on bear

**Effort:** S

---

### [NH-L1] — Embed radar cosmetic only · Low · Website

**Files:** `embeds/NightHawkRadar.tsx`

**Problem:** Marketing embed not live data.

**Root cause:** Random timer blips.

**Fix:**
1. ['Label demo or wire API']

**Test:** Embed labeled demo

**Effort:** S

---

### [NH-L2] — Day-trade max_dte=1 not post-filtered · Low · Website

**Files:** `agents/day-trade-agent.ts:35-37`

**Problem:** 2+ DTE can slip through.

**Root cause:** Only 0 DTE filtered.

**Fix:**
1. ['filterPlaysByMaxDte for 0 and 1']

**Test:** max_dte=1 enforced

**Effort:** S

---

### [NH-L3] — DTE uses local midnight not ET · Low · Website

**Files:** `agents/day-trade-filters.ts:81-82`

**Problem:** 0DTE off by one near midnight.

**Root cause:** Local TZ today.

**Fix:**
1. ['Use todayEt()']

**Test:** ET DTE correct

**Effort:** S

---

### [NH-L4] — Day signal phases cosmetic · Low · Website

**Files:** `day-trade-agent.ts:14`

**Problem:** Phase always CANDIDATE.

**Root cause:** Lifecycle not implemented.

**Fix:**
1. ['Implement or hide badge']

**Test:** Badge matches state

**Effort:** S

---

### [NH-L5] — Duplicate React keys in agent modal · Low · Website

**Files:** `AgentPowerModal.tsx:138`

**Problem:** key=ticker collision.

**Root cause:** Same ticker two plays.

**Fix:**
1. ['key=ticker+strike or id']

**Test:** No key warning

**Effort:** S

---

### [NH-EDGE] — Expiry-less strike validation · Low · Website

**Files:** `option-chain-prompt.ts:306-311`

**Problem:** Wrong expiry OI match.

**Root cause:** Missing expiry matches any row.

**Fix:**
1. ['Reject expiryYmd null in strict mode']

**Test:** Wrong expiry rejected

**Effort:** S

---

### [LOW-1] — past_due grants premium · Low · Website

**Files:** `whop.ts:7-13`

**Problem:** Grace policy extends access.

**Root cause:** Intentional statuses.

**Fix:**
1. ['Confirm policy; tighten if needed']

**Test:** past_due behavior documented

**Effort:** S

---

### [LOW-2] — Whop sync without COMPANY_ID · Low · Website

**Files:** `membership.ts:76-91`

**Problem:** Slow unscoped iteration.

**Root cause:** Missing company ID.

**Fix:**
1. ['Fail fast if WHOP_COMPANY_ID unset']

**Test:** 500 clear config error

**Effort:** S

---

### [LOW-3] — Clerk JWT tier lag after sync · Low · Website

**Files:** `SyncMembershipButton.tsx:24-25`

**Problem:** Brief stale tier client-side.

**Root cause:** router.refresh only.

**Fix:**
1. ['session.reload() after sync']

**Test:** Immediate premium access

**Effort:** S

---

### [F5] — No security headers · Low · Website

**Files:** `next.config.mjs`

**Problem:** Missing HSTS/CSP baseline.

**Root cause:** No headers() block.

**Fix:**
1. ['Add async headers() baseline']

**Test:** HSTS present

**Effort:** M

---

### [F6] — TradingView iframe no sandbox · Low · Website

**Files:** `TradingViewWidget.tsx`

**Problem:** Third-party JS trust.

**Root cause:** No sandbox attr.

**Fix:**
1. ['CSP frame-src; optional sandbox']

**Test:** Document TV trust

**Effort:** S

---

### [F7] — tsconfig strict false · Low · Website

**Files:** `tsconfig.json`

**Problem:** Weaker type safety.

**Root cause:** strict: false.

**Fix:**
1. ['Enable strict incrementally']

**Test:** strict true path

**Effort:** L

---

### [API-L1] — engine/health hints config · Low · Website

**Files:** `api/engine/health/route.ts`

**Problem:** Minor recon.

**Root cause:** Mentions env name.

**Fix:**
1. ['Generic message']

**Test:** No env hint

**Effort:** S

---

### [API-L2] — flows lazy-ingest side effect · Low · Website

**Files:** `api/market/flows/route.ts`

**Problem:** Read triggers ingest.

**Root cause:** maybeRunFlowIngest on GET.

**Fix:**
1. ['Document or decouple']

**Test:** Acceptable if documented

**Effort:** S

---

### [API-L3] — DB check before auth ordering · Low · Website

**Files:** `4 market routes`

**Problem:** 503 before 401 in prod.

**Root cause:** requireDatabaseInProduction first.

**Fix:**
1. ['Auth before DB check']

**Test:** 401 before 503

**Effort:** S

---

### [API-L4] — Whop webhook secret unset · Low · Website

**Files:** `api/webhook/whop/route.ts`

**Problem:** Webhooks fail closed.

**Root cause:** SDK throws without secret.

**Fix:**
1. ['Ops alert if unset']

**Test:** Document fail-closed

**Effort:** S

---


### Engine

### [ND-L1] — Detector duplicate events same tick · Low · Engine

**Files:** `name_desk/detector.py:66-76`

**Problem:** Minor WATCH spam.

**Root cause:** Break + continuation both fire.

**Fix:**
1. ['Deduplicate by kind priority']

**Test:** One event per transition

**Effort:** S

---

### [ND-L2] — Night Hawk vs evening DTE doc mismatch · Low · Engine

**Files:** `night_hawk_scanner.py vs evening_plays.py`

**Problem:** Operator confusion.

**Root cause:** Conflicting comment ranges.

**Fix:**
1. ['Align docs with constants']

**Test:** Docs consistent

**Effort:** S

---

### [ND-SP5] — Dedup blocks opposite direction · Low · Engine

**Files:** `night_hawk_scanner.py:634-637`

**Problem:** Legit reversal suppressed.

**Root cause:** Pre-filter blocks both directions.

**Fix:**
1. ['Dedup (ticker,direction,date) only']

**Test:** SHORT after LONG allowed

**Effort:** S

---

### [C06-13] — render_sample_alert misleading · Low · Engine

**Files:** `scripts/render_sample_alert.py`

**Problem:** Operators expect image.

**Root cause:** Always returns None.

**Fix:**
1. ['Rename or delete stub']

**Test:** Clear script purpose

**Effort:** S

---

### [C06-14] — mtf_context unbounded cache · Low · Engine

**Files:** `mtf_context.py:14`

**Problem:** Memory creep.

**Root cause:** No LRU.

**Fix:**
1. ['Cap cache size']

**Test:** Cache bounded

**Effort:** S

---

### [C06-15] — chart_mtf gather all-or-nothing · Low · Engine

**Files:** `chart_mtf.py:96-98`

**Problem:** One fail drops all TF.

**Root cause:** No return_exceptions.

**Fix:**
1. ['Per-TF degrade']

**Test:** Partial MTF returned

**Effort:** S

---

### [C06-16] — week_high mislabeled rolling 5d · Low · Engine

**Files:** `chart_technicals.py:108-110`

**Problem:** WTD label wrong early week.

**Root cause:** tail(5) not calendar week.

**Fix:**
1. ['Rename or ISO week']

**Test:** Keys accurate

**Effort:** S

---

### [C06-17] — SPX.md broken markdown table · Low · Engine

**Files:** `docs/SPX.md:487-488`

**Problem:** Env table renders wrong.

**Root cause:** GTH prose mid-table.

**Fix:**
1. ['Fix table structure']

**Test:** Table renders

**Effort:** S

---

### [SP-06] — Lifecycle without Discord BUY edge · Low · Engine

**Files:** `alerts.py`

**Problem:** Lifecycle attaches if journal ok.

**Root cause:** Talon HTTP fail edge.

**Fix:**
1. ['Document edge case']

**Test:** Doc only

**Effort:** S

---

### [SP-07] — bar_in_rth vs scalper_session dup · Low · Engine

**Files:** `session.py, market_hours.py`

**Problem:** Weekend bar disagreement.

**Root cause:** Duplicate logic paths.

**Fix:**
1. ['Consolidate helpers']

**Test:** Same bar classification

**Effort:** S

---

### [SP-08] — Chop guard silent by design · Low · Engine

**Files:** `entry_gate.py`

**Problem:** Chop blocks silent.

**Root cause:** Intentional.

**Fix:**
1. ['Document ops preference']

**Test:** Documented

**Effort:** S

---

### [SPX-F-05] — Unscored events blocked no log · Low · Engine

**Files:** `entry_gate.py:35-48`

**Problem:** None grade blocked.

**Root cause:** Correct but quiet.

**Fix:**
1. ['Optional debug log']

**Test:** Debug log at trace

**Effort:** S

---

### [SPX-F-11] — route_is_entry promote without prior WATCH · Low · Engine

**Files:** `entry_routing.py:82-101`

**Problem:** BUY without WATCH when flag 0.

**Root cause:** Config dependent.

**Fix:**
1. ['Document SPX_WATCH_PROMOTE_REQUIRES_PRIOR_WATCH']

**Test:** Config documented

**Effort:** S

---

### [SPX-F-16] — is_trading_session_extended PT fallback · Low · Engine

**Files:** `session.py:412-418`

**Problem:** Hours-only compare.

**Root cause:** Ignores minutes.

**Fix:**
1. ['Include minutes in compare']

**Test:** Extended session accurate

**Effort:** S

---

### [SPX-F-17] — time_rules unreachable branch · Low · Engine

**Files:** `time_rules.py:150-185`

**Problem:** Dead late-day branch.

**Root cause:** Earlier return always.

**Fix:**
1. ['Remove dead code']

**Test:** Lint clean

**Effort:** S

---

### [SPX-F-21] — Pretrade watch key no level · Low · Engine

**Files:** `pretrade_watch.py:429-445`

**Problem:** Different levels suppress.

**Root cause:** kind:side key only.

**Fix:**
1. ['Include level in key']

**Test:** Two levels both post

**Effort:** S

---

### [SPX-F-22] — Desk triple cooldown layers · Low · Engine

**Files:** `desk_entry.py:325-416`

**Problem:** Complex dedup.

**Root cause:** sig_key + PretradeWatch.

**Fix:**
1. ['Consolidate desk dedup']

**Test:** Single desk cooldown

**Effort:** M

---

### [DISC-F-12] — Unknown BLACKOUT_SERVICE → all · Low · Engine

**Files:** `service_config.py:20-24`

**Problem:** Typo enables full stack.

**Root cause:** Silent default.

**Fix:**
1. ['Fail on unknown service']

**Test:** Typo errors

**Effort:** S

---

### [DISC-F-13] — README flow min premium mismatch · Low · Engine

**Files:** `README.md vs env_config.py:999`

**Problem:** 50k vs 200k default.

**Root cause:** Doc drift.

**Fix:**
1. ['Update README default']

**Test:** Docs match code

**Effort:** S

---

### [DISC-F-14] — README unimplemented commands · Low · Engine

**Files:** `README.md:239`

**Problem:** !weeklythesis not in bot.

**Root cause:** Stale docs.

**Fix:**
1. ['Remove or implement']

**Test:** README accurate

**Effort:** S

---

### [DISC-F-15] — SPX hello embed comms-only noise · Low · Engine

**Files:** `bot.py:832-845`

**Problem:** Discord noise on deploy.

**Root cause:** Hello embed always.

**Fix:**
1. ['Skip hello in comms-only']

**Test:** No hello embed

**Effort:** S

---

### [DISC-F-16] — Power-hour flow uncalled · Low · Engine

**Files:** `bot.py:396-402`

**Problem:** Misleading enabled log.

**Root cause:** No callers.

**Fix:**
1. ['Remove log or wire caller']

**Test:** Log accurate

**Effort:** S

---

### [F02-002] — Cursor format mix · Low · Engine

**Files:** `flow.py:2565-2576`

**Problem:** ISO vs start_time cursor.

**Root cause:** Secondary to F02-001.

**Fix:**
1. ['Normalize cursor format']

**Test:** Consistent newer_than

**Effort:** S

---

### [F02-009] — !flow on-demand duplicate · Low · Engine

**Files:** `flow.py get_flow_lookup_embed`

**Problem:** Manual lookup duplicates ingest.

**Root cause:** By design.

**Fix:**
1. ['Document intentional']

**Test:** Doc only

**Effort:** S

---

### [F02-015] — build_test_uw_row TZ mix · Low · Engine

**Files:** `flow.py:2386-2404`

**Problem:** Test alert inconsistent DTE.

**Root cause:** ET created_at, local expiry.

**Fix:**
1. ['Use ET for expiry in test row']

**Test:** Test row consistent

**Effort:** S

---

### [F02-017] — flow_context unused ET import · Low · Engine

**Files:** `flow_context_aware_scoring.py`

**Problem:** Dead import.

**Root cause:** Noise only.

**Fix:**
1. ['Remove import']

**Test:** Lint clean

**Effort:** S

---

### [F02-018] — Duplicate http_probe · Low · Engine

**Files:** `http_retry.py:176-221`

**Problem:** Maintenance hazard.

**Root cause:** Two identical defs.

**Fix:**
1. ['Delete duplicate']

**Test:** One http_probe

**Effort:** S

---

### [WEB-009] — Largo session_id hash collision · Low · Engine

**Files:** `web_server.py`

**Problem:** Sessions not stable across restart.

**Root cause:** hash() per-process.

**Fix:**
1. ['Use uuid or DB session table']

**Test:** Stable session mapping

**Effort:** M

---

### [WEB-010] — Swagger disabled (positive) · Low · Engine

**Files:** `web_server.py`

**Problem:** Info — good control.

**Root cause:** docs_url=None.

**Fix:**
1. ['Keep disabled']

**Test:** No /docs UI

**Effort:** S

---

### [CODE-001] — Duplicate import ai_summary · Low · Engine

**Files:** `ai_summary.py:21,24`

**Problem:** Lint noise.

**Root cause:** Duplicate import line.

**Fix:**
1. ['Remove duplicate']

**Test:** Lint clean

**Effort:** S

---

### [CODE-002] — ai_summary os.getenv not env_config · Low · Engine

**Files:** `ai_summary.py`

**Problem:** Config inconsistency.

**Root cause:** Direct getenv.

**Fix:**
1. ['Use env_config']

**Test:** Centralized config

**Effort:** S

---

### [TST-F08] — Infra/orchestration untested · Low · Engine

**Files:** `bot.py, web_server.py, evening_plays*`

**Problem:** Zero coverage.

**Root cause:** No tests.

**Fix:**
1. ['Add smoke boot tests']

**Test:** Boot smoke exists

**Effort:** L

---

### [TST-F11] — Weak routing assertions · Medium · Engine

**Files:** `test_spx_entry_routing.py:50`

**Problem:** Accepts any mode.

**Root cause:** Weak assert.

**Fix:**
1. ['Pin expected mode']

**Test:** Assert exact mode

**Effort:** S

---

### [TST-F12] — Ambiguous assessment OR assert · Medium · Engine

**Files:** `test_spx_assessment_fixes.py:126`

**Problem:** Passes incorrectly.

**Root cause:** OR logic.

**Fix:**
1. ['Split positive/negative cases']

**Test:** Assert precise

**Effort:** S

---

### [TST-F13] — discord_visibility mutates globals · Medium · Engine

**Files:** `test_spx_discord_visibility.py`

**Problem:** Cross-test pollution.

**Root cause:** Direct config assign.

**Fix:**
1. ['monkeypatch teardown']

**Test:** Isolated tests

**Effort:** S

---

### [TST-F14] — engine_open_plays fully mocked · Medium · Engine

**Files:** `test_name_desk_engine_open_plays.py`

**Problem:** Only ticker list asserted.

**Root cause:** All deps patched.

**Fix:**
1. ['Reduce mocks']

**Test:** Assert scan behavior

**Effort:** S

---

### [TST-F15] — Tests disable safety rails · Medium · Engine

**Files:** `multiple test_spx_*.py`

**Problem:** Stacked gates untested.

**Root cause:** Monkeypatch disables blocks.

**Fix:**
1. ['Integration test with rails on']

**Test:** Rails-on test

**Effort:** M

---

### [TST-F16] — Private API testing coupling · Medium · Engine

**Files:** `tests/`

**Problem:** Refactor breaks tests.

**Root cause:** Tests private methods.

**Fix:**
1. ['Test public interfaces']

**Test:** Public API tests

**Effort:** M

---

### [TST-F17] — Smoke print-only sections · Medium · Engine

**Files:** `smoke_market_context.py etc.`

**Problem:** Regressions undetected.

**Root cause:** No asserts.

**Fix:**
1. ['Add assertions']

**Test:** Smoke asserts output

**Effort:** S

---

### [TST-F18] — Smoke exit codes inconsistent · Medium · Engine

**Files:** `26/27 smokes`

**Problem:** CI can't rely on exit.

**Root cause:** assert-only.

**Fix:**
1. ['SystemExit convention']

**Test:** Non-zero on fail

**Effort:** S

---

### [TST-F19] — GTH test date flake · Medium · Engine

**Files:** `test_spx_gth_bar_load.py`

**Problem:** Fails on wrong date.

**Root cause:** Hardcoded Sunday.

**Fix:**
1. ['Freeze time fixture']

**Test:** Stable any date

**Effort:** S

---

### [TST-F20] — Stale chop/reentry tests · Medium · Engine

**Files:** `test_spx_chop_guard.py, test_spx_route_is_entry.py`

**Problem:** Outdated expectations.

**Root cause:** Prod behavior changed.

**Fix:**
1. ['Update per product intent']

**Test:** Tests pass

**Effort:** S

---

### [TST-F21] — No smoke for entry_gate paths · Medium · Engine

**Files:** `scripts/`

**Problem:** Gap unit vs smoke.

**Root cause:** No smoke coverage.

**Fix:**
1. ['Add smoke_entry_gate.py']

**Test:** Smoke exists

**Effort:** S

---

### [TST-F22] — conftest minimal · Medium · Engine

**Files:** `tests/conftest.py`

**Problem:** No shared fixtures.

**Root cause:** 11 lines only.

**Fix:**
1. ['Add time freeze, Discord mock']

**Test:** Shared fixtures

**Effort:** M

---

### [TST-F23] — leader_ttl config only · Low · Engine

**Files:** `test_name_desk_leader_ttl.py`

**Problem:** No lock behavior test.

**Root cause:** Inequality check.

**Fix:**
1. ['Test acquire/renew']

**Test:** Lock behavior tested

**Effort:** S

---

### [TST-F24] — outcome_windows constant check · Low · Engine

**Files:** `test_name_desk_outcome_windows.py`

**Problem:** Not outcome computation.

**Root cause:** Hardcoded list.

**Fix:**
1. ['Test computation']

**Test:** Real outcome test

**Effort:** S

---

### [TST-F25] — uw_spx_priority timing flake · Low · Engine

**Files:** `test_uw_spx_priority.py:34`

**Problem:** Wall-clock assert.

**Root cause:** elapsed >= 0.2.

**Fix:**
1. ['Mock time']

**Test:** No flake

**Effort:** S

---

### [TST-F26] — Redundant smoke overlap · Low · Engine

**Files:** `4 lifecycle smokes`

**Problem:** Maintenance burden.

**Root cause:** Similar fixtures.

**Fix:**
1. ['Consolidate smokes']

**Test:** Fewer duplicates

**Effort:** S

---

### [TST-F27] — smoke_pacific_time wall clock · Low · Engine

**Files:** `smoke_pacific_time.py`

**Problem:** Non-deterministic.

**Root cause:** No injected time.

**Fix:**
1. ['Freeze time']

**Test:** Deterministic phase

**Effort:** S

---

### [TST-F28] — confluence no pass-path test · Low · Engine

**Files:** `test_name_desk_confluence_gate.py`

**Problem:** Rejection only.

**Root cause:** No qualified pass.

**Fix:**
1. ['Add pass-path test']

**Test:** Pass path covered

**Effort:** S

---


## P4 — Info / deferred

### [F8] — Railway deploy config info · Info · Website

**Files:** `railway.toml`

**Problem:** Build uses DATABASE_PUBLIC_URL — documented pattern.

**Root cause:** Expected Railway behavior.

**Fix:**
1. ['Document runtime vs build DB URL']

**Test:** Ops doc updated

**Effort:** S

---

### [F9] — NEXT_PUBLIC_* usage expected · Info · Website

**Files:** `site.ts, docs pages`

**Problem:** No secrets in client bundle.

**Root cause:** Verified clean.

**Fix:**
1. ['Maintain grep in CI']

**Test:** No NEXT_PUBLIC secrets

**Effort:** S

---

### [F02-003] — Restart cursor vs in-loop drift · Info · Engine

**Files:** `flow.py`

**Problem:** Explains intermittent duplicate ingest.

**Root cause:** DB heal on restart.

**Fix:**
1. ['Fixed by F02-001']

**Test:** Monitor cursor metrics

**Effort:** S

---

### [F02-010] — Website deep-links not API dup · Info · Engine

**Files:** `flow embeds`

**Problem:** Correct pattern.

**Root cause:** URLs only.

**Fix:**
1. ['No change']

**Test:** N/A

**Effort:** S

---

### [F02-013] — Rate limit mitigations present · Info · Engine

**Files:** `http_retry.py, unusual_whales.py`

**Problem:** Positive controls.

**Root cause:** Backoff/gap exist.

**Fix:**
1. ['Maintain']

**Test:** N/A

**Effort:** S

---

### [F02-019] — Finnhub cache bypass outside batch · Info · Engine

**Files:** `desk_briefings.py etc.`

**Problem:** Direct Finnhub calls elsewhere.

**Root cause:** Not using cache module.

**Fix:**
1. ['Route through finnhub_earnings_cache']

**Test:** Centralized cache

**Effort:** M

---

### [F02-020] — tickers.json watchlist empty · Info · Engine

**Files:** `tickers.json`

**Problem:** Watchlist filter inactive.

**Root cause:** Empty array.

**Fix:**
1. ['Configure if needed']

**Test:** N/A

**Effort:** S

---

### [SPX-F-06] — Entry gate well-tested · Info · Engine

**Files:** `test_spx_entry_gate.py`

**Problem:** Positive — good coverage.

**Root cause:** Tests exist.

**Fix:**
1. ['Maintain']

**Test:** N/A

**Effort:** S

---

### [SPX-F-12] — SELL routing centralized · Info · Engine

**Files:** `trade_lifecycle.py`

**Problem:** Positive control.

**Root cause:** Sound design.

**Fix:**
1. ['Maintain']

**Test:** N/A

**Effort:** S

---

### [SPX-F-18] — GTH hours tested · Info · Engine

**Files:** `test_spx_gth_hours.py`

**Problem:** Positive control.

**Root cause:** Tests exist.

**Fix:**
1. ['Maintain']

**Test:** N/A

**Effort:** S

---

### [SPX-F-23] — Position WATCH cooldown good · Info · Engine

**Files:** `pretrade_watch.py`

**Problem:** Positive pattern.

**Root cause:** Works.

**Fix:**
1. ['Maintain']

**Test:** N/A

**Effort:** S

---

### [SP-09] — Test coverage map info · Info · Engine

**Files:** `tests/`

**Problem:** Documents gaps.

**Root cause:** See TST-*.

**Fix:**
1. ['Address TST-COV']

**Test:** N/A

**Effort:** S

---

### [SP-10] — Config surface 588 lines · Info · Engine

**Files:** `spx_scalper/config.py`

**Problem:** Footgun if misconfigured.

**Root cause:** Many env toggles.

**Fix:**
1. ['Ops runbook']

**Test:** Runbook exists

**Effort:** S

---

### [SP-11] — No shadow alert POST paths · Info · Engine

**Files:** `spx_scalper/`

**Problem:** Positive — routing centralized.

**Root cause:** Verified.

**Fix:**
1. ['Maintain']

**Test:** N/A

**Effort:** S

---

### [SP-12] — spx_scalper service entrypoint OK · Info · Engine

**Files:** `services/spx_scalper.py`

**Problem:** Positive — waits for bot ready.

**Root cause:** Correct startup.

**Fix:**
1. ['Maintain']

**Test:** N/A

**Effort:** S

---

### [C06-SP01] — Hard macro block ignores NFP/PPI/GDP · High · Engine

**Files:** `macro_calendar.py` (~261–267)

**Problem:** High-impact NFP/PPI/GDP never hard-block SPX entries — only CPI/FOMC categories get sync windows.

**Root cause:** `macro_hard_block_reason_sync` sets `window=0` for `other` category events.

**Fix:**
1. Extend category map for NFP/PPI/GDP or use impact=high + keyword list.
2. Depends **C06-04** cache warmup for cold-start reliability.

**Test:** NFP in 5 minutes with warmed cache → block reason returned.

**Effort:** M

---

## Verify only (marked ✅ Fixed in audits)

| ID | Repo | Action |
|----|------|--------|
| Engine proxy auth | Website | Verify `api/engine/[...path]` still requires auth + allowlist + POST 405 |
| NEXT_PUBLIC_ENGINE_WS_KEY removed | Website | Verify absent from client bundle; rotate leaked key in Railway |
| Night Hawk chain dedup | Website | Verify `fetchEditionChains` single-fetch path |
| Jan expiry rollover | Website | Verify `option-chain-prompt.ts` year roll |
| Flow ingest cursor ISO | Website | Verify `flow-ingest.ts` uses only `created_at` |
| UW WS stale skip | Website | Verify `isUwChannelFresh` gates REST skip |
| SPX signal dedup key | Website | Verify stable `session|action|direction` key |
| Largo extractTicker | Website | Verify `NON_TICKER_CAPS` blocks false positives |
| P6/P7 breadth labels | Website | Verify prior-close helper in Night Hawk; SPX desk still needs **B2-01** |
| P1 flow cursor (website) | Website | ✅ Fixed (contrast engine **F02-001** still open) |

---

## Document stats

- **Briefs written:** 249
- **Master path:** `C:\Users\raidu\blackout-web\audits\FIX-BRIEFS.md`
- **Companion path:** `C:\Users\raidu\BO-AAI\BlackOut-Uw-Alerts\audits\FIX-BRIEFS.md`
- **Findings not located in source audits:** None — all requested ID families mapped from batch reports. (Website batch 06 uses internal H1–H8 IDs mapped to summary **B06-H1–H8**; API **H1** is distinct from B06-H1.)
