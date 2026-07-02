# BlackOut Open Issues Log
Last updated: 2026-07-02 13:48 ET

## RTH comprehensive sweep — 2026-07-02 ~13:44–13:48 ET (pass 3 — afternoon RTH)

**Session:** Thu 2 Jul 2026, 13:44–13:48 ET (**RTH open**; market open 09:30 ET). Agent: autonomous cloud session. Premium Clerk admin via `sign_in_token` (temp user created/deleted). Browser GUI blocked in cloud sandbox — full sweep via authenticated API proxy (`scripts/audit/rth-browser-test.mjs`) + production validators.

### Validation summary

| Check | Result |
|---|---|
| `npm install` | ✅ restored deps (`pg` missing on fresh checkout) |
| `npm run validate:rth-open` | ✅ GREEN — deploy + RTH session checks passed (options-socket enabled, no held contracts) |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed, 70 consistency-only (`market_open: true`) |
| `node scripts/audit/rth-browser-test.mjs` | ✅ 38 PASS, 8 WARN (expected missing fields) |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (47 pass, 0 issues) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN (47 pass, 0 issues) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags (1st run: META fetch terminated + SMH cells-resum Δ2.58e-4% — both transient; re-run clean) |
| `node scripts/audit/data-validator.mjs` | ✅ 17 PASS, 0 FAIL, 0 malformed floats (1 WARN: net_gex sign vs UW units differ) |
| `npm run ops:collect` | ✅ 0 action items |

### API sweep (premium session — ~13:46 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/gex-heatmap?ticker=SPX` | 200 | ~4681ms | 179 strikes, spot 7435.91 |
| `/api/market/spx/merged` | 200 | ~414ms | warm |
| `/api/market/flows` | 200 | ~9856ms | 500 rows |
| `/api/market/flow-brief` | 200 | ~4130ms | ok |
| `/api/market/gex-heatmap?ticker=SPY` | 200 | ~212ms | 168 strikes |
| `/api/grid/bootstrap` + 8 panel routes | 200 | 81–4822ms | all panels finite |
| `/api/market/nighthawk/edition` | 200 | ~183ms | 0 plays (midday), recap=true |
| `/api/public/track-record` | 200 | ~230ms | 12 closed |
| Largo `/api/market/largo/query` | 200 | ~42s | NVDA grounded; tools=[live_feed_capture, get_dark_pool, get_options_flow] |
| SPX oracle | — | — | desk 7436.42 vs Polygon 7436.52 (Δ 0.10) |

**Cross-tool GEX:** SPX spot aligned across desk/heatmap/grid; data-correctness 0 flags; gamma posture matches net_gex sign.

### Page sweep (premium admin — API proxy, RTH open)

| Page | Load | Live update | Notes |
|---|---|---|---|
| `/dashboard` | ~4681ms heatmap / ~414ms merged | ✅ 15s poll changed | 179 strikes; spot live |
| `/flows` | ~9856ms | ✅ 15s poll changed | 500 flows; SSE tape live |
| `/heatmap` Matrix | ~212ms SPY | ✅ cache refreshes | optional overlays empty |
| `/heatmap` Profile | (same endpoint) | — | gamma profile via heatmap API |
| `/grid` | bootstrap + 8 routes 200 | 20–90s cadence | 12 panels: pulse/news/flow via bootstrap + 8 panel routes |
| `/nighthawk` | ~183ms | static edition | 0 plays midday (edition at close) |
| `/terminal` (Largo) | ~42s | — | grounded NVDA multi-tool answer |
| `/track-record` | ~230ms | LIVE | 12 closed |

**Speed flags:** SPX heatmap cold load ~4.7s and HELIX flows ~9.9s exceed soft-nav target (~1.5s) but are within known cold-cache bounds; grid panel routes 81–101ms are fast.

### Missing-field audit (pass 3 — all expected/upstream)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| `dark_pool.pcr`, `lit_dark_ratio`, `prints[empty]` | desk/merged/nighthawk | `spx/merged` | **Upstream gap** — prints lack call/put split | Expected; do not fabricate |
| `flows[].alerted_at` / `event_at` | HELIX | `option_trades` WS path | **Upstream shape** — WS prints lack alert timestamps | Expected |
| `earnings.items[].eps_actual` / `surprise_pct` | grid | `/api/grid/earnings` | **Expected** — pre-report / future dates | none |
| `economy indicators rows[7].value` | grid | `/api/grid/economy` | **Upstream gap** — sparse FRED row | Expected |
| `events[empty]`, `cross_validation`, `nighthawk_context` | heatmap/dashboard | gex-heatmap overlays | **Optional overlays** — none active | Expected |
| `sector_bias`, `vol_regime`, `chart_levels.vah/val/poc` | grid pulse (schema) | `deskPayloadToSpxState` | **Not wired** — fields hardcoded null; PulseStrip UI does not render them | P2 backlog (not user-visible blank) |
| MU flip `—` | heatmap matrix | sparse far-dated chain | **Upstream gap** | Expected |

**No new P0/P1 data correctness defects.** No GitHub issue opened (all GREEN).

### Open watches (P2)

- `validate:rth-open` warnings: 1 API telemetry failure (15m), 8 Sentry unresolved (prior deploy noise)
- SPX heatmap / HELIX flows cold latency elevated (~4.7s / ~9.9s) — monitor under afternoon load
- `heatmap-matrix-audit` META fetch terminated on 1st run — transient; re-run passed
- SMH cells-resum Δ2.58e-4% on 1st run — floating-point rounding; re-run passed

---

## RTH comprehensive sweep — 2026-07-02 ~12:22–12:27 ET (pass 2 — midday RTH)

