# Data-Correctness Auditor

A continuous verifier that checks **the numbers the platform shows are correct**. ONE
`/api/cron/data-correctness` run now audits **every numeric surface on the platform** — Heat Maps,
the SPX desk, HELIX flows, Night's Watch, Night Hawk, market context, the track record, Largo, and the
**data layer itself** (Postgres + Redis + pipeline-hop + writer-cron integrity) — into a single
rolled-up scorecard. Heat Maps (the GEX / VEX / DEX / CHARM matrix) was the first target; the same
six-layer model and scorecard schema now carry the rest.

It is distinct from the existing **Data Integrity** sweep (`/api/cron/data-integrity`), which
cross-checks live numbers *across tools* (desk vs heatmap vs quote, SPY/SPX tracking). The
Data-Correctness auditor goes a layer deeper: it **independently re-derives** each surface's
aggregates and confirms them against a **second source** where one exists, answering "is this
number *right*?" — not just "do two surfaces agree?".

- Scorecard types: `src/lib/correctness/types.ts`
- Orchestrator + markdown render: `src/lib/correctness/run-correctness.ts` (`runFullCorrectness`)
- Cron route: `src/app/api/cron/data-correctness/route.ts`
- Verifiers (one per surface):
  - Heat Maps — `src/lib/correctness/heatmap-verifier.ts`
  - SPX desk — `src/lib/correctness/desk-verifier.ts`
  - HELIX flows — `src/lib/correctness/flows-verifier.ts`
  - Night's Watch — `src/lib/correctness/nights-watch-verifier.ts`
  - Night Hawk — `src/lib/correctness/nighthawk-verifier.ts`
  - Market context — `src/lib/correctness/market-context-verifier.ts`
  - Track record — `src/lib/correctness/track-record-verifier.ts`
  - Largo (scaffold) — `src/lib/correctness/largo-verifier.ts`
  - Data layer + pipeline integrity — `src/lib/correctness/data-integrity-verifier.ts`
- Schedule: `railway.data-correctness.toml` + registry entry `data-correctness`
- Scorecard output: `docs/auto/data-correctness-<date>.md` (best-effort; structured result also in the cron run log)

---

## Per-surface COVERAGE MATRIX

Every metric is honestly labeled **confirmed** (an independent second source agreed within tolerance)
vs **consistency-only** (single source — internally reconciled + invariant-clean, but a coverage gap,
never a false green). "2nd source needed" is what would promote a gap to confirmed.

### Heat Maps — `heatmap-verifier.ts`
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| King strike | argmax\|net\| from scratch; UW GEX ladder | **confirmed** (SPX, UW answers) / consistency-only (others) | UW `spot-exposures` for non-SPX |
| Net-GEX sign | sum from scratch; UW ladder | **confirmed** (SPX) / consistency-only | per-ticker UW oracle |
| Net-GEX magnitude | Σ strike_totals == total | consistency-only | a 2nd source on the same $-gamma scale |
| Call/put walls, flip | argmax/argmin/sign-cross from scratch | consistency-only | a 2nd per-strike ladder |
| Per-cell $-gamma | raw-chain recompute (`gamma·oi·100·spot²·0.01`) | consistency-only | (faithfulness; convention needs oracle) |
| Spot (cross-tool) | vs getGexPositioning + SPX desk | consistency-checked | (covered by desk spot-vs-index below) |
| Freshness | asof within 15m RTH | asserted (RTH) | — |

### SPX desk — `desk-verifier.ts`
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| Spot / price | vs **Polygon I:SPX index** snapshot | **confirmed** (I:SPX answers) | — |
| Moving averages (EMA20/50/200, SMA50/200) | recomputed from scratch over Polygon daily bars | consistency-only (vs own source) | a 2nd bar vendor |
| GEX King + net-sign | shared UW native-GEX oracle | **confirmed** (UW answers) | per-ticker oracle |
| Spot ∈ [day low, day high] | invariant | consistency-only (invariant) | — |
| above_vwap / above_gamma_flip labels | invariant vs spot | consistency-only | — |
| IV rank | bounded [0,100] | consistency-only | a 2nd IV-rank source |
| VIX, max-pain, flip | sanity bounds / near-spot | consistency-only | — |
| Freshness | price_age_ms ≤ 90s RTH | asserted (RTH) | — |

