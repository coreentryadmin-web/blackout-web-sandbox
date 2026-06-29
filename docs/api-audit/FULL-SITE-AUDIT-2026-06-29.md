# Full-Site Deep Audit — 2026-06-29

> **Scope:** Every numeric surface on blackouttrades.com — not just Heat Maps. Automated API
> re-derivation + production cron validators + browser QA on all 8 premium pages.

---

## Audit coverage matrix

| Surface | Route / API | Checks run | Verdict |
|---|---|---|---|
| **Automated cron plane** | `/api/cron/data-correctness`, `data-integrity`, `cron-staleness-watchdog` | 6-layer scorecard, cross-tool matrix, writer health | ✅ 0 correctness flags; ⏸ integrity skipped (market closed); ⚠ playbook stale |
| **SPX Slayer desk** | `/api/market/spx/desk`, `/api/market/spx/pulse`, `merged`, `signals` | spot ∈ [LOD,HOD], VIX>0, finite scan, change%, vs snapshot | ✅ SPX **7440.43**, Δ **0.00** vs Polygon |
| **Platform snapshot** | `/api/market/platform/snapshot` | desk vs snapshot spot, flows premium, NH play count | ✅ aligned |
| **HELIX flows** | `/api/market/flows` | premium ≥0, finite, recency order, Σ recompute | ✅ 200 rows, Σ **$211.6M** |
| **Heat Maps matrix** | `/api/market/gex-heatmap` × 10 tickers × 4 lenses | Σ strike_totals, walls, flip, cell re-sum, sign integrity | ✅ **320 checks, 0 flags** |
| **Heat Maps matrix (extended)** | 25 tickers via `heatmap-matrix-audit.mjs` | same invariants | ✅ **800 checks, 0 flags** |
| **Multi-ticker oracle** | 20 tickers × quote/GEX/heatmap vs Polygon | spot drift, SPY×10 tracking | ✅ **0 issues** |
| **Grid** | 8 `/api/grid/*` routes | finite scan, sector pct bounds | ✅ all finite |
| **Night Hawk** | `/api/market/nighthawk/edition` | ranks 1..N, premium cap, finite scores | ✅ 5 plays |
| **Track record — public ledger** | `/api/public/track-record`, `spx/outcomes` | W+L+BE partition, outcomes vs public | ✅ **0W/3L/0BE** consistent |
| **Track record — page API** | `/api/track-record` | vs public ledger | ❌ **P0 split-brain** (0 vs 3) |
| **Market context** | `/api/market/regime`, `indices`, `anomalies`, `lotto/today` | finite scan | ✅ |
| **GEX positioning** | `/api/market/gex-positioning?ticker=SPX` | finite scan | ✅ |
| **Auth gates** | premium routes unauthenticated | must 401/403 | ✅ |
| **Public pages** | `/`, `/track-record`, `/embed/track-record`, `/learn/*`, auth pages | malformed scan (NaN, undefined, $NaN) | ✅ **0 malformed** |
| **Postgres layer** | `spx_play_outcomes` vs `signal_outcomes` | split-brain proof | ❌ **3 vs 0** |
| **Redis layer** | `gex-heatmap:*`, `grid:*` | key presence (off-hours) | ⏸ 0 keys (expected post-RTH) |
| **Browser QA (admin)** | `/dashboard`, `/terminal`, `/flows`, `/heatmap`, `/grid`, `/nighthawk`, track-record pages | visible numbers, malformed UI | ✅ no NaN/undefined; ⚠ track-record split visible |

---

## 🔴 P0 — Confirmed bugs (fix agents)

### 1. Track record split-brain

Three surfaces read **different ledgers**:

| Surface | API | Data |
|---|---|---|
| `/track-record` page | `GET /api/track-record` → `signal_outcomes` | **0** closed |
| `/embed/track-record` | `GET /api/public/track-record` → `spx_play_outcomes` | **3** closed (0W/3L) |
| Dashboard panel | `GET /api/market/spx/outcomes` → `spx_play_outcomes` | **3** closed (0W/3L) ✅ |

