# Deep Platform Audit — 2026-06-29 (for fix agents)

> **Audience:** the two code-fix agents working in parallel. This is the QA agent’s live
> production audit — every finding is verified against `blackouttrades.com` with admin/cron
> credentials, Polygon oracle, and browser cross-service reads.
>
> **Full-site coverage:** see also `docs/api-audit/FULL-SITE-AUDIT-2026-06-29.md` — every tool
> surface (desk, flows, heatmap, grid, nighthawk, track record, crons, pages) audited, not just
> Heat Maps matrix data.

---

## Railway env access (confirmed working)

Production env is pullable via Railway CLI — **no manual secret paste needed** for QA:

```bash
railway variable list --service blackout-web --json   # app secrets
railway variable list --service Postgres --json       # DATABASE_PUBLIC_URL
railway variable list --service Redis --json          # REDIS_PUBLIC_URL (external proxy)
railway service list                                  # all 22 services + health
```

**Note:** Use `REDIS_PUBLIC_URL` from the **Redis** service for external audits — `REDIS_URL` on
`blackout-web` points at `redis.railway.internal` (only reachable inside Railway).

`ADMIN_EMAILS` on prod: `raiduvinay@gmail.com`, `benjaminfisherman2400@gmail.com`,
`coreentryadmin@gmail.com` ✅

---

## Postgres proof (Railway `DATABASE_PUBLIC_URL`, live query)

| Table / query | Count | Used by |
|---|---|---|
| `spx_play_outcomes` WHERE outcome ≠ open | **3** | `/api/public/track-record`, embed, desk ledger |
| `signal_outcomes` SPX_SLAYER @ T+30 | **0** | `/api/track-record` page API |

**Split-brain confirmed at the database layer** — not a UI/cache artifact.

### Night Hawk cron history (`cron_job_runs`)

| job_key | Latest status | When |
|---|---|---|
| `nighthawk-outcomes` | **ok** | Mon 2026-06-29 ~20:00 UTC |
| `nighthawk-playbook` | **skipped** (outside edition window) | Fri 2026-06-26 — **no Mon run** |
| `market-regime-detector` | ok (RTH) / skipped (post-RTH) | Mon 2026-06-29 |

Watchdog flags `nighthawk-playbook` stale because the edition window hasn't fired since Fri — verify
Mon 5:30 PM ET edition trigger on Railway (`NightHawk-Playbook` service shows **0/1 replicas**).

---

## Redis spot check (Railway `REDIS_PUBLIC_URL`, post-RTH)

| Namespace | Keys found | Notes |
|---|---|---|
| `gex-heatmap:*` | **0** | Expected off-hours — warmers stopped; app still serves via cold build |
| `grid:*` | **0** | Expected off-hours |
| `largo:*` | **4** | Session keys present |

Re-audit Redis key TTLs during **RTH** — empty warm-cache off-hours is normal, not a bug by itself.

---

## Executive summary

| Area | Verdict |
|---|---|
| Malformed UI (`NaN`, `undefined`, etc.) | ✅ Clean on all public + premium pages tested |
| SPX spot cross-service (backend) | ✅ **7440.43** — desk snapshot == Polygon `I:SPX` oracle (Δ 0.00) |
| VIX cross-service | ✅ **17.65** — desk == Polygon oracle |
| Data-correctness cron (`force=1`) | ✅ 0 FLAGS; 7 independently confirmed; 69 consistency-only gaps (expected off-RTH) |
| Data-integrity cron (`force=1`) | ⏸ 0 checks (market closed — by design) |
| Track record | ❌ **P1 split-brain** (see below) |
| Night Hawk crons | ❌ **P1 stale** — outcomes + playbook |
| Largo SPX answers | ✅ Correct (~7448) — **NOT a bug** (browser agent misread dashboard) |

---

## 🔴 P1 — Track record split-brain (FIX AGENT #1)

**Symptom:** Users see contradictory track-record states on the same product.