**Session:** Thu 2 Jul 2026, 12:22–12:27 ET (**RTH open**; market open 09:30 ET). Agent: autonomous cloud session. Premium Clerk admin via `sign_in_token` (temp user created/deleted). Browser GUI blocked in cloud sandbox — full sweep via authenticated API proxy (`scripts/audit/rth-browser-test.mjs`) + production validators.

### Validation summary

| Check | Result |
|---|---|
| `npm install` | ✅ restored deps (`pg` missing on fresh checkout) |
| `npm run validate:rth-open` | ✅ GREEN — deploy + RTH session checks passed (options-socket authenticated, 7 contracts) |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed, 69 consistency-only (`market_open: true`) |
| `node scripts/audit/rth-browser-test.mjs` | ✅ 37 PASS, 9 WARN (expected missing fields + HELIX 15s cache window) |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (47 pass, 0 issues) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN (47 pass, 0 issues) — 1st run transient P0 desk RANGE race (spot 7461.87 vs lod 7462.29); re-run passed |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags |
| `node scripts/audit/data-validator.mjs` | ✅ 17 PASS, 0 FAIL, 0 malformed floats |
| `npm run ops:collect` | ✅ 0 action items |

### API sweep (premium session — ~12:24 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/gex-heatmap?ticker=SPX` | 200 | ~466ms | 176 strikes, spot 7464.38 |
| `/api/market/spx/merged` | 200 | ~1924ms | warm |
| `/api/market/flows` | 200 | ~411ms | 500 rows |
| `/api/market/flow-brief` | 200 | ~3840ms | ok |
| `/api/market/gex-heatmap?ticker=SPY` | 200 | ~130ms | 168 strikes |
| `/api/grid/bootstrap` + 8 panel routes | 200 | 68–3022ms | all panels finite |
| `/api/market/nighthawk/edition` | 200 | ~111ms | 0 plays (midday), recap=true |
| `/api/public/track-record` | 200 | ~311ms | 12 closed |
| Largo `/api/market/largo/query` | 200 | ~45s | NVDA grounded; tools=[live_feed_capture, get_dark_pool, get_options_flow] |
| SPX oracle | — | — | desk 7462.03 vs Polygon 7462.11 (Δ 0.08) |

**Cross-tool GEX:** SPX spot aligned across desk/heatmap/grid; data-correctness 0 flags; gamma posture matches net_gex sign (near-flip divergence noted, expected).

### Page sweep (premium admin — API proxy, RTH open)

| Page | Load | Live update | Notes |
|---|---|---|---|
| `/dashboard` | ~466ms heatmap / ~1924ms merged | ✅ 15s poll changed | 176 strikes; spot live |
| `/flows` | ~411ms | ⚠ 15s poll unchanged | 30s server cache (`TTL.DARK_POOL`); SSE tape still live — not a defect |
| `/heatmap` Matrix | ~130ms SPY | ✅ cache refreshes | optional overlays empty |
| `/heatmap` Profile | (same endpoint) | — | gamma profile via heatmap API |
| `/grid` | bootstrap + 8 routes 200 | 20–90s cadence | 12 panels: pulse/news/flow via bootstrap market seeds + 8 panel routes |
| `/nighthawk` | ~111ms | static edition | 0 plays midday (edition at close) |
| `/terminal` (Largo) | ~45s | — | grounded NVDA multi-tool answer |
| `/track-record` | ~311ms | LIVE | 12 closed |

### Missing-field audit (pass 2 — all expected/upstream)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| `dark_pool.pcr`, `lit_dark_ratio`, `prints[empty]` | desk/merged/nighthawk | `spx/merged` | **Upstream gap** — prints lack call/put split | Expected; do not fabricate |
| `flows[].alerted_at` / `event_at` | HELIX | `option_trades` WS path | **Upstream shape** — WS prints lack alert timestamps | Expected |
| `earnings.items[].eps_actual` / `surprise_pct` | grid | `/api/grid/earnings` | **Expected** — pre-report / future dates | none |
| `economy indicators rows[7].value` | grid | `/api/grid/economy` | **Upstream gap** — sparse FRED row | Expected |
| `events[empty]`, `cross_validation`, `nighthawk_context` | heatmap/dashboard | gex-heatmap overlays | **Optional overlays** — none active | Expected |
| `sector_bias`, `vol_regime`, `chart_levels.vah/val/poc` | grid pulse (schema) | `deskPayloadToSpxState` | **Not wired** — fields hardcoded null; PulseStrip UI does not render them | P2 backlog (not user-visible blank) |
| MU flip `—` | heatmap matrix | sparse far-dated chain | **Upstream gap** | Expected |

**No new P0/P1 data correctness defects.** No GitHub issue opened (all GREEN).

### Open watches (P2)

- `full-site-deep-audit` desk RANGE check can false-positive when spot ticks below lod within same second — consider 0.5pt tolerance or single-request atomicity
- HELIX REST poll unchanged at 15s vs 30s cache — audit script should use ≥35s poll or compare `as_of`/head row id
- Sentry unresolved sample (8) — includes prior deploy DB timeout noise
- options-socket authenticated with 7 contracts — healthy

---

## RTH comprehensive sweep — 2026-07-02 ~11:40–11:45 ET (pass 1 — RTH open)

**Session:** Thu 2 Jul 2026, 11:40–11:45 ET (**RTH open**; market open 09:30 ET). Agent: autonomous cloud session. Premium Clerk admin via `sign_in_token` (temp user created/deleted). Browser GUI blocked in cloud sandbox — full sweep via authenticated API proxy (`scripts/audit/rth-browser-test.mjs`) + production validators.

### Validation summary