**Postgres proof:** `spx_play_outcomes` closed = **3**; `signal_outcomes` SPX T+30 = **0**.

**Fix:** Wire `TrackRecordView.tsx` to `/api/public/track-record` OR align `/api/track-record` with play ledger. Extend `track-record-verifier.ts` to FLAG page API disagreement.

### 2. (None other at P0)

All other surfaces passed invariant + oracle checks in this audit pass.

---

## 🟡 P1 — Operational / cadence

### Night Hawk playbook cron stale

Watchdog flags `nighthawk-playbook`. Postgres shows last meaningful run **Fri Jun 26** (skipped outside edition window Mon). `nighthawk-outcomes` ran **ok** Mon Jun 29. UI still serves 5-play edition — verify Mon 5:30 PM ET Railway trigger.

---

## ✅ Verified green (sample live numbers)

| Tool | Key numbers (prod, audit time) |
|---|---|
| SPX desk | **7440.43**, VIX **17.65**, flip **7435.14**, range **[7348.88, 7444.32]** |
| Polygon oracle | I:SPX **7440.43** — Δ **0.00** |
| SPY×10 vs SPX | **−0.46%** (normal ≈ −0.4%) |
| Flows tape | **200** rows / 24h, Σ premium **$211.6M**; snapshot **$602.4M** / 50 alerts |
| Heat Maps SPX | net GEX **$29.4B**, flip **7435**, walls **7440/7350** |
| Heat Maps SPY | net GEX **$3.0B**, flip **746** |
| Grid | all 8 endpoints return finite data |
| Night Hawk | **5** plays, ranks unique, edition **2026-06-29** |
| Data-correctness cron | **0** flags, **7** oracle-confirmed, **69** consistency-only |

---

## How to confirm numbers are correct (validation stack)

BlackOut runs **continuous automated validation** — not manual QA alone:

| Layer | What | When |
|---|---|---|
| **`/api/cron/data-correctness`** | Re-derives every surface (desk, flows, heatmap, NH, NW, track record, Largo, data layer) — 6 verification layers per metric | ~every 30 min RTH |
| **`/api/cron/data-integrity`** | Cross-tool consistency (desk spot = heatmap spot = quote, SPY/SPX tracking, desk internal math) | RTH only |
| **`/api/cron/cron-staleness-watchdog`** | Writer cron health | continuous |
| **QA scripts (this PR)** | On-demand deep probes | manual / CI |

**Honest limit:** Not every metric has an external oracle. Labels in `docs/DATA_CORRECTNESS.md`:

- **`independently confirmed`** — 2nd source agreed (SPX spot vs Polygon, SPX King vs UW, etc.)
- **`consistency-only`** — internally reconciled, single source — **not a false green**, but no external oracle yet

Most single-name tickers, net-GEX magnitude, flows premium, and Largo answers are consistency-only until more oracles land.

---

## Re-run commands

```bash
# Master full-site audit (all tools)
eval $(railway variable list --service blackout-web --json | node -pe "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); ['CRON_SECRET','POLYGON_API_KEY'].filter(k=>v[k]).map(k=>k+'='+JSON.stringify(v[k])).join(' ')")
node scripts/full-site-deep-audit.mjs

# Heat Maps cell-level (25 tickers)
node scripts/heatmap-matrix-audit.mjs

# 20-ticker spot oracle (3 passes)
node scripts/multi-ticker-audit.mjs --passes=3

# Public pages + API malformed scan
node scripts/site-audit.mjs --base=https://blackouttrades.com

# Postgres + Redis layer
node scripts/railway-layer-audit.mjs

# Production correctness cron
node scripts/hit-cron.mjs /api/cron/data-correctness
```

---

## Still needs RTH pass

- `data-integrity` cross-tool matrix (0 checks when `market_open === false`)
- Redis warm-cache TTL assertions (`gex-heatmap:*` empty off-hours is expected)
- Flows Massive cross-provider oracle (runs in data-correctness during RTH)
- Largo numeric grounding (coverage gap — tool results not persisted)
