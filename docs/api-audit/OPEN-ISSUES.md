# BlackOut Open Issues Log
Last updated: 2026-06-30 13:45 ET

> **30 Jun 2026 — RTH afternoon pass GREEN.** Socket-health cron probe (#116), nw15 fix + unlisted-position reconcile (#118).
> Canonical audit probe list: `docs/api-audit/AUDIT-SKILL-REFERENCE.md` (in-repo SKILL:
> `.cursor/skills/platform-audit/SKILL.md`).

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
| **OPS-9** | options-socket 1006 failures=1 in deploy logs (0 held contracts) | Watch — entitlement noise; socket-health passes |
| **OPS-10** | Grid 15s load on 12-panel board | P2 UX — APIs healthy |

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