| Check | Result |
|---|---|
| `npm install` | ✅ restored deps (`pg` missing on fresh checkout) |
| `npm run validate:rth-open` | ✅ GREEN — deploy + RTH session checks passed |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed, 69 consistency-only (`market_open: true`) |
| `node scripts/audit/rth-browser-test.mjs` | ✅ 37 PASS, 9 WARN (expected missing fields + HELIX 15s cache window) |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (47 pass, 0 issues) |
| `node scripts/full-site-deep-audit.mjs` | ⚠ 46 pass, 1 issue — IWM heatmap transient empty (false positive; matrix audit passed IWM) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags |
| `node scripts/audit/data-validator.mjs` | ✅ 18 PASS, 0 FAIL, 0 malformed floats (round-floats fix on main) |
| `npm run ops:collect` | ✅ 0 action items |

### API sweep (premium session — ~11:42 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/gex-heatmap?ticker=SPX` | 200 | ~1505ms | 176 strikes, spot 7489.73 |
| `/api/market/spx/merged` | 200 | ~252ms | warm |
| `/api/market/flows` | 200 | ~2450ms | 500 rows |
| `/api/market/flow-brief` | 200 | ~3883ms | ok |
| `/api/market/gex-heatmap?ticker=SPY` | 200 | ~477ms | 166 strikes |
| `/api/grid/bootstrap` + 8 panel routes | 200 | 69–257ms | all panels finite |
| `/api/market/nighthawk/edition` | 200 | ~710ms | 0 plays (midday), recap=true |
| `/api/public/track-record` | 200 | ~210ms | 12 closed |
| Largo `/api/market/largo/query` | 200 | ~37s | NVDA grounded; tools=[live_feed_capture, get_dark_pool, get_options_flow] |
| SPX oracle | — | — | desk 7482.25 vs Polygon 7482.35 (Δ 0.10) |

**Cross-tool GEX:** SPX spot aligned across desk/heatmap/grid; data-correctness 0 flags; gamma posture matches net_gex sign.

### Page sweep (premium admin — API proxy, RTH open)

| Page | Load | Live update | Notes |
|---|---|---|---|
| `/dashboard` | ~1.5s heatmap / ~252ms merged | ✅ 15s poll changed | 176 strikes; spot live |
| `/flows` | ~2.5s | ⚠ 15s poll unchanged | 30s server cache (`TTL.DARK_POOL`); SSE tape still live — not a defect |
| `/heatmap` Matrix | ~477ms SPY | ✅ cache refreshes | optional overlays empty |
| `/heatmap` Profile | (same endpoint) | — | gamma profile via heatmap API |
| `/grid` | bootstrap + 8 routes 200 | 20–90s cadence | 12 panels via bootstrap + individual routes |
| `/nighthawk` | ~710ms | static edition | 0 plays midday (edition at close) |
| `/terminal` (Largo) | ~37s | — | grounded NVDA multi-tool answer |
| `/track-record` | ~210ms | LIVE | 12 closed |

### Missing-field audit (pass 1 — all expected/upstream)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| `dark_pool.pcr`, `lit_dark_ratio`, `prints[empty]` | desk/merged/nighthawk | `spx/merged` | **Upstream gap** — prints lack call/put split | Expected; do not fabricate |
| `flows[].alerted_at` / `event_at` | HELIX | `option_trades` WS path | **Upstream shape** — WS prints lack alert timestamps | Expected |
| `earnings.items[].eps_actual` / `surprise_pct` | grid | `/api/grid/earnings` | **Expected** — pre-report / future dates | none |
| `economy indicators rows[7].value` | grid | `/api/grid/economy` | **Upstream gap** — sparse FRED row | Expected |
| `events[empty]`, `cross_validation`, `nighthawk_context` | heatmap/dashboard | gex-heatmap overlays | **Optional overlays** — none active | Expected |
| `sector_bias`, `vol_regime`, `chart_levels.vah/val/poc` | grid pulse (schema) | `deskPayloadToSpxState` | **Not wired** — fields hardcoded null; PulseStrip UI does not render them | P2 backlog (not user-visible blank) |
| AAPL flip `—` | heatmap matrix | sparse far-dated chain | **Upstream gap** | Expected |

**No new P0/P1 data correctness defects.** No GitHub issue opened (all GREEN).

### Open watches (P2)

- `full-site-deep-audit` IWM transient false-positive — heatmap-matrix audit confirms IWM healthy (45 strikes)
- HELIX REST poll unchanged at 15s vs 30s cache — audit script should use ≥35s poll or compare `as_of`/head row id
- Sentry unresolved sample (8) — includes prior deploy DB timeout noise
- options-socket 3× recent 1006 in logs — socket-health ok (warn only)

---

## RTH comprehensive sweep — 2026-07-01 ~17:14–17:17 ET (pass 4 — post-close)

**Session:** Wed 1 Jul 2026, 17:14–17:17 ET (**post-close**; market closed 16:00 ET). Agent: autonomous cloud session. Premium Clerk admin via `sign_in_token` (temp user created/deleted). Browser GUI blocked in cloud sandbox — full sweep via authenticated API proxy (`scripts/audit/rth-browser-test.mjs`) + production validators.

### Validation summary

| Check | Result |
|---|---|
| `npm install` | ✅ restored deps (`pg` missing on fresh checkout) |
| `npm run validate:rth-open` | ✅ GREEN — deploy validation passed (post-close window; RTH session checks skipped after 16:15 ET) |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 3 oracle-confirmed, 71 consistency-only (`market_open: false`) |
| `node scripts/audit/rth-browser-test.mjs` | ✅ 37 PASS, 9 WARN (expected missing fields) |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (47 pass, 0 issues) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN (47 pass, 0 issues) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags |
| `node scripts/audit/data-validator.mjs` | ✅ 14 PASS, 8 WARN (unrounded floats — P2) |
| `npm run ops:collect` | ✅ 0 action items |

