# SPX Slayer — all-day RTH verification agent (autonomous)

**Mission:** Zero tolerance for SPX defects. Every button on `/dashboard`, every GEX/VEX matrix cell, every cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk, BIE) must be **100% correct** during RTH. The agent runs **automatically from market open through close**, logs every flaw, and **fixes everything after the bell** — no operator prompts.

**First live session:** **Monday 2026-07-06** · **Opens 6:30 AM PT** (= 9:30 AM ET).

| PT | ET | Mode |
|---|---|---|
| **6:30 AM** | **9:30 AM** | **First verify pass (market open)** |
| 6:30 AM – 1:00 PM | 9:30 AM – 4:00 PM | Verify passes every ~90 min |
| **~1:05 PM** | **4:05 PM** | **Post-close fix — merge until fully GREEN** |

**Merge before open:** **PR #539** (pulse/flow cache + SCANNING confirmations) + **PR #540** (this agent + scripts).

---

## Agent modes

| Mode | When | Behavior |
|---|---|---|
| **`verify`** | Every scheduled pass during RTH | Full API + UI E2E; click **every** control; validate **every** matrix cell (GEX + VEX); cross-tool integration; fix **P0 only** live; log all else |
| **`fix`** | Post-close (~1:05 PM PT) | Fix **every** SPX finding from today; test; PR; merge; re-run full suite until **zero FAIL** |

**Never ask the user for permission.**

---

## Step 0 — Read this runbook end-to-end

You are the **SPX Slayer all-day agent**. Your bar is institutional: **not a single bug, flaw, stale number, or broken integration**.

---

## Step 1 — Automated probe suite (every pass)

```bash
# Primary gate — exits non-zero on any FAIL
npm run validate:spx-rth

# Full dashboard E2E — clicks buttons, matrix UI vs API, cross-tool integration
npm run validate:spx-e2e

# Cross-provider oracle (when POLYGON + UW keys are literal, not ${{...}})
node scripts/audit/data-validator.mjs
```

### What `validate:spx-rth` covers

1. **`validate:rth-open`** — deploy, crons, `spx-evaluate`, options-socket authenticated
2. **Matrix deep audit** — `heatmap-matrix-audit.mjs --tickers=SPX`
   - **Every GEX / VEX / DEX / CHARM cell** finite
   - Σ `strike_totals` == headline `total` per lens
   - **Every strike:** cell re-sum vs `strike_totals` (INV-2)
   - Walls, flip, king derivations
   - Mapper vs `gex-positioning`
3. **Cross-endpoint spot/GEX** — desk, heatmap, positioning, play (Δ ≤ 0.15 pts spot)
4. **Desk cache lanes** — desk / pulse / flow / merged agree when lanes live
5. **`validate:spx-bie`** — member `/spx/play` == `getSpxPlayState()` (BIE + Largo single derivation)
6. **`data-correctness` cron** — zero SPX-layer flags
7. **`ops:collect`** — zero action items

---

## Step 2 — UI E2E: click EVERY control on `/dashboard`

Run: **`npm run validate:spx-e2e`** (Playwright — `npx playwright install chromium` once per VM).

If Playwright is blocked, manually execute the checklist below via `computerUse` or production browser against `https://blackouttrades.com/dashboard` with a premium admin session (`sign_in_token` — delete user after).

### 2A — Sign-in & shell

| # | Action | Pass |
|---|---|---|
| 1 | Open `/dashboard` with premium session | Page loads, no upgrade wall |
| 2 | Wait for skeleton to clear | Header + matrix + trade alerts visible |
| 3 | Check console | **Zero** errors (ignore benign ticker-search 400 off-dashboard) |
| 4 | `FreshnessChip` / LIVE badge | Not `stale` during RTH when APIs fresh |

### 2B — SPX header (`SpxSniperHeader`)

| # | Action | Pass |
|---|---|---|
| 5 | SPX price | Matches `/api/market/spx/desk` `price` within **0.15** pts |
| 6 | VIX, VWAP, γ-flip, tide | Finite; γ-flip matches `gex-positioning` flip |
| 7 | Session indicators | RTH copy correct (not "MARKET CLOSED" during RTH) |

### 2C — 0DTE GEX matrix (`SpxGexMatrixHeatmap`) — **CRITICAL**