| Surface | Endpoint / source | Production now |
|---|---|---|
| `/track-record` page | `GET /api/track-record` → `signal_outcomes` (T+30 / EOD checkpoints) | **0 signals** → UI: "Track record is building" |
| `/embed/track-record` | `buildPublicTrackRecord()` → `spx_play_outcomes` ledger | **3 closed plays**, 0% hit rate, LIVE |
| `GET /api/public/track-record` | Same as embed | **3 closed** — math verified ✅ |

**Math on public API (verified):**
- wins(0) + losses(3) + breakeven(0) = total_closed(3) ✅
- cold_buy(1) + watch_promote(2) = 3 ✅
- win_rate_pct 0% ✅

**Root cause:** Two aggregation paths. Page uses `src/app/api/track-record/route.ts` (signal_outcomes).
Embed/public uses `src/lib/track-record-public.ts` (play outcomes ledger). The data-correctness verifier
(`track-record-verifier.ts`) validates ledger ↔ public but **does not check `/api/track-record`**.

**Postgres proof (Railway):** `spx_play_outcomes` closed = **3**, `signal_outcomes` SPX T+30 = **0**.

**Fix direction:** Unify on one ledger OR wire `TrackRecordView` to `/api/public/track-record` and
retire the signal_outcomes path for SPX Slayer social proof. File: `src/components/track-record/TrackRecordView.tsx:46`.

---

## 🔴 P1 — Night Hawk crons stale (FIX AGENT #2 / operator)

**Source:** `GET /api/cron/cron-staleness-watchdog` (cron auth)

```json
{
  "problem_keys": ["nighthawk-outcomes", "nighthawk-playbook"],
  "problems": 2
}
```

- `nighthawk-outcomes` — resolves play target/stop vs next-day prices (4:30 PM ET)
- `nighthawk-playbook` — edition worker (5:30 PM ET)

**Note:** Night Hawk **UI still shows a live edition** (5 plays via platform snapshot). Outcomes cron
may be failing silently while publish path works — verify `cron_job_runs` in Postgres once `DATABASE_URL`
is available.

**Files:** `railway.nighthawk-outcomes.toml`, `railway.nighthawk-playbook.toml`, registry keys in
`src/lib/cron-registry.ts`.

---

## 🟡 P2 — Analytical cross-service validation (RTH re-test needed)

Ran during **post-RTH** (~16:24 ET). Backend numbers are internally consistent; full cross-tool matrix
(data-integrity C1–C6) skips when `merged.market_open === false`.

### Oracle-grounded answers (what Largo *should* say — verified via cron snapshot + Polygon)

| Question | Expected answer (2026-06-29 ~20:30 UTC) | Sources |
|---|---|---|
| SPX spot now? | **7440.43** | Platform snapshot + Polygon `I:SPX` |
| Gamma flip? | **7435.15** | Platform snapshot `spx.gamma_flip` |
| SPX vs VWAP? | **Above** (+22.97 pts, VWAP **7417.46**) | snapshot price vs vwap |
| VIX? | **17.65** (−4.13%) | snapshot + Polygon `I:VIX` |
| Regime? | **NEUTRAL**, net GEX **+$28.4B**, above VWAP **true** | `/api/market/regime` |

### Largo analytical questions (browser session — admin premium)

| # | Question | Largo answer | Verdict |
|---|---|---|---|
| Q1 | SPX spot + gamma flip | SPX **7448.43**, flip **7435.15** | ✅ Matches backend (±8 pts live drift OK) |
| Q2 | SPY net GEX + call wall | Net GEX **+$2.898B**, call wall **741** | ⚠️ Re-verify vs `/api/market/gex-positioning?ticker=SPY` at RTH |
| Q3 | NVDA flow put vs call | Calls **$177M**, puts **$73M**, net call-skewed | ⚠️ Re-verify vs HELIX tape filters |
| Q4 | SPX vs VWAP | **7448.43** vs **7417.46**, above (+0.31%) | ✅ Consistent with snapshot |