### API sweep (premium session — ~17:16 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/gex-heatmap?ticker=SPX` | 200 | ~262ms | 176 strikes, spot 7483.23 |
| `/api/market/spx/merged` | 200 | ~508ms | warm (not cold) |
| `/api/market/flows` | 200 | ~471ms | 500 rows |
| `/api/market/gex-heatmap?ticker=SPY` | 200 | ~138ms | 168 strikes |
| `/api/grid/bootstrap` + 8 panel routes | 200 | 71–92ms | all panels finite |
| `/api/market/nighthawk/edition` | 200 | ~116ms | 2 plays Jul 1 |
| `/api/public/track-record` | 200 | ~185ms | 12 closed (admin session) |
| Largo `/api/market/largo/query` | 200 | ~37s | NVDA grounded; tools=[live_feed_capture, get_dark_pool, get_options_flow] |
| SPX oracle | — | — | desk 7483.23 vs Polygon 7483.23 (Δ 0.00) |

**Cross-tool GEX:** SPX spot aligned across desk/heatmap/grid; data-correctness 0 flags.

### Page sweep (premium admin — API proxy, post-close)

| Page | Load | Live update | Notes |
|---|---|---|---|
| `/dashboard` | ~262ms heatmap / ~508ms merged | ✅ 15s poll changed | 176 strikes; spot live |
| `/flows` | ~471ms | ⚠ 15s poll unchanged | expected post-close tape freeze |
| `/heatmap` Matrix | ~138ms SPY | post-close cache | optional overlays empty |
| `/heatmap` Profile | (same endpoint) | — | gamma profile via heatmap API |
| `/grid` | bootstrap + 8 routes 200 | 90s cadence | 12 panels via bootstrap + individual routes |
| `/nighthawk` | ~116ms | static edition | 2 plays Jul 1 |
| `/terminal` (Largo) | ~37s | — | grounded NVDA multi-tool answer |
| `/track-record` | ~185ms | LIVE | 12 closed; admin session |

### Missing-field audit (pass 4 — all expected/upstream)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| `dark_pool.pcr`, `lit_dark_ratio` | desk/merged/nighthawk | `spx/merged` | **Upstream gap** — prints lack call/put split | Expected; do not fabricate |
| `flows[].alerted_at` / `event_at` | HELIX | `option_trades` WS path | **Upstream shape** — WS prints lack alert timestamps | Expected |
| `earnings.items[empty]` | grid | `/api/grid/earnings` | **Expected** — post-close / no near-term items | none |
| `economy indicators rows[7].value` | grid | `/api/grid/economy` | **Upstream gap** — sparse FRED row | Expected |
| `events[empty]`, `cross_validation`, `nighthawk_context` | heatmap/dashboard | gex-heatmap overlays | **Optional overlays** — none active post-close | Expected |
| META/TSLA flip `—` | heatmap matrix | sparse far-dated chain | **Upstream gap** | Expected |

**No new P0/P1 data correctness defects.** No GitHub issue opened (all GREEN).

### Open watches (P2)

- Unrounded floats across desk/gex/platform payloads — data-validator WARN
- HELIX tape no-change on 15s poll post-close — expected off-hours behavior
- Sentry unresolved sample (8) — includes deploy DB timeout noise from earlier today

---

## RTH comprehensive sweep — 2026-07-01 ~16:51–16:55 ET (pass 3 — post-close)

**Session:** Wed 1 Jul 2026, 16:51–16:55 ET (**post-close**; market closed 16:00 ET). Agent: autonomous cloud session. Premium Clerk admin via `sign_in_token` (temp user created/deleted). Browser GUI blocked in cloud sandbox — full sweep via authenticated API proxy (`scripts/audit/rth-browser-test.mjs`) + production validators.

### Validation summary

| Check | Result |
|---|---|
| `npm install` | ✅ restored deps (`pg` missing on fresh checkout) |
| `npm run validate:rth-open` (initial) | ❌ false RED — `validate-deploy` log grep saw stale options-socket 1006 failures=35 |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed, 69 consistency-only (`market_open: false`) |
| `node scripts/audit/rth-browser-test.mjs` | ✅ 38 PASS, 8 WARN (expected missing fields) |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (47 pass, 0 issues) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags |
| `node scripts/audit/data-validator.mjs` | ✅ 13 PASS, 1 FAIL (gamma posture sign — P2), 9 WARN (unrounded floats) |
| `npm run ops:collect` | ✅ 0 action items |
| `npm run validate:rth-open` (after fix) | ✅ GREEN — socket-health primary probe |

### Infra fix (this pass)

| Issue | Root cause | Fix |
|---|---|---|
| `validate:rth-open` false RED post-close | `validate-deploy.mjs` §5 failed on stale Railway log tail (`failures=35`) while `GET /api/cron/socket-health` reported `options.ok=true`, `off-hours — auth not required` | **FIX** branch `fix/validate-deploy-socket-health-offhours` — socket-health HTTP probe primary; log 1006 downgraded to warn when health ok |

### API sweep (premium session — ~16:53 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/gex-heatmap?ticker=SPX` | 200 | ~3091ms | 176 strikes, spot 7483.23 |
| `/api/market/spx/merged` | 200 | ~7922ms | cold tail |
| `/api/market/flows` | 200 | ~751ms | 500 rows |
| `/api/market/gex-heatmap?ticker=SPY` | 200 | ~141ms | 168 strikes |
| `/api/grid/bootstrap` + 8 panel routes | 200 | 69–4978ms | all panels finite |
| `/api/market/nighthawk/edition` | 200 | ~125ms | 2 plays Jul 1 |
| `/api/public/track-record` | 200 | ~183ms | 12 closed (admin session) |
| Largo `/api/terminal/query` | 200 | ~41s | NVDA grounded; tools=[live_feed_capture, get_dark_pool, get_options_flow] |
| SPX oracle | — | — | desk 7483.23 vs Polygon 7483.23 (Δ 0.00) |

**Cross-tool GEX:** SPX spot aligned across desk/heatmap/grid; data-correctness 0 flags.