| # | Action | Pass |
|---|---|---|
| 8 | Click **GEX** tab (`#spx-matrix-tab-gex`) | Tab activates; matrix populates; `role=tab` aria correct |
| 9 | Click **VEX** tab (`#spx-matrix-tab-vex`) | VEX cells populate (or tab hidden if no VEX — then SKIP) |
| 10 | Click **GEX** again | Returns to GEX without error |
| 11 | Count strike rows | ≥ **80** during RTH |
| 12 | **Every visible cell** | Finite formatted value or `·` at zero — **never** `NaN`, `undefined`, `$—` |
| 13 | **GEX king ★** | Visible on 0DTE expiry column; matches argmax \|net GEX\| from API |
| 14 | **Spot row** | Tracks live spot; updates within **8s** poll without manual refresh |
| 15 | Net GEX / Net VEX headline | Matches API `gex.total` / `vex.total` |
| 16 | Scroll matrix vertically | No layout break; cells stay aligned |
| 17 | Compare **20 sampled cells** (GEX + VEX) | Match `/api/market/gex-heatmap?ticker=SPX` JSON within formatting tolerance |

**Cell validation rule:** For each strike `K` and near-term expiry `E`, UI displayed value must equal API `cells[K][E]` after shared `fmtHeatmapMoneySigned` formatting. Re-sum of cells for strike `K` must equal `strike_totals[K]`.

### 2D — Trade alerts (`SpxTradeAlerts`)

| # | Action | Pass |
|---|---|---|
| 18 | Hero action | Matches `/api/market/spx/play` `action` + `direction` |
| 19 | **SCANNING state** | **No** confirmation panel with stale ✓ checks |
| 20 | WATCHING / BUY | Confirmations match play API when present |
| 21 | Score / confidence | Match play payload |
| 22 | Entry / stop / target levels | Match play `levels` when non-null |
| 23 | Lotto dock (`.spx-lotto-dock`) | Renders; status matches `/api/market/spx/lotto` |
| 24 | Power hour dock | Visible 2:45–3:15 PM ET; matches `/api/market/spx/power-hour` |
| 25 | Play history list | Updates on action transitions without refresh |

### 2E — Commentary rail (`SpxCommentaryRail`)

| # | Action | Pass |
|---|---|---|
| 26 | Click expand/collapse button | Toggles without error |
| 27 | Commentary text | Grounded (from server cache on miss — no hallucinated numbers) |

### 2F — Halt banners (when applicable)

| # | Action | Pass |
|---|---|---|
| 28 | Active halt banner | Matches desk `active_halts` |
| 29 | Degraded halt feed banner | Only when `halt_channel_stale` + session active; never claims "blocked" incorrectly |

---

## Step 3 — Cross-tool integration (SPX as hub)

Validate SPX numbers **agree across the ecosystem**. Use authenticated API calls or tool traces.

| Tool | Endpoint / probe | Must agree with SPX Slayer |
|---|---|---|
| **BlackOut Thermal** | `GET /api/market/gex-heatmap?ticker=SPX` | **Same payload** as dashboard matrix (shared route + `gex-heatmap-display.ts`) |
| **Thermal SPY** | `GET /api/market/gex-heatmap?ticker=SPY` | `cross_validation` flags if diverged — log WARN |
| **GEX positioning** | `GET /api/market/gex-positioning?ticker=SPX` | spot, flip, walls, net_gex == matrix header |
| **HELIX** | `GET /api/market/flows?limit=30` | SPX/SPXW prints during active tape; desk tide direction consistent |
| **Largo** | `POST /api/market/largo/query` — *"Current SPX play state?"* | Uses `get_spx_play` or `get_ecosystem_context`; answer grounded |
| **BIE** | `validate:spx-bie` | `spx_full_state` == member `/spx/play` (same `getSpxPlayState()`) |
| **Grid** | `GET /api/grid/bootstrap` | Loads; SPX spot in macro context not stale vs desk |
| **0DTE Command** | `GET /api/market/zerodte/board` | SPX setups reference live spot; no fabricated premiums |
| **Night Hawk** | `GET /api/market/nighthawk/edition` | Edition loads; SPX positioning echo consistent with gex-positioning |
| **Track record** | `GET /api/public/track-record` | SPX play stats arithmetically correct |

**Single-source rules (never duplicate):**
- GEX matrix → `/api/market/gex-heatmap` only
- Play state → `spx-evaluate` cron write / `readSpxPlaySnapshot` read
- BIE `spx_full_state` + Largo `get_spx_play` → **`getSpxPlayState()` only**

---

## Step 4 — Live auto-update (no manual refresh)

On `/dashboard`, sit **60 seconds** without refreshing:

| Surface | Expected cadence |
|---|---|
| Header SPX price | ~1.5–3s (pulse) |
| Matrix spot row | ~8s RTH |
| Trade alert hero | ~3s |
| Matrix cells | ~8s RTH (server cache `SPX_GEX_HEATMAP_CACHE_SEC` default 8) |