### HELIX flows — `flows-verifier.ts`
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| Premium (per row) | == UW `total_premium` verbatim; finite, non-negative | **faithful-to-source** (consistency-only) | a 2nd flow provider |
| call$ / put$ / net / total | recompute + Σ partition invariant | consistency-only | a 2nd flow provider |
| call% / put% | derivation == float share, bounded [0,100] | consistency-only | — |
| Recency ordering | recency view derivable + monotone, none future-dated | consistency-only | — (the `order:"recent"` param is the on-main change) |
| Freshness | newest event ≤ 30m RTH | asserted (RTH) | — |

### Night's Watch — `nights-watch-verifier.ts`
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| Unrealized P&L, current value, pnl% | (mark−entry)×100×qty×side recomputed; diffed vs enrichPosition | consistency-only (formula confirmed) | — (formula is exact) |
| Breakeven, DTE, distance | independent re-derivation vs enrichPosition | consistency-only (formula confirmed) | — |
| Strike present in chain | held contract matched in shared chain cache | **chain-confirmed** | — |
| Mark / Δ / Θ / IV values | sane + trace to real chain contract | consistency-only (chain-confirmed, values not oracle'd) | a 2nd options-pricing source |

### Night Hawk — `nighthawk-verifier.ts`
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| Play grounded in dossier | every play ticker has a staged dossier snapshot | consistency-only (invariant) | — |
| flow_streak_days, iv_rank | vs dossier snapshot they were built from | consistency-only (shadow-recompute) | — (snapshot itself needs the desk/flows oracles) |
| Strike + OI floor | parsed from options_play; live ATM chain | **chain-confirmed** (when in ATM/front-expiry window) | wider chain pull for swing/leap |
| Entry premium | within live chain bid/ask band | **chain-confirmed** (matched strikes) | — |
| Ranks, premium-cap, conviction vocab | invariant / sanity | consistency-only | — |

### Market context — `market-context-verifier.ts`
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| SPX | vs a 2nd Polygon index snapshot | **confirmed** (snapshot answers) | — |
| VIX | vs a 2nd index snapshot | **confirmed** (snapshot answers) | — |
| Market breadth (% advancing, A/D) | recomputed from Polygon grouped daily summary (constituents) | consistency-only (vs own source) | a 2nd breadth provider |
| Sector / leader % | finite + within ±40%/day | consistency-only (bounded) | a 2nd sector-quote source |

### Track record — `track-record-verifier.ts`
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| wins / losses / scratch (breakeven) | recomputed from the graded-outcomes ledger | **confirmed-against-ledger** | — (internal ledger is the ground truth) |
| wins+losses+scratch == closed | partition invariant | confirmed (invariant) | — |
| hit-rate | wins/closed recompute == desk stats == public surface | **confirmed-against-ledger** | — |

> "scratch" in the product == `breakeven` in the outcomes ledger; the verifier treats them as one metric.

### Largo — `largo-verifier.ts` (SCAFFOLD)
| Metric | Method | Status today | 2nd source needed |
|---|---|---|---|
| Numeric grounding (every answer number traces to a tool result) | grounding engine shipped + self-tested; FLAGs ungrounded numbers | **COVERAGE GAP — needs answer + tool-result logging** | persist each tool_call result JSON beside the answer + a cron-readable recent-answers reader |

**Why Largo is a gap, honestly:** `largo_messages` persists the answer TEXT and tool NAMES only — tool
RESULTS are discarded after the turn, and `fetchLargoMessagesPublic` requires sessionId+userId (no
cross-user reader). So real answers cannot be traced to their tool results yet. The verifier ships the
real FLAG machinery (`extractNumericTokens` / `collectResultNumbers` / `traceNumbersToResults`) and
self-tests it each run, so the trace activates the moment logging lands — but it never reports a green.

### Data layer + pipeline integrity — `data-integrity-verifier.ts`

A surface ONE LEVEL BELOW the others. Every other verifier asks "is the served number *correct*?";
this one asks "is the data LAYER healthy end-to-end — source → Postgres/Redis → API → website?". A
correct formula over a STALE/EMPTY table or an EXPIRED cache still ships a wrong page, and that is
exactly what this catches. It is a strict **cache-reader**: Postgres is touched with small AGGREGATE
reads only (`COUNT` / `MAX(ts)` / null-rate over a recent window — no row dumps), Redis is read through
the SAME public cache-readers the app uses (`getGexPositioning` → the `gex-heatmap:{t}` cache;
`sharedCacheGetWithTtl` for the raw TTL), writer health reuses `buildCronHealthSnapshot`. NO raw Redis
client is opened, NO credential is read or printed, NO new uncapped provider fan-out is introduced. All
checks are **market-hours aware** — expected after-hours/weekend quiet SKIPS, it is never a flag.

| Layer | Check | FLAG-capable? | Status today |
|---|---|---|---|
| **PG — flow_alerts** | latest row ≤ 20m during RTH; ≥1 row in last 60m during RTH; `total_premium` not ≤0/null on ~all of last 24h | **FLAG** (RTH only) | pass / FLAG |
| **PG — cron_job_runs** | newest run ≤ 30m during RTH (the whole cron plane is logging) | **FLAG** (RTH only) | pass / FLAG |
| **PG — nighthawk_editions** | latest `published_at` within a 96h cadence ceiling; empty table noted (no baseline) | **FLAG** (cadence) | pass / FLAG / consistency-only (empty) |
| **PG — nighthawk_play_outcomes** | every `outcome` in-vocabulary (clean ledger behind hit-rate) | **FLAG** | pass / FLAG |
| **PG — user_positions** | contracts>0, entry_premium≥0, strike present (clean P&L inputs); empty is legit | **FLAG** (garbage only) | pass / FLAG / skipped (empty) |
| **Redis — gex-heatmap:{SPX,SPY}** | key present (non-null reader); value parses + spot>0 + finite net GEX; `asof` ≤ 15m during RTH; SPX cold during RTH is a real miss | **FLAG** (RTH; SPX cold) | pass / FLAG |
| **Redis — gex-heatmap TTL** | raw Redis TTL present + bounded (1–600s); no-expiry/absurd TTL flagged (stale-as-live) | **FLAG** | pass / FLAG / consistency-only (miss) |
| **Pipeline hop — SPX spot** | gex-positioning cache spot == SPX desk spot within 0.5% (the two hops feed the website the same number) | **FLAG** | consistency-only / FLAG |
| **Pipeline hop — edition** | `fetchNighthawkEditionByDate(latest.edition_for)` reproduces the latest row (the website's served-by-date path; the #77 DATE-cast class) | **FLAG** | consistency-only / FLAG |
| **Writer crons** | flow-ingest, uw-cache-refresh, nights-watch-warm, heatmap-warm, nighthawk-playbook, nighthawk-outcomes: last run not failed; not stale-during-RTH (#90 silent death) | **FLAG** (failed / RTH-stale) | pass / FLAG / consistency-only (off-window) |

**FLAG-capable vs consistency-only:** the PG freshness/row-count/garbage checks, Redis presence/TTL/
sanity checks, and writer failed/RTH-stale checks all emit a real **FLAG** (and report PASS when they
hold — they are an independent second VIEW of the pipeline, a stronger claim than the single-source
consistency checks). The two cross-hop reconciliations (spot, edition) are **consistency-only** when
they agree (one underlying, no second oracle) but FLAG on a genuine divergence/mismatch. A missing
source (DB unconfigured, Redis unset, market closed, empty pre-launch table) **SKIPS** — never a false
green and never a false flag.

---

## The verification model — six layers (strongest → weakest)

Each layer emits structured per-metric `CheckResult`s with `PASS` / `consistency-only` / `FLAG`
(plus `skipped`), and on a numeric comparison records **expected vs actual vs tolerance**.

### L1 — Shadow recompute (strongest)
Independently re-derives the **key aggregates** — net dealer $-gamma, **King** node, **gamma flip**,
**call/put walls** — *from scratch* (the argmax / sign-crossing / sum algorithms in the verifier do
**not** import the production helpers, so a bug there can't hide behind a shared implementation).

Two sub-checks:
- **From the served `cells`** — re-sum the matrix the client actually renders back into per-strike
  near-term totals and require it to reconcile with the reported `strike_totals` and `total`. This is
  the catch for the **"$5000M should be $5.0B"** class (a scale/aggregation/transform bug between the
  cells and the headline number).
- **From the raw chain** — fetch one near-money chain for the nearest expiry
  (`fetchPolygonAtmOptionsChain`, through the rate-limited Polygon funnel), apply an
  independently-written `gamma·oi·100·spot²·0.01` (call +/put −) formula, and diff per-strike $-gamma
  against the served cells (catches a dropped `×0.01` / `×spot` / wrong sign on a strike), plus a
  band-scoped King agreement.

  *Honest caveat:* the raw recompute uses the **same documented per-1%-move scale** the engine uses
  (it must, to be on the same scale), so it confirms the **aggregation + scale application is correct
  end-to-end**, not that the convention itself is the "right" one. That last question is what the
  cross-provider oracle (L4) answers.

### L2 — Invariants (relationships that MUST hold → FLAG on violation)
- `Σ(per-strike net_gex) == reported net total` (within fp tolerance `1e-6`). A scale bug blows past this.
- `Σ(per-strike net_vex) == reported net VEX total`.
- `call_wall == argmax(+net_gex)` and `put_wall == argmin(−net_gex)` (the walls are the local extrema).
- `gamma_flip` is an **actual neg→pos sign change** of per-strike net gamma nearest spot — not an
  arbitrary level. (One-sided null differences fall back to the documented cumulative-crossing
  behavior and are not flagged unless a clean crossing near spot was dropped.)
- Re-summed `cells` reconcile to `strike_totals` (the matrix the user sees matches the levels reported).

### L3 — Sanity bounds (plausible ranges → FLAG when out of bounds)
- No `NaN` / `Inf` in any served aggregate (spot, net GEX/VEX, flip, walls, max-pain).
- Spot `> 0` on a non-empty matrix.
- Walls / flip / max-pain sit within ±50% of spot (a level far outside the band ⇒ strike-key/scale bug).
- All expiry columns are valid, non-past `YYYY-MM-DD` dates.
- Net GEX magnitude under an absurd-blow-up ceiling (`spot² · 1e8`) — a units/scale tripwire.

### L4 — Cross-provider oracle (the only path to "independently confirmed")
Uses the **UW native GEX ladder** (`fetchUwOdteGexLadder("SPX")` → `spot-exposures/expiry-strike`,
falling back to `greek-exposure/strike`) — this is backlog **#104**, and it **already exists** in the
codebase. For **SPX** it confirms the two **scale-invariant** facts:
- **King strike** (argmax|net|) agreement within ~1.5% of spot → metric marked **independently-confirmed**.
- **Net-GEX sign** agreement → metric marked **independently-confirmed**.

UW rows are `gamma·OI`, a **different scale** from our per-1%-move $-gamma, so **magnitude is not
directly comparable** — only the King strike and the net sign are. UW is reached **only for SPX**,
through `uwGetSafe` → `uw-rate-limiter` (the cluster-wide 2-RPS funnel), so it never adds uncapped
fan-out.

If the oracle does not answer (UW 503/empty) or the ticker is not SPX, the metric is **consistency-only**
and recorded as a **coverage gap** — never a false green.

### L5 — Cross-tool consistency (same value, same label, every surface → FLAG on divergence)
For each ticker, confirm `getGexPositioning` reports the **same** spot / flip / walls / net GEX as the
matrix it derives from. For **SPX**, additionally confirm the **SPX Slayer desk** reads the same spot
and gamma flip. A divergence under the same label is the **#80 class** (the bug where two tools showed
different numbers for "the same" thing).

### L6 — Freshness (never stale-shown-as-live → FLAG when stale during RTH)
The served `asof` must be within the expected TTL (15 min during RTH; heatmap-warm runs every ~30s).
When the market is closed, freshness is **skipped** (thin closed-market data is legitimately stale).

---

## What is independently-confirmed vs consistency-only — TODAY

| Metric | SPX | SPY / QQQ / NVDA / others |
|---|---|---|
| King strike | **independently-confirmed** (UW oracle, when it answers) | consistency-only — no second source |
| Net-GEX sign | **independently-confirmed** (UW oracle, when it answers) | consistency-only |
| Net-GEX magnitude | consistency-only (UW is a different scale) | consistency-only |
| Call / put walls | consistency-only (invariant-checked) | consistency-only |
| Gamma flip | consistency-only (invariant-checked) | consistency-only |
| Per-cell $-gamma | consistency-only (raw-chain shadow recompute) | consistency-only |
| Spot (cross-tool) | consistency-checked across desk + positioning | consistency-checked across positioning |
| Freshness | asserted during RTH | asserted during RTH |

**Consistency-only is a coverage gap, not a guarantee.** The scorecard surfaces it explicitly so no
admin tile or report can render a false "verified" badge.

---

## Tolerances

| Comparison | Tolerance | Why |
|---|---|---|
| Σ strike_totals vs reported total | `1e-6` fractional | fp only — a real scale bug is orders of magnitude larger |
| Raw-chain cell vs served cell | `2%` fractional | banding / far-dated handling differ slightly between paths |
| King / wall strike equality | `0.01` pts (absolute) | it's the same strike or it isn't |
| Cross-tool spot | `0.5%` fractional | well outside live-tick timing jitter |
| Cross-provider King | `1.5%` of spot | different vendors use different strike grids |
| Freshness (RTH) | `15` min | heatmap-warm runs ~30s; 15 min ⇒ a real stall |
| Net-GEX absurd ceiling | `spot² · 1e8` | units/scale tripwire only |

---

## Cron, auth, cadence

- **Auth:** `Authorization: Bearer ${CRON_SECRET}` (`isCronAuthorized`), `force-dynamic`, `maxDuration = 120`.
- **Cadence:** every 30 min during market hours (`0,30 11-21 * * 1-5` UTC, covering RTH in EDT & EST);
  self-skips outside `isSpxEngineCronWindow` (use `?force=1` to run off-hours).
- **Tickers:** `SPX, SPY, QQQ, NVDA` by default; override via `CORRECTNESS_TICKERS` (CSV, ≤10).
- **Alerts:** `notifyOpsDiscord({severity:'critical'})` on any **FLAG**;
  `{severity:'warning'}` when an RTH run is entirely consistency-only (the oracle confirmed nothing —
  a surfaced coverage gap, not a silent all-green).
- **Persistence:** `logCronRun("data-correctness", …)` records the structured payload; a markdown
  scorecard is emitted to `docs/auto/data-correctness-<date>.md` when the FS is writable.

### Env switches
| Var | Effect |
|---|---|
| `CORRECTNESS_TICKERS` | CSV ticker set for Heat Maps (default `SPX,SPY,QQQ,NVDA`, capped at 10) |
| `CORRECTNESS_SHADOW_RAW=0` | disable raw-chain / MA / breadth shadow recomputes everywhere (pure cache-reader) |
| `CORRECTNESS_UW_ORACLE=0` | disable the UW cross-provider GEX oracle (Heat Maps + desk King/sign become consistency-only) |
| `CORRECTNESS_NW_SAMPLE` | Night's Watch: max distinct (ticker,expiry) chains to chain-confirm (default 12, ≤40) |
| `CORRECTNESS_NIGHTHAWK_CHAIN=0` | disable Night Hawk live chain-confirm (strikes stay dossier-grounded only) |
| `CORRECTNESS_NIGHTHAWK_SAMPLE` | Night Hawk: max plays to chain-confirm (default 3, ≤8) |
| `CORRECTNESS_DATA_INTEGRITY=0` | disable the whole data-layer + pipeline-integrity surface (PG/Redis/hop/writers) |
| `CORRECTNESS_DATA_INTEGRITY_REDIS=0` | disable just the Redis layer of the data-integrity surface (e.g. a deploy with `REDIS_URL` intentionally unset) |

---

## The #104 dependency (true GEX confirmation)

Backlog **#104** is "the cross-provider oracle". The UW native GEX channel it calls for already exists
(`fetchUwOdteGexLadder`), so **SPX King + net-GEX sign are independently confirmed today** whenever UW
answers. To extend independent confirmation:

1. **More tickers** — UW `spot-exposures` works for the index/large-cap set; wiring SPY/QQQ/NVDA
   through the same oracle (respecting the 2-RPS budget) would promote them from consistency-only.
2. **Magnitude confirmation** — requires a second source on the **same `$-gamma` scale** (or a
   documented conversion from UW's `gamma·OI`). Until then, net-GEX **magnitude** stays consistency-only.
3. **Walls / flip confirmation** — derivable from a second per-strike ladder; today they are
   invariant-checked against our own matrix only.

Until #104's coverage expands, the auditor is **honest by construction**: it confirms what it can,
consistency-checks the rest, and flags every coverage gap — it never shows a guarantee it cannot back.