### Page sweep (premium admin — API proxy, post-close)

| Page | Load | Live update | Notes |
|---|---|---|---|
| `/dashboard` | ~3.1s heatmap / ~7.9s merged | ✅ 15s poll changed | 176 strikes; spot live |
| `/flows` | ~751ms | ✅ 15s poll changed | 500 flow rows |
| `/heatmap` Matrix | ~141ms SPY | post-close cache | optional overlays empty |
| `/heatmap` Profile | (same endpoint) | — | gamma profile via heatmap API |
| `/grid` | bootstrap + 8 routes 200 | 90s cadence | 12 panels via bootstrap + individual routes |
| `/nighthawk` | ~125ms | static edition | 2 plays Jul 1 |
| `/terminal` (Largo) | ~41s | — | grounded NVDA multi-tool answer |
| `/track-record` | ~183ms | LIVE | 12 closed; admin session |

### Missing-field audit (pass 3 — all expected/upstream)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| `dark_pool.pcr`, `lit_dark_ratio` | desk/merged/nighthawk | `spx/merged` | **Upstream gap** — prints lack call/put split | Expected; do not fabricate |
| `flows[].alerted_at` / `event_at` | HELIX | `option_trades` WS path | **Upstream shape** — WS prints lack alert timestamps | Expected |
| `earnings.items[].eps_actual` / `surprise_pct` | grid | `/api/grid/earnings` | **Expected** — pre-report / future dates | none |
| `economy indicators rows[7].value` | grid | `/api/grid/economy` | **Upstream gap** — sparse FRED row | Expected |
| `events[empty]`, `cross_validation`, `nighthawk_context` | heatmap/dashboard | gex-heatmap overlays | **Optional overlays** — none active post-close | Expected |
| META flip `—` | heatmap matrix | sparse far-dated chain | **Upstream gap** | Expected |

**No new P0/P1 data correctness defects.** No GitHub issue opened (infra false-positive only).

### Open watches (P2)

- Unrounded floats across desk/gex/platform payloads — data-validator WARN
- Gamma posture vs net_gex sign mismatch — data-validator FAIL (consistency heuristic; data-correctness cron 0 flags)
- `spx/merged` cold-start ~8s post-close
- Sentry unresolved sample (8) — includes deploy DB timeout noise from earlier today

---


**Session:** Wed 1 Jul 2026, 14:52–15:15 ET (**RTH open**). Agent: autonomous cloud session. Premium Clerk admin via `sign_in_token` (temp users created/deleted). Browser GUI blocked in cloud sandbox — full sweep via authenticated API proxy (`scripts/audit/rth-browser-test.mjs`) + production validators.

### Validation summary

| Check | Result |
|---|---|
| `npm install` (initial) | ✅ restored `pg` dep for local validators |
| `npm run validate:rth-open` | ✅ GREEN (deploy + all RTH session checks) |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed, 73 consistency-only |
| `npm run ops:collect` | ✅ 0 action items (after npm install) |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (46 pass; track-record 401 = admin-gated, not a defect) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN (after audit script fix for admin-gated ledger) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags |
| `node scripts/audit/data-validator.mjs` | ✅ 16 PASS, 8 WARN (unrounded floats — P2) |
| `node scripts/audit/rth-browser-test.mjs` | ✅ PASS after fixing Largo `answer` / Nighthawk `plays` field checks |

### Infra events (resolved this pass)

| Event | Detail | Resolution |
|---|---|---|
| `grid-warm` / `nights-watch-warm` stale (watchdog) | Transient staleness at ~14:53 ET | Manual `GET /api/cron/grid-warm` + `nights-watch-warm` → 200 ok; crons re-ticked before re-audit |

### API sweep (CRON bearer + Clerk session — ~15:10 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/spx/desk` | 200 | ~350ms | SPX 7503.71, flip 7485.12, VIX 16.26 |
| `/api/market/spx/pulse` | 200 | — | live RTH |
| `/api/market/spx/merged` | 200 | ~24s cold | warms on first read |
| `/api/market/gex-positioning?ticker=SPX` | 200 | — | call 7550, put 7400 |
| `/api/market/gex-heatmap?ticker=SPX` | 200 | ~572ms | 174 strikes, spot 7504.09 |
| `/api/market/flows?limit=20` | 200 | ~750ms | 500 rows |
| `/api/grid/bootstrap` + 8 panel routes | 200 | 82ms–20s | all panels finite |
| `/api/market/nighthawk/edition` | 200 | ~122ms | 2 plays for 2026-07-01 |
| `/api/public/track-record` (admin session) | 200 | ~335ms | 12 closed (3W/9L) |
| SPX oracle | — | — | desk 7493.7 vs Polygon 7493.56 (Δ 0.14) |

**Cross-tool GEX:** desk flip 7485.12 = heatmap SPX flip; grid GEX Regime reads same `/api/market/gex-positioning?ticker=SPX` cache. SPY put-wall cross_validation divergence 5pt (consistency-only).

### Page sweep (premium admin — API proxy for all 7 pages)

| Page | Load | Live update | Notes |
|---|---|---|---|
| `/dashboard` | ~572ms heatmap / ~24s merged cold | ✅ 15s poll changed | 174 strikes; spot live |
| `/flows` | ~749ms | ✅ 15s poll changed | 500 flow rows |
| `/heatmap` Matrix | ~117ms SPY | ✅ cross_validation fresh | flip 746, call 748, put 745 |
| `/heatmap` Profile | (same endpoint) | ✅ | gamma profile via heatmap API |
| `/grid` | bootstrap + 8 routes 200 | 90s cadence | 12 panels via bootstrap + individual routes |
| `/nighthawk` | ~122ms | static edition | 2 plays Jul 1; AMD score 77 |
| `/terminal` (Largo) | ~60s | — | **grounded** NVDA answer (`answer` key); tools_used populated |
| `/track-record` | ~335ms | LIVE | 12 closed; admin session required for ledger API |