Flag anything static during RTH that should tick.

---

## Step 5 — Log findings

Append to **`docs/api-audit/OPEN-ISSUES.md`** with tag **`spx-rth-YYYY-MM-DD`**:

```
| Severity | ID | Detail | Backing API | Fix defer? |
```

- **P0** (wrong trade signal, data leak, matrix cell wrong vs API) → **fix immediately** in verify mode
- **P1** (cross-tool disagreement, stale confirmations, cache lane split) → fix in verify if trivial; else post-close
- **P2** (UX labeling, king scope confusion) → post-close

Open GitHub issue with label **`ops-auto-fix`** for any P0/P1.

---

## Step 6 — Post-close fix mode (~1:05 PM PT)

1. `npm run validate:spx-rth -- --phase=post-close`
2. `npm run validate:spx-e2e`
3. Read all today's `spx-rth-*` tagged findings
4. For **each** issue: `fix/<slug>` → test → `docs/audit/FINDINGS.md` → PR → merge
5. Loop: `validate:deploy-wait` → `validate:spx-rth` → `validate:spx-e2e` until **zero FAIL**
6. Append post-close summary — must end **GREEN**

---

## Schedule (auto-launch)

**GitHub:** `.github/workflows/spx-rth-all-day-agent.yml`  
**Requires:** `CURSOR_API_KEY` in repo secrets

| Pass | PT | ET | UTC (EDT Jul) | Mode |
|---|---|---|---|---|
| **Market open** | **6:30** | **9:30** | **13:30** | verify |
| Post-open | 6:45 | 9:45 | 13:45 | verify |
| Mid-morning | 8:00 | 11:00 | 15:00 | verify |
| Midday | 9:30 | 12:30 | 16:30 | verify |
| Afternoon | 11:00 | 14:00 | 18:00 | verify |
| Pre-close | 12:30 | 15:30 | 19:30 | verify |
| Last tick | 12:55 | 15:55 | 19:55 | verify |
| **Post-close fix** | **1:05** | **4:05** | **20:05** | **fix** |

Dual EST crons (+1h UTC) are in the workflow file.

---

## Cursor Automation (if GitHub secret missing)

Create at [cursor.com/automations](https://cursor.com/automations):

### Verify automation — starts **6:30 AM PT** weekdays

**Prompt (paste verbatim):**

> You are the SPX Slayer all-day RTH verification agent. Read **`docs/ops/SPX-RTH-ALL-DAY-AGENT.md`** completely and execute **verify** mode. Run **`npm run validate:spx-rth`** then **`npm run validate:spx-e2e`**. On `/dashboard`: click **every button** (GEX tab, VEX tab, commentary expand); validate **every matrix cell** (GEX and VEX) against `/api/market/gex-heatmap?ticker=SPX`; confirm trade alerts match `/api/market/spx/play` with **no stale confirmations during SCANNING**; verify integrations with **Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk, BIE** per the runbook § Step 3. Sit 60s and confirm live auto-update. Log all findings to **`docs/api-audit/OPEN-ISSUES.md`** tagged **`spx-rth-YYYY-MM-DD`**. Fix P0 immediately. Do **not** ask the user.

### Fix automation — **1:05 PM PT** weekdays

**Prompt:**

> SPX Slayer post-close fix agent. Read **`docs/ops/SPX-RTH-ALL-DAY-AGENT.md`** § Step 6. Run **`npm run validate:spx-rth -- --phase=post-close`** and **`npm run validate:spx-e2e`**. Fix **every** SPX issue from today (matrix cells, desk/play divergence, confirmations, cache lanes, cross-tool integration). Branch **`fix/<slug>`**, test, **`docs/audit/FINDINGS.md`**, PR, merge, **`validate:deploy`**. Repeat until **zero FAIL**. Do **not** stop until fully GREEN. Do **not** ask the user.

---

## Secrets

| Secret | Purpose |
|---|---|
| `CURSOR_API_KEY` | Launch Cloud Agents |
| `CRON_SECRET` | SPX cron bearer probes |
| `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | E2E sign-in |
| `DATABASE_PUBLIC_URL` | Cron freshness |
| `POLYGON_API_KEY` + `UW_API_KEY` | `data-validator.mjs` oracle |

---

## Related

- `docs/ops/RTH-OPEN-RUNBOOK.md` — general RTH infra
- `docs/audit/SPX-AUDIT-FIXES-2026-07-05.md` — recent SPX fixes
- `.cursor/skills/platform-audit/SKILL.md`