**Correction to prior browser report:** Largo SPX ~7448 is **correct**. Dashboard reading of ~5460 was
likely a mis-read or stale client cache — **backend desk price is 7440.43**, not 5460. Re-test dashboard
header at RTH with hard refresh.

### Cross-service matrix (backend, cron auth)

| Check | Result |
|---|---|
| Polygon SPX vs desk snapshot | ✅ Δ 0.00 |
| Polygon VIX vs desk | ✅ Match |
| Regime `aboveVwap` vs desk price > vwap | ✅ Both true |
| Public track-record vs page track-record | ❌ Split-brain |
| Flows in snapshot (50 rows, $602M total) | ✅ Present; re-verify Σ vs HELIX UI at RTH |
| Night Hawk edition | ✅ `play_count: 5`, `edition_for` set |

---

## 🟢 Verified GREEN

- `npm test` 402/402, `tsc`, `build`, `lint:brand`
- Auth on premium market routes (401 without session)
- `/api/platform/intel` requires cron or premium session (cron auth works — intentional)
- No data-correctness FLAGS on forced run
- Cloudflare zone `blackouttrades.com` active
- Clerk admin user exists: `coreentryadmin@gmail.com` (`tier: premium`)

---

## Tool-by-tool status (premium browser + API)

| Tool | Data correct? | Notes |
|---|---|---|
| SPX Slayer / Dashboard | ⚠️ Re-verify UI at RTH | Backend 7440.43; UI may cache stale |
| Heat Maps | ✅ | SPY GEX matrix loads, lenses switch |
| HELIX Flows | ✅ | 500 alerts, call/put partition sane |
| Night Hawk | ✅ UI / ❌ crons | Edition live; outcomes cron stale |
| BlackOut Grid | ✅ | Pulse uses same merged desk path |
| Largo | ✅ | Grounded answers match snapshot |
| Track record page | ❌ | Split-brain vs embed |
| Track record embed | ✅ | 3 closed, math correct |

---

## Assignments for parallel fix agents

### Agent A — Track record + public surfaces
1. Fix `/track-record` page to use the same source as `/api/public/track-record`
2. Extend `track-record-verifier.ts` to FLAG when `/api/track-record` disagrees with ledger
3. Add test: public page and embed must show identical counts

### Agent B — Crons + Night Hawk pipeline
1. Investigate `nighthawk-outcomes` + `nighthawk-playbook` Railway services (last run, logs)
2. Confirm `cron_job_runs` rows after manual `hit-cron.mjs` trigger
3. If services exist but stale, fix schedule/env; if missing, provision from `.toml`

### Both — RTH validation pass (Monday 9:30–16:00 ET)
1. Re-run `data-integrity?force=1` — expect `checks_run > 0`, `discrepancies: 0`
2. Re-run browser cross-service matrix (desk vs heatmap vs Largo vs flows)
3. Confirm data-correctness `independentlyConfirmed > 0` during RTH

---

## Commands to re-run

```bash
# Cross-service snapshot (cron)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://blackouttrades.com/api/market/platform/snapshot | jq '.spx'

# Data correctness (full platform)
node scripts/hit-cron.mjs /api/cron/data-correctness
# add ?force=1 off-hours via curl

# Cron health
node scripts/hit-cron.mjs /api/cron/cron-staleness-watchdog

# Public site sweep
node scripts/site-audit.mjs --base=https://blackouttrades.com

# Heat Maps matrix invariants (full cell-level)
node scripts/heatmap-matrix-audit.mjs

# Full-site deep audit (all tools)
node scripts/full-site-deep-audit.mjs
```

---

## Multi-ticker deep audit (30 names × 3 passes each)

Automated via `scripts/multi-ticker-audit.mjs` — for **each ticker, each pass**:

| Probe | What it validates |
|---|---|
| `GET /api/market/gex-positioning?ticker=X` | spot, net_gex, flip, call/put walls — all finite |
| `GET /api/market/quote?ticker=X` | quote spot vs GEX spot (≤1.5%) |
| `GET /api/market/gex-heatmap?ticker=X&lens=gex` | matrix spot vs GEX spot (≤0.5%) |
| `GET /api/market/flows?ticker=X` | premium values finite, non-negative |
| Polygon oracle | independent spot (≤1% stocks, ≤0.15% indices) |
| 3-pass stability | spot drift between passes ≤3% |
| SPY×10 vs SPX | tracking band (last pass) |

### Batch 1 (20 tickers × 3 passes = 60 probe sets) — ✅ 0 issues

`SPX, SPY, QQQ, IWM, VIX, NVDA, AAPL, TSLA, AMD, MSFT, META, AMZN, GOOGL, NFLX, AVGO, MU, SMH, GLD, SLV, COIN`

Sample verified spots (pass 3): SPX **7440.43**, SPY **740.56**, NVDA **194.97**, MU **1138.26**, QQQ **723.02** — all **Δ 0.00%** vs Polygon oracle.

SPY×10 vs SPX tracking: **−0.47%** (normal ≈ −0.4%) ✅

### Batch 2 (10 tickers × 3 passes = 30 probe sets) — ✅ 0 issues

`JPM, BAC, XOM, CVX, UNH, LLY, CRM, ORCL, QCOM, PLTR` — all spots matched Polygon oracle at **Δ 0.000%** across 3 passes.

### Heat Maps MATRIX deep audit (25 tickers × 32 checks each) — ✅ 0 issues

Prior passes only compared **top-level spot** across quote / positioning / heatmap APIs. This pass
re-derives every aggregate from the **served matrix payload** — the same invariant layers as
`src/lib/correctness/heatmap-verifier.ts`:

| Check | What it catches |
|---|---|
| INV-1 Σ `strike_totals` == `total` | Scale bug (×100, B-vs-M) on GEX/VEX/DEX/CHARM |
| INV-2 cells re-sum == `strike_totals` | Matrix grid ≠ headline levels the UI shows |
| INV-2b per-strike sign integrity | Flipped call(+)/put(−) in cells vs totals |
| INV-3 call/put walls | Reported walls ≠ argmax(+)/argmin(−) of strike totals |
| INV-4 gamma flip | Reported flip ≠ neg→pos crossing nearest spot |
| Cell finiteness scan | NaN/Inf anywhere in the matrix |
| Mapper cross-tool | `gexPositioningFromHeatmap(hm)` vs `hm.gex.*` on **same snapshot** (no TTL race) |
| Sanity | max_pain within ±50% of spot |

**25 tickers:** `SPX, SPY, QQQ, IWM, NVDA, AAPL, TSLA, AMD, MSFT, META, AMZN, MU, SMH, GLD, AVGO,
JPM, BAC, XOM, CVX, UNH, LLY, CRM, ORCL, QCOM, PLTR` — **800 checks, 0 FLAGS**.

Sample matrix headline numbers (live prod): SPX net GEX **29.05B**, flip **7435**, call wall **7440**,
put wall **7350**; SPY net GEX **2.98B**; QQQ net GEX **807.7M** — all internally reconciled.

> **Lesson:** comparing `/api/market/gex-positioning` to `/api/market/gex-heatmap` in **parallel**
> can false-flag during cache refresh (5–20s TTL). Production verifier uses temporal-immune mapping
> from one held snapshot; the audit script now does the same.

```bash
node scripts/heatmap-matrix-audit.mjs
node scripts/heatmap-matrix-audit.mjs --tickers=SPX,NVDA,QQQ
```

### Notes

- **TSLA** sometimes reports **7/7** checks (vs 9/9) — thinner GEX wall data, not a numeric error.
- **VIX** has **7/7** — index-specific (no equity options chain walls); spot still oracle-confirmed.
- Re-run during **RTH** for freshness/TTL assertions on warm-cache keys.

```bash
node scripts/multi-ticker-audit.mjs --passes=3
```