### Missing-field audit (pass 2)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| `dark_pool.pcr` | desk/merged/grid/nighthawk | `spx/desk`, `platform/snapshot` | **Upstream gap** — prints have no call/put split (`pcr: null`) | Expected; do not fabricate |
| `macro_events[].actual` | desk/merged | Benzinga calendar | **Expected** — events not yet released (ISM, ADP, etc.) | none |
| `net_prem_ticks[]`, `oi_changes[]`, `iv_term_structure[]` | merged | UW REST/cache | **Cold/optional enrichments** — empty arrays, not shown as fake values | none |
| `flows[].alerted_at` / `event_at` | HELIX | `option_trades` WS path | **Upstream shape** — WS prints lack alert timestamps vs `flow_alerts` REST | Expected for tape rows |
| `events[empty]`, `nighthawk_context` | heatmap | gex-heatmap overlays | **Optional overlays** — no active macro events / no nighthawk link today | Expected |
| META/TSLA far-dated flip `—` | heatmap matrix | sparse chain | **Upstream gap** | Expected (pass 1) |
| `/api/public/track-record` 401 unauthenticated | public | admin-gated since #132 | **Expected** — ledger requires admin Clerk session | none |

**No new P0/P1 data correctness defects.**

### Audit tooling fixes (this pass)

| Fix | Branch | Detail |
|---|---|---|
| `rth-browser-test.mjs` | `fix/rth-audit-script-fields` | Largo checks `answer` not `response`; Nighthawk checks `plays`/`recap_summary`; grid uses `/api/grid/bootstrap` + 8 panel routes |
| `full-site-deep-audit.mjs` | same | Track-record 401 with CRON-only bearer treated as admin-gated (not P1) |

### Open watches (P2 — no GitHub issue)

- Unrounded floats in desk/gex/platform payloads — data-validator WARN
- `putWallMatch:false` in gex_cross_validation (5pt divergence) — consistency-only
- Commentary rail retry on Anthropic miss — graceful standby UI exists
- `spx/merged` cold-start ~20–24s on first read after deploy — watch latency

---

**Session:** Wed 1 Jul 2026, 12:57–13:20 ET (**RTH open**). Agent: autonomous cloud session. Premium Clerk admin via `sign_in_token` (two temp users created/deleted). Pass at ~13:00 ET mid-session.

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` (initial) | ❌ `pg` missing locally → `npm install` |
| `npm run validate:rth-open` (post-deploy fail) | ❌ Railway deploy FAILED (DB healthcheck timeout) + Postgres SSL bug in `rth-open-check.mjs` |
| `npm run validate:rth-open` (final) | ✅ GREEN — after deploy SUCCESS + SSL fix + cron warm |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags (after manual `uw-cache-refresh` + `nights-watch-warm`; initial run had 2 freshness flags) |
| `npm run ops:collect` | ✅ 0 action items (after `npm install`) |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (46 pass, 1 P2 issue) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags |
| `node scripts/audit/data-validator.mjs` | ✅ 16 PASS, 8 WARN (unrounded floats — P2) |

### Infra events (resolved this pass)

| Event | Detail | Resolution |
|---|---|---|
| Railway deploy FAILED ×3 | `[ready] database ping failed: Query read timeout` during rolling deploy (~16:52 UTC); 5/5 replicas stayed on prior SUCCESS | Deploy `ecda463c` SUCCESS at 17:08 UTC; `/api/ready` 200 |
| `uw-cache-refresh` stale 129m | data-correctness freshness flag | Manual `hit-cron` → 24/24 refreshed; cron service `UW-Cache-Refresh-New` provisioned with `*/2 11-21 * * 1-5` UTC |
| `nights-watch-warm` stale 12m | data-correctness freshness flag | Manual `hit-cron` → ok; `Night's Watch-Warm-New` service exists |
| `rth-open-check` Postgres SSL | `The server does not support SSL connections` on Railway `proxy.rlwy.net` URL | **FIX** branch `fix/rth-open-pg-ssl-v2` — use shared `auditPgSsl()` from `pg-audit.mjs` |

### API sweep (CRON bearer — ~13:13 ET)

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `/api/market/spx/desk` | 200 | 176ms | SPX 7507.16, flip 7479.44 |
| `/api/market/spx/pulse` | 200 | 342ms | live RTH |
| `/api/market/spx/merged` | 200 | 424ms | |
| `/api/market/gex-positioning?ticker=SPX` | 200 | 753ms | call 7550, put 7400 |
| `/api/market/gex-heatmap?ticker=SPX` | 200 | 431ms | |
| `/api/market/flows?limit=20` | 200 | 8518ms | slow but ok |
| `/api/grid/*` (8 panels) | 200 | 46–13687ms | earnings slowest; all `as_of` fresh |
| `/api/grid/bootstrap` | 200 | — | warms all panel snapshots |
| `/api/market/nighthawk/edition` | 200 | 416ms | 2 plays for 2026-07-01 |
| `/api/public/track-record` | 401 | — | **expected** without session cookie |
| `/api/market/platform/snapshot` | 200 | 131ms | |
| SPX oracle | — | — | desk 7506.42 vs Polygon 7506.43 (Δ 0.01) |

**Cross-tool GEX:** desk flip 7479.44 = heatmap SPX flip 7479.44; grid GEX Regime panel reads same `/api/market/gex-positioning?ticker=SPX` cache.

### Browser sweep (premium admin — all 7 pages)

