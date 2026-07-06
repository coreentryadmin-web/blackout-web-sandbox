# 0DTE Command + Market Grid — all-day RTH verification agent (autonomous)

**Mission:** Zero tolerance for 0DTE logic defects, play picking, trade management, and Grid UI. The agent runs **automatically from market open through close**, logs every flaw, and **fixes everything after the bell** — no operator prompts.

**First live session:** **Monday 2026-07-06** · **Opens 6:30 AM PT** (= 9:30 AM ET).

| PT | ET | Mode |
|---|---|---|
| **6:30 AM** | **9:30 AM** | **First verify pass (market open)** |
| 6:30 AM – 1:00 PM | 9:30 AM – 4:00 PM | Verify passes every ~90 min |
| **~1:05 PM** | **4:05 PM** | **Post-close fix — merge until fully GREEN** |

---

## Agent modes

| Mode | When | Behavior |
|---|---|---|
| **`verify`** | Every scheduled pass during RTH | Full logic audit + Grid API probes + UI E2E; fix **P0 only** live; log all else |
| **`fix`** | Post-close (~1:05 PM PT) | Fix **every** Grid/0DTE finding from today; test; PR; merge; re-run until **zero FAIL** |

**Never ask the user for permission.**

---

## Step 1 — Automated probe suite (every pass)

```bash
# Primary orchestrator — grid panels, zerodte board, crons, ops
npm run validate:grid-rth

# Exhaustive 0DTE logic — gates, plans, lifecycle, mergePlays, unit tests
npm run validate:zerodte-logic

# /grid UI + member API paths (Playwright when available)
npm run validate:grid-e2e

# Cross-provider oracle (when keys are literal)
node scripts/audit/data-validator.mjs
```

### What `validate:grid-rth` covers

1. **`validate:rth-open`** — deploy, crons, writers
2. **All 9 `/api/grid/*` panels** — finite numbers, `as_of` freshness (cron bearer bypasses launch gate)
3. **`/api/market/zerodte/board`** — upstream_ok, session heat, ledger PnL math
4. **Cross-tool** — Grid bootstrap spot vs GEX, HELIX flows, Night Hawk dedupe
5. **`grid-warm` cron** — warms panels + `warmZeroDteBoard()`
6. **`data-correctness`** — zero grid/zerodte flags
7. **`validate:grid-e2e`** when Clerk keys present
8. **`ops:collect`** — zero action items

### What `validate:zerodte-logic` covers

1. **Unit tests** — `board.test.ts`, `rejections.test.ts`, `ZeroDteBoard.test.ts`
2. **Gate funnel** — every emitted setup passes SETUP_MIN_GROSS, aggression, dominance, ITM guard
3. **Plan exits** — stop -50%, target +100%, time stop 15:30 ET
4. **Trade lifecycle** — OPEN → TRIM → CLOSED (sticky trough stop)
5. **Plan grading** — stop wins when both touch same bar
6. **Session heat** — RTH vs POWER_HOUR aligns with 15:00 ET cutoff
7. **UI mergePlays** — past cutoff / MOVED → SKIP not OPEN
8. **Live board** — gate invariants, ledger PnL, finite numbers

---

## Step 2 — UI E2E: `/grid`

Run: **`npm run validate:grid-e2e`**

| # | Action | Pass |
|---|---|---|
| 1 | Admin session opens `/grid` | Page loads, no upgrade wall |
| 2 | Click **0DTE Command** tab | Session heat header visible |
| 3 | Click **Market Grid** tab | Search bar + panels mount |
| 4 | Search **SPY** | Ticker filter accepts input |
| 5 | Console | Zero errors |

---

## Step 3 — 0DTE architecture (what to verify)

| Layer | Source | Checks |
|---|---|---|
| Scanner | `scanZeroDteBoard()` via `grid-warm` cron | `max_dte:1` on flow fetch; Night Hawk dedupe |
| Gates | `deriveZeroDteSetups()` | 4 gates + rejection funnel |
| Plans | `buildContractPlan()` | Real quote/fill only; illiquid spread >15% |
| Ledger | `persistZeroDteScan()` | No new plays after 15:00 ET |
| Trade mgmt | `syncLedgerLiveState()` + `derivePlayStatus()` | Peak/trough latch; 15:30 hard exit |
| UI | `ZeroDteBoard.tsx` | `mergePlays()` ledger-first; freshness from `upstream_ok` + `as_of` |

---

## Step 4 — Fix workflow (post-close)

1. Branch `fix/<slug>` off `main`
2. Fix + test in nearest `*.test.ts`
3. Log in `docs/audit/FINDINGS.md`
4. Draft PR → merge → `npm run validate:deploy-wait`
5. Re-run full suite until GREEN

---

## GitHub Actions schedule

Workflow: `.github/workflows/grid-rth-all-day-agent.yml`

Requires **`CURSOR_API_KEY`** in GitHub secrets (same as SPX agent).

Cron mirrors SPX: first pass **6:30 AM PT**, fix pass **~1:05 PM PT**.