| Page | Hard load | Soft-nav | Live update | Console | Notes |
|---|---|---|---|---|---|
| `/dashboard` | ~2–3s | — | ✅ 8–10s tick | commentary POST errors (see below) | SPX 7495–7507 live; 0DTE matrix populated; all header metrics present |
| `/flows` | ~2s | <1s | ✅ REALTIME tape | 3 preload warnings | 12 flow anomalies (COIN, HOOD, AMD, NVDA, etc.) |
| `/heatmap` Matrix | ~2s | instant tab | ✅ LIVE badge | 2 warnings | SPY ~748.10; flip 746, call 750, put 745 |
| `/heatmap` Profile | ~2s | tab switch | ✅ gamma profile | same | Expiry filters + HELIX/DARK POOL overlays |
| `/grid` | ~2s | <1s | 90s panels | 5 warnings | 10+ panels populated (Pulse, News, Regime, Earnings, etc.) — no skeleton hang |
| `/nighthawk` | ~2s | <1s | static edition | clean | Jul 1 playbook; AMD score 77; track 62.5% target hit |
| `/terminal` (Largo) | ~1s | <1s | ~60s AI | 1 issue | NVDA grounded answer; sources TAPE/DESK/FLOW/ENGINE |
| `/track-record` | ~2s | <1s | LIVE checkpoint | clean | 3W/8L ODTE (11 total); Night Hawk checkpoint |

### Missing-field audit (pass 1)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| META flip `—` | heatmap matrix | far-dated chain sparse | **Upstream gap** | Expected (pass 6) |
| TSLA/AMD flip `—` | heatmap matrix | far-dated chain sparse | **Upstream gap** | Expected |
| Track-record auth view | `/track-record` | session required | **Expected** | Public embed uses `/api/public/track-record` |
| Commentary rail errors | `/dashboard` | `POST /api/market/spx/commentary` | Transient 503/retry loop during first session; route returns 503 only when `anthropicConfigured()` false | **P2 watch** — monitor; UI shows standby copy on failure |
| VIX/VWAP `—` on dashboard | off-hours prior passes | `spx/pulse` gated | N/A this pass — all fields live during RTH | none |

**No new P0/P1 data correctness defects.** Transient writer staleness cleared by manual warm + deploy recovery.

### Code fix shipped this pass

| Fix | Branch | Detail |
|---|---|---|
| `rth-open-check` Postgres SSL | `fix/rth-open-pg-ssl-v2` | Align with `auditPgSsl()` — Railway `proxy.rlwy.net` is plain TCP, not TLS |

### Open watches (P2 — no GitHub issue)

- Unrounded floats in desk/gex/platform payloads (6dp–13dp noise) — data-validator WARN
- `putWallMatch:false` in gex_cross_validation self-report (5pt divergence) — consistency-only
- Commentary rail retry spam on Anthropic miss — graceful standby UI exists
- Deploy healthcheck DB timeout during concurrent replica rollout — infra resilience watch

---

# BlackOut Open Issues Log (prior)
Last updated: 2026-06-30 17:45 ET

> **Shipping log:** Audit backlog batch 1 → **PR #132** (merged): cron timing-safe auth, dead code,
> Track Record nav, db-cleanup, Grid bootstrap. Closed duplicate PRs **#127–#130** — ignore those.
> Canonical audit probe list: `docs/api-audit/AUDIT-SKILL-REFERENCE.md` (in-repo SKILL:
> `.cursor/skills/platform-audit/SKILL.md`).

## RTH comprehensive sweep — 2026-06-30 ~17:21–17:45 ET (pass 7 — after-hours)

**Session:** Tue 30 Jun 2026, 17:21–17:45 ET (**after-hours**). Agent: autonomous cloud session. Premium Clerk admin via Playwright `sign_in_token` (audit user deleted post-pass). Confirms pass 6 with Playwright automation + Largo API session test.

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` | ✅ GREEN (off-hours deploy-only mode) |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed |
| `npm run ops:collect` | ✅ 0 action items |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (49 pass) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN (49 pass) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 flags |

### Pass 7 deltas vs pass 6

| Finding | Detail |
|---|---|
| **Grid 12/12 panels** | Playwright full-page screenshot confirms all panels populated (Pulse, News, Flow, Analysts, GEX Regime, Movers, Earnings, Dark Pool, Congress, Macro, Catalysts, Sector Heat) — **downgrades OPS-15 skeleton watch** for this pass |
| **Largo API** | NVDA query HTTP 200 ~40s — DP $31.37M (20 prints), 0DTE net $74.3M bullish, largest stack $14.37M Dec 2027 $220C |
| **Cross-tool GEX** | desk gamma_flip 7495.02 = gex-positioning SPX; Grid GEX Regime 7495/7500/7400; Thermal SPY flip 745 ≈ API 745.98 |
| **nighthawk/play-status 404** | `/api/nighthawk/play-status?date=2026-07-01` — **expected** (morning-confirm cron 09:15 ET; UI handles `available:false`) |
| **Track record** | UI 0W/9L matches `/api/public/track-record` — no split-brain |

### Browser sweep (Playwright — all 7 pages)

| Page | Load | Live update | Console | Notes |
|---|---|---|---|---|
| `/dashboard` | ~3s | static | clean | OFFLINE; spot 7499.36 + GEX walls live |
| `/flows` | ~3s | static | clean | after-hours |
| `/heatmap` Matrix+Profile | ~3s | LIVE badge, static 15s | clean | SPY 745.95; flip 745 / call 750 / put 745 |
| `/grid` | ~3s | static | clean | **12/12 panels populated** |
| `/nighthawk` | ~3s | EDITION LIVE | 404 play-status | 2 plays for 2026-07-01 |
| `/terminal` | ~3s | Largo ~40s | React #418 | grounded NVDA answer |
| `/track-record` | ~3s | LIVE ~23s | clean | 0W/9L ODTE; Night Hawk 62.5% |

**No new P0/P1** — all validation GREEN. No code fix or GitHub issue required.

## RTH comprehensive sweep — 2026-06-30 ~17:01–17:10 ET (pass 6 — after-hours)

**Session:** Tue 30 Jun 2026, 17:01–17:10 ET (**after-hours** — RTH is 9:30 AM–4:00 PM ET; market closed at 16:00). Agent: autonomous RTH cloud session. Premium Clerk admin session (`claude-audit-temp@blackouttrades.com`, `role:admin` + `tier:premium`). Clerk tier mint note: use `PATCH /v1/users/{id}/metadata` (not `updateUser`) so `tier:premium` persists.

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` (initial) | ❌ `pg` missing locally |
| `npm install` | ✅ deps restored |
| `npm run validate:rth-open` (final) | ✅ GREEN — deploy validation passed |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed (`market_open: false`) |
| `npm run ops:collect` | ✅ 0 action items |
| `node scripts/gha-rth-audit.mjs` | ✅ GREEN (49 pass) |
| `node scripts/full-site-deep-audit.mjs` | ✅ GREEN (49 pass) |
| `node scripts/heatmap-matrix-audit.mjs` | ✅ 15 tickers × 32 checks, 0 matrix flags |

### API sweep (CRON bearer — ~17:03 ET)

| Endpoint | HTTP | Notes |
|---|---|---|
| `/api/market/spx/desk` | 200 | SPX 7499.36, VIX 16.45, `available=true` |
| `/api/market/spx/pulse` | 200 | `available=false` — **expected** post-16:00 |
| `/api/market/gex-positioning?ticker=SPX` | 200 | flip 7495.02, call 7500, put 7400 |
| `/api/market/gex-positioning?ticker=SPY` | 200 | flip 745.12, call 750, put 735, spot 746.01 |
| `/api/grid/*` (8 panels) | 200 | sectors 11, dark-pool 20 prints, all `available=true` |
| `/api/market/nighthawk/edition` | 200 | 3 plays for 2026-06-30 |
| `/api/public/track-record` | 200 | **9 closed** (0W/9L) — live sync ✅ |

**SPX oracle:** desk 7499.36 vs Polygon 7499.36 (Δ 0.00).

### Browser sweep (premium admin — all 7 pages)

| Page | Hard load | Soft-nav | Live update | Console | Notes |
|---|---|---|---|---|---|
| `/dashboard` | ~4s | <1s | static 27s | CSS preload ×3 | EXTENDED+OFFLINE; VIX/VWAP/GEX/HOD `—` **expected** at close |
| `/flows` | ~3s | <1s | static (after-hours) | reflow 42ms | STALE 57m banner; 3 stale SPX flow rows |
| `/heatmap` Matrix | ~2s | instant tab | LIVE badge, spot +0.07% | reflow 52ms | SPY ~745.97; flip 746, call 750, put 745; matrix grid offline post-close |
| `/heatmap` Profile | ~10s | tab switch | gamma profile loaded | same | Positioning alert + expiration charts |
| `/grid` | ~3s | <1s | N/A | 2 issues | **P2 watch:** skeleton lattice; APIs 200 with data — backdrop/SWR paint (pass 2/4/5 same) |
| `/nighthawk` | ~2s | <1s | EDITION static | React #418 | 3 plays 2026-06-30; track record 62.5% target hit |
| `/terminal` (Largo) | ~2s | <1s | ~20s AI response | 2 issues | NVDA flow $16.37M+$10.10M stacks; sources LIVE DESK FEED / DARK POOL / OPTIONS FLOW |
| `/track-record` | ~2s | <1s | LIVE counter ticks ~60s | clean | ODTE 0W/9L; Night Hawk 62.5% (5W/3L) |

### Missing-field audit (pass 6)

| Field | Page | Backing API | Cause | Action |
|---|---|---|---|---|
| VIX, VWAP, GEX, HOD/POD/LvD/PDL, REGIME, breadth | `/dashboard` | `spx/pulse` `available=false` | **Expected off-hours** | none |
| Flow tape new rows | `/flows` | after-hours gate | **Expected off-hours** | none |
| Thermal matrix cells | `/heatmap` | chain offline post-close | **Expected off-hours** | none |
| Grid panel bodies slow/blank | `/grid` | `/api/grid/*` all 200 | **Cold client render** / backdrop lattice | **P2 watch** |
| TSLA/AMD flip `—` | heatmap matrix audit | far-dated chain sparse | **Upstream gap** | Expected |

### Cross-tool agreement (verified)

| Metric | Dashboard/Grid | Thermal | Largo | API canonical |
|---|---|---|---|---|
| SPX spot | desk | — | — | 7499.36 (`spx/desk`) |
| SPY spot | — | ~745.97 | — | 746.01 (`gex-positioning`) |
| SPX GEX flip/walls | — | — | — | 7495 / 7500 / 7400 (`gex-positioning`) |
| Track record closed | 9 | — | — | 9 (`public/track-record`) |

### Ops watch

| ID | Item | Status |
|---|---|---|
| **OPS-7** | Sentry 4× `Not Found` + `fetch failed` | Watch — unchanged |
| **OPS-13** | React #418 on `/nighthawk` | **P2** — known hydration class |
| **OPS-14** | CSS preload warnings (all pages) | **P2** — non-blocking perf |
| **OPS-15** | Grid panel skeleton paint lag | **P2 watch** — APIs healthy; client render |

**No new P0/P1** — all validation GREEN. No code fix required this pass. No GitHub issue opened.

## RTH comprehensive sweep — 2026-06-30 ~16:04–16:15 ET (pass 5 — after-hours)

**Session:** Tue 30 Jun 2026, 16:04–16:15 ET (**after-hours** — RTH is 9:30 AM–4:00 PM ET; market had closed at 16:00). Agent: autonomous cloud session. Premium Clerk admin session (`claude-audit-temp@blackouttrades.com`, `role:admin` + `tier:premium`). Live-update and missing-field findings below reflect post-close state, not in-session RTH behavior.

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
