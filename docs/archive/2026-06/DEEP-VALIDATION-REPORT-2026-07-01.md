# DEEP DATA-VALIDATION REPORT — blackouttrades.com

**Prepared by:** CTO
**As-of:** 2026-07-01 ~07:55 UTC (03:55 ET) — **MARKET CLOSED**
**Live-value semantics:** all "live" figures are the **2026-06-30 last close** unless explicitly noted as an overnight tick
**Scope:** independent re-derivation of every headline number from raw Polygon / Unusual Whales (UW) ground truth using the repo's own formulas, plus a logic audit of every desk/tile/verifier. 12 validation units, 32 catalogued findings (all severity-graded; the two most load-bearing code claims re-verified against source for this report).

---

## 1. Bottom line — is every number correct and every tool's logic sound?

**Almost.** The *arithmetic* is overwhelmingly correct: prices, moving averages, GEX walls/flip/net-greeks, flow premiums, and grid tile percentages all re-derive from raw provider data within tolerance (most to the exact digit). There is **no fabricated data** and **no wrong-unit / wrong-sign price**.

But three things are wrong enough to act on:

1. **One critical, member-facing lie in the numbers:** the SPX Slayer track record advertises a **0% win rate (0 wins / 9 losses)** that is a *scoring bug*, not a result. Two of the nine closed plays exited in profit and are mislabeled losses. This is the single most damaging finding — it is the headline stat members judge the product on, and it is false.
2. **A false-confidence "cross-validation" surfaced to members** while the app's genuinely rigorous verifier is hidden in an ops-only cron. The member-visible `gex_cross_validation` block is a sign-blind rubber-stamp that cannot detect a wrong wall.
3. **Systemic float-noise** — ~2,900 numeric tokens across 19 endpoints served as raw IEEE-754 floats (e.g. `price=7499.360000000001`). Values are correct; presentation is not. One shared rounding helper fixes the class.

### Per-tool PASS / ISSUES table

| # | Unit / tool | Verdict | Worst issue |
|---|-------------|---------|-------------|
| 1 | SPX Slayer desk — levels, EMA/VWAP, signals | **ISSUES (MINOR)** | HIGH: profitable THESIS exits labeled "loss" (same bug as #6); MEDIUM float-noise |
| 2 | GEX positioning — flip, walls, net gamma/vanna/delta/charm | **PASS (ALL_CORRECT)** | LOW: SPX strike-tolerance mislabel (2pt vs "2 strikes"); INFO float-noise |
| 3 | Thermal heatmap — GEX matrix cells | **ISSUES (MINOR)** | MEDIUM: ~2,500 cells served as raw floats (values reconcile to 0.0) |
| 4 | HELIX flows — tape & aggregates | **ISSUES (MINOR)** | MEDIUM: `underlying_price`/`otm_pct` NULL on every REST row (JSON string vs `jsonb_typeof='number'`) |
| 5 | Grid tiles — 8 tiles | **ISSUES (MINOR)** | MEDIUM: Movers surfaces +22,245% corporate-action artifact; provider %-drift |
| 6 | Track record — SPX Slayer win/loss scoring | **ISSUES (MATERIAL)** | **CRITICAL: 0% win rate is a scoring bug — 2 profitable plays booked as losses** |
| 7 | Night Hawk — setup scoring & outcomes | **ISSUES (MINOR)** | MEDIUM: profitFactor (738.87) denominator missing the `Math.min(0,…)` clamp |
| 8 | Largo terminal — session & tool-call data flow | **ISSUES (MINOR)** | MEDIUM: raw EMA float-noise injected into model context; `vwap` mislabel (SPX-safe null) |
| 9 | Prices / indices / quote / regime cross-source | **ISSUES (MATERIAL)** | HIGH: VIX change_pct wrong-signed (17.18 up in level, −2.66% shown) |
| 10 | Night Hawk track-record aggregates | **PASS (reconciled)** | (rolled into #7) profitFactor clamp |
| 11 | App built-in correctness verifiers + gex_cross_validation | **ISSUES (MATERIAL)** | HIGH: member-visible cross-validation is a sign-blind rubber-stamp |
| 12 | Systemic float-noise / rounding at data layer | **ISSUES (MINOR)** | MEDIUM: no shared serialization/rounding layer (~2,900 noisy tokens) |

**Net:** 2 PASS, 10 ISSUES. Of the 10, three carry MATERIAL verdicts (#6, #9, #11) and one of those (#6) is CRITICAL. Everything else is MINOR — dominated by cosmetic float-noise and off-hours labeling.

---

## 2. Data-correctness scorecard — what was cross-checked vs ground truth, and the result

Independent recomputation used raw `poly_spx_daily` (123 bars), `poly_spx_prev`, Polygon SPY/VIX snapshots, `uw_spy_greek_by_strike` (547 rows), `uw_flow_alerts`, `uw_market_tide`, `uw_sector_etfs`, `uw_darkpool_recent`, `uw_congress_recent`, `uw_movers`, and the app's own `ma-math.ts` / `spx-play-payload.ts` / `polygon-options-gex.ts` formulas.

| Metric class | Ground truth | Recompute result | Verdict |
|--------------|-------------|------------------|---------|
| **SPX price** | poly_spx_prev close 7499.36 | Exact (raw float 7499.360000000001) | ✅ correct (noisy format) |
| **SPY price / change_pct** | Polygon 746.77, (746.77−741)/741=0.7787 | 746.77 / 0.78 exact | ✅ correct |
| **EMA20/50/200, SMA50/200** | recompute via ma-math.ts over 123 closes | SMA50 = 7378.878399999999 **exact to the digit**; EMA20 Δ0.0001%, EMA50 Δ0.03% — all inside verifier 1.5% tol | ✅ correct (noisy format) |
| **SPX levels distance_pct (×10)** | ((level−price)/price)×100 | all 10 recompute **exactly** and correctly sorted | ✅ correct |
| **PDH/PDL/prior_close/gap_pct/spx_change_pct** | 6/29 prior daily bar | gap_pct 0.792, spx_change_pct 0.79 reconcile | ✅ correct |
| **VWAP (SPX)** | market closed, no RTH minute bars | null (**expected off-hours**) | ✅ correct (null) |
| **GEX call_wall / put_wall / flip** | UW ladder argmax/argmin + Polygon near-term | call 750, put 735 (=UW put_wall exactly), flip 740.63 | ✅ correct (put_wall exact match) |
| **GEX net gamma/vanna/delta/charm** | dealer call(+)/put(−) convention | signs + magnitudes reconcile to heatmap strike_totals | ✅ correct (noisy format) |
| **Heatmap cells → strike_totals → total** | re-sum 683 cells over 8 near-term expiries | **0.0 fractional diff** cell→total; Σ=3062180849.185329 vs 3062180849.185327 (6.2e-16 fp) | ✅ correct (noisy format) |
| **Heatmap flip / regime posture** | single neg→pos crossing of strike_totals | flip 740.63, posture 'long' (spot 746.77 > flip) | ✅ correct |
| **UW cross-provider sign agreement** | uw_spy_greek_by_strike | 66/68 per-strike sign match (2 exceptions in ±5pt near-flip zone) | ✅ correct |
| **Flow premiums / ordering / $200k floor** | uw_flow_alerts (50 REST rows) | premiums exact, recent-first (0 violations), floor enforced exactly | ✅ correct |
| **Flow route / dte / otm_pct sign** | ET calendar | 0 misclassifications, correct call/put sign convention | ✅ correct |
| **platform-snapshot flow total & top_tickers** | 50 recent rows | reconcile to the cent | ✅ correct |
| **Sectors change_pct (11/11)** | uw_sector_etfs last/prev_close | XLK +2.76, XLE −0.88, XLV −1.29 … all exact | ✅ correct |
| **Economy (7 indicators)** | served rows | latest/prior/MoM change_pct exact, desc order | ✅ correct |
| **Dark-pool (20 prints)** | uw_darkpool_recent rows 0-19 | ticker/premium/size/price/executed_at exact, no float noise | ✅ correct |
| **Congress (29 usable rows)** | uw_congress_recent (50) | politician/ticker/type/amount match; null-ticker filtered | ✅ correct (field-label issues, low) |
| **Movers** | uw_movers | prices agree; **percents diverge by provider**; +22,245% artifact | ⚠️ data-quality (medium) |
| **VIX** | Polygon daily prev-close 16.45 | app 17.18 = **live overnight Cboe GTH tick** (genuine, mixed as-of) | ⚠️ material (see #9) |
| **Night Hawk aggregates** | analytics.json weighted recompute | win_rate 62.5, profitable 75, avg_return 27.64 all reconcile | ✅ correct |

**Scorecard summary:** every cross-checkable member-facing *value* is correct in magnitude/sign/unit. The exceptions are (a) the VIX as-of/sign desync (#9), (b) the Movers corporate-action artifact and provider %-drift (#5), and (c) the derived *outcome labels* on the SPX track record (#6) — which is a logic bug, not an arithmetic one.

---

## 3. Confirmed bugs / logic errors (severity-ranked)

### 🔴 CRITICAL — Profitable SPX plays booked as losses; 0% win rate is a bug
**File:** `src/lib/spx-play-outcomes.ts:170` (classifyOutcome) — *re-verified against source for this report; the finding cites :177 due to line drift, the exact statement is at line 170.* Reinforced by `src/lib/spx-play-engine.ts:394-397` (wasLoss on thesis break).
**Verified code:**
```ts
if (close.was_loss || close.exit_action === "STOP" || close.exit_action === "THESIS") {
  return "loss";
}
```
Any THESIS (thesis-break) exit is unconditionally a loss, short-circuiting the P&L branch (`pnl_pts >= 2 => win`, line 181) and the correctly P&L-branched TRAIL logic directly above it (lines 176-180). The engine independently forces `was_loss = stopHit || thesisBreak || …`, so even removing the THESIS clause here still routes to "loss" via the `close.was_loss ||` disjunct — **a complete fix must branch on `pnl_pts` in both places.**

**appValue vs groundTruth:**
- Served `/api/public/track-record`: `wins=0, losses=9, win_rate_pct=0`.
- Recompute with the repo's own `pnl_pts = exit − entry` (all 9 rows are `direction=long`, formula `spx-play-payload.ts:99`):
  - id=7 long 7491.08→7493.92 = **+2.84** (target 7505.08 never hit → profitable managed THESIS exit) → labeled "loss"
  - id=3 long 7432.13→7439.43 = **+7.30** (target 7446.13 never hit) → labeled "loss"
  - 7 genuine losses (id1 −7.15, id2 −2.47, id4 −13.62, id5 −1.48, id6 −2.23, id8 −2.60, id9 −0.38)
  - **True tally: 2W / 7L = 22.2% win rate**, not 0%.
- UI `PlayHistoryTable.tsx:96-99` renders +2.8/+7.3 in **green** beside a **red "L"** — a visible self-contradiction. Same 0/9 flows through `track-record-public.ts:67-79` (public embed) and `computePlayOutcomeStats` (`spx-play-outcomes.ts:337-362`).
- The codebase contradicts itself: a TRAIL protected-gain exit with `pnl_pts>=0` is graded a **win** (lines 176-180), but the economically identical THESIS profitable exit is a **loss** — no economic basis.

**Fix:** Grade by realized P&L, not exit label. For THESIS/SESSION exits with `pnl_pts>0` → win (>0), loss (<0), breakeven (=0) — mirror the TRAIL/THETA branches. Stop forcing `wasLoss=true` for `thesisBreak` when `pnlPts>=0` in `spx-play-engine.ts:394-397` (keep it true only for actual stop-outs / negative P&L, which the re-entry lock semantics need). After the fix the ledger reads ~2W / 7L (~22%). Add a unit test: a THESIS exit with positive `pnl_pts` must grade as win.

---

### 🟠 HIGH — Member-visible `gex_cross_validation` is a sign-blind rubber-stamp
**File:** `src/lib/providers/gex-cross-validation.ts:113-144` — *re-verified against source.*
`topNStrikes(ladder, 10)` builds **one** sign-discarded (`Math.abs`) list of the top-10 UW strikes by |net_gex|. `isMatch()` (lines 119-123, ±2 tolerance) is called **identically** for `callWall`, `putWall` AND `gammaFlip` (lines 125-127). It never derives the UW call wall as `argmax(+gamma)`, the put wall as `argmin(−gamma)`, nor a UW zero-gamma crossing flip.

**Consequences (reproduced numerically from `uw_spy_greek_by_strike`):**
- Top-10 pool = {710,720,725,730,735,740,743,744,750,755}.
- Served `call_wall=750` reports `callWallMatch:true`, but the UW ladder's true `argmax(+net)` call wall is **743** (7pt off) — a genuine disagreement reported as a match.
- **Sign-blind:** a call wall placed at 735 (strongest *negative*-gamma strike) passes; a flip placed on a strong wall (750) passes.
- The recomputed `divergence = 0.6299999999999955` matches the served payload bit-for-bit, confirming the runtime used the near-spot WS ladder.
- The app's *private* `heatmap-verifier.ts:806-843` does this correctly (derives `argmax|net|` King, compares strike-to-strike) — so the response-path check is strictly **weaker** than the app's own hidden check.

**Fix:** Derive the UW ladder's own call wall (argmax +net), put wall (argmin −net), and cumulative-gamma zero-crossing flip; compare each primary level to its **corresponding** UW level (call↔call, put↔put, flip↔flip) with a strike-grid-aware tolerance. Do not test all three against one shared |gamma| top-N pool.

**Related MATERIAL sub-findings on the same block (all MEDIUM):**
- `divergence` field (0.63) is **mislabeled** — it is the max distance from a level to the nearest top-10 strike, not the wall/flip gap between providers (`:129-133`). Members/AI read "0.63" as sub-point agreement when the true call-wall gap is 7pt. Rename + round.
- **Dead warn threshold:** `getGexPositioning` warns only when `div > 5` (`gex-positioning.ts:172-181`), but matches require `minDist<=2`, so on any all-match result `divergence<=2` and the warn is unreachable. A `callWallMatch:false` ships silently — no UI consumer, no log. Alert on any `*Match===false`.
- **REST fallback ladder is deep-OTM LEAPS** (`:56-79`): off the WS path (e.g. market closed), `fetchUwSpotExposuresByStrike` top-10 = {240,200,250,…} → every level mismatches with ~460pt divergence (false alarm). Band the ladder to ±10-15% of spot, or return `null` when only the deep-OTM slice is available.

---

### 🟠 HIGH — VIX change_pct internally inconsistent / wrong-signed
**File:** `src/lib/providers/polygon.ts:374-388` (fetchIndexSnapshots); `indices/route.ts`.
Market is CLOSED. SPX/SPY `value` are frozen at the 06-30 regular close; VIX `value` is a **live Cboe overnight (GTH) tick**. The served VIX price (17.18) is +4.44% above prev_close 16.45, yet `change_pct` is reported **−2.66%** (up in level, down in %). Root cause: `price` (from `row.value`) and `change_pct` (from `row.session.change_percent`) are pulled from two independently-updating snapshot fields that desync during the thin overnight tape. The 17.18 value itself is genuine (overnight range 16.96–17.19), but the sign is self-contradicting.
**appValue:** vix.price 17.18, change_pct −2.66. **groundTruth:** 17.18 vs prev_close 16.45 = +4.44%.
**Fix:** When market is closed, either source VIX from its daily prev-close (match SPX's frozen semantics) or explicitly label it a live overnight quote; and ensure `change_pct` references whichever `value` is shown.

---

### 🟡 MEDIUM — cluster (grouped by class; all confirmed)

| Finding | File:line | appValue vs groundTruth | Fix |
|---------|-----------|-------------------------|-----|
| Flow `underlying_price`/`otm_pct` NULL on every REST row | `src/lib/db.ts:964-968, 1005-1020` | 20 newest served rows lack both; UW encodes `"underlying_price":"7480"` as a **string**, SQL gates on `jsonb_typeof='number'` | Accept numeric-string branch: `WHEN jsonb_typeof(…)='string' THEN NULLIF(…,'')::numeric`, or normalize on ingest |
| Movers +22,245% artifact, no upper bound | `polygon.ts:313-333` → `grid.ts:500-513` | DISK +22245.62% @ $50.30 (implies prev $0.225); JEM +835% (UW: +267.59% same price) | Add upper-magnitude sanity bound to `isClean` (drop/flag |change_pct| beyond ~±1000%) |
| Night Hawk profitFactor denominator missing clamp | `src/lib/track-record-page.ts:96-99` | 738.87 = grossWins 221.396 / grossLosses 0.29964 (3 near-breakeven 'stop' rows partially cancel) | Floor per-row losses with `Math.min(0,…)` like sibling `avgLoserPct`; cap display when loss-base degenerate |
| VIX mixed as-of (live overnight vs frozen close) | `polygon.ts:374-388` | vix 17.18 (live) beside spx 7499.36 (frozen) | Unify as-of semantics (see HIGH VIX fix) |
| Heatmap: 683/683 cells raw float | `polygon-options-gex.ts:2126,2130-2135` | `cells.716.2026-07-02=-2947774.9735667133`; total 3062180849.185327 | Round in `buildMetric` (covers gex/vex/dex/charm) |
| Desk/merged/admin price+MAs raw float | `polygon.ts:759` (latestIndicator) | price 7499.360000000001, ema20 7428.6691886260705, sma50 7378.878399999999 | Round at provider boundary / before serialization |
| Indices + platform-snapshot raw float | `indices/route.ts`, `platform/snapshot/route.ts` | spx.price 7499.360000000001, gex_net 23602347959.389076 | Round at serialization |
| Track-record numbers raw float | `track-record/plays/route.ts:43-54`, `db.ts` mapPlayOutcomeRow | pnl_pts 2.8400000000001455, mae_pts 4.690000000000055 | Round monetary/point fields (public embed already does at `track-record-public.ts:36-39`) |
| Largo `get_technicals` raw EMA to model context | `largo-live-feed.ts:518`, `polygon.ts:751-762`, `ma-math.ts:28-40` | injects `EMAs: 20=7428.676040091288 …` verbatim | Round before injection / at `buildLargoTechnicals` |
| Track-record verifier blind spot | `src/lib/correctness/track-record-verifier.ts:16-38` | checks published==ledger only; never validates classifyOutcome(pnl, action) | Add invariant: flag any row where `outcome=loss` but `pnl_pts>0` (would catch id3/id7) |
| Net greek totals raw float | `gex-positioning.ts:247-256`; accum `polygon-options-gex.ts:2135` | net_gex 3062180849.185327, net_charm −614022680988.1176 | Round net_* to whole dollars |
| Structure-level distance_pct raw division | `spx-session.ts:135-138` | 0.00853406157324649 | `Number((…).toFixed(2))` |
| Persisted regime netGex noisy in NUMERIC column | write `market-regime-detector/route.ts:207`; read `regime/route.ts:36` | netGex="146132970747.13174" | Round **before INSERT** (serve-time round can't fix stored value) |

### 🟢 LOW / INFO (non-blocking, catalogued)
- SPX cross-val `STRIKE_TOLERANCE=2` applies 2 *points* but intent is "2 strikes" = 10pt for SPX (`gex-cross-validation.ts:117-123`) — SPX walls one strike apart wrongly flagged mismatch; no UI impact today.
- PDH statically tagged 'resistance' even when price trades above it (`spx-desk.ts:736`) — cosmetic; distance_pct sign is correct.
- Flow significance `score=0` for all 500 rows (`unusual-whales.ts:222-234`, `db.ts` COALESCE(score,0)) — parser would compute 16–60; tape sorts by time so low impact.
- Flow-brief 53% call-bias vs tape 79% call — both correct for their own ranking; 500-row cap divergence; label the brief as premium-weighted-top-N.
- Congress `party` field = chamber (house/senate), `filed_at` = transaction_date (`grid.ts:371,379-380`) — UI neutralizes; rename fields.
- Night Hawk `iv_rank` raw provider value (MRVL 76.2564 vs AMD 100) — round to whole number.
- Largo `vwap` = multi-day cumulative typical-price avg (`polygon-largo.ts:182-209`) — SPX safely null (zero index volume); rename or restrict to one RTH session.
- Cross-source VIX drift indices 17.18 vs platform_snapshot 17.12 — unsynchronized overnight samples; share one cache key.
- Internal correctness scorecard never wired to member responses + self-skips off-RTH (`cron/data-correctness/route.ts:42-53`) — surfaces the weak check, hides the strong one.
- SPX pulse `market_label=EXTENDED` while `market_status=closed` at 03:57 ET — cosmetic mislabel.
- Dark-pool side 'UNKNOWN' (source has no side field); same-ticker/second React key collision (2 QQQ prints) — cosmetic.
- Night Hawk `stop_data_unavailable` predicate mismatch resolver vs analytics — cannot diverge on Polygon daily bars (o/h/l/c atomic).
- GEX put_wall 735 vs UW max-|put_gex| 740 — defensible methodology difference (Polygon-primary); documented so it isn't re-flagged.

---

## 4. The track-record 0%-win-rate verdict — genuine or scoring bug?

**Verdict: SCORING BUG. The advertised "0% win rate (0 wins / 9 losses)" is false.**

Two of nine closed SPX Slayer plays exited in **profit**:
- **Play #7:** long 7491.08 → 7493.92 = **+2.84 pts** (mfe 2.84, target 7505.08 never reached) → labeled `loss`
- **Play #3:** long 7432.13 → 7439.43 = **+7.30 pts** (mfe 7.30, target 7446.13 never reached) → labeled `loss`

Both are profitable *managed* exits (thesis invalidated while the trade was green), not stop-outs. The repo's own P&L formula (`spx-play-payload.ts:99`, `exit − entry` for longs) reproduces the served `pnl_pts` exactly for all 9 rows, and the true tally is **2 wins / 7 losses ≈ 22% win rate.**

Root cause is a hard-coded label, not a data problem: `classifyOutcome()` returns `"loss"` for *any* `exit_action==="THESIS"` regardless of sign (`spx-play-outcomes.ts:170`), and the engine forces `was_loss=true` on every thesis break (`spx-play-engine.ts:394-397`). The public embed, the desk `/api/market/spx/outcomes`, and the `/track-record` UI all derive wins/losses from this same mislabel, so members see a self-contradicting row: **+2.8 / +7.3 pts in green next to a red "L".** The `/api/market/track-record` methodology string claims results are graded honestly from the closed ledger — making the 0% materially misleading.

For contrast, the **Night Hawk** scoring path (`nighthawk/play-outcomes.ts`, target/stop vs high/low/close) is **correct** — its 62.5% win_rate / 27.64% avg return all reconcile. The bug is specific to SPX Slayer's THESIS handling.

---

## 5. Systemic float-noise — root cause, single fix point, affected endpoints

**Root cause:** there is **no shared serialization/rounding layer.** Every route calls `NextResponse.json()` directly on already-assembled objects, and rounding is applied *inconsistently per-field at the compute site*. Proof it was missed, not intentional: sibling fields **are** correctly rounded — `change_pct` via `Number(x.toFixed(2))` (`polygon.ts:386`), `distance_to_flip_pct` and `nearest_wall.distance_pts` via `toFixed(2)` (`gex-positioning.ts:233/225`) — while `price`, EMA/SMA, net-greeks, heatmap cells, and structure distance_pct are passed through raw. The underlying values were **independently re-derived as correct** (SMA50 matched to the digit incl. the `.8399999999` noise, which originates in the provider's own float).

**Magnitude:** ~2,900 noisy numeric tokens across **19 authenticated JSON endpoints**; the heatmap alone accounts for ~2,528 (its ~2,500 cells).

**Unrounded fields (first-assembly sites — the right places to fix):**
- index price — `polygon.ts:374-385` (provider returns `7499.360000000001` verbatim)
- EMA/SMA — `polygon.ts:1265/1284` (`emaFromCloses`/`smaFromCloses` raw → ema20 13dp)
- net_gex/net_vex/net_dex/net_charm — `gex-positioning.ts:247-256` = `gex.total` etc., accumulated raw at `polygon-options-gex.ts:2135`
- heatmap cells (~2,500) — `polygon-options-gex.ts:2126` `row[expiry]=val`
- structure distance_pct — `spx-session.ts:137`
- persisted regime netGex — the NUMERIC column, fixed at the **cron WRITE site** `market-regime-detector/route.ts:207`

**Single best fix point:** add **one shared numeric-rounding helper** (e.g. `round2` / `roundSig` in `src/lib`) and apply it where these values are **first assembled** — critically `polygon.ts:385` (price), `polygon.ts:1265/1284` (ema/sma), `polygon-options-gex.ts:~2126/2135` (cell/total accumulation), `gex-positioning.ts:247-256` (net_* totals), and `spx-session.ts:137` (distancePct). **Do NOT** use a blanket `JSON.stringify` replacer — it would round IDs/timestamps too. The regime endpoint must be fixed at the write site (noise is persisted in the NUMERIC column; a serve-time round only helps future reads).

**Affected endpoints (confirmed):** `/api/market/indices`, `/spx/desk`, `/spx/merged`, `/spx/play`, `/gex-positioning`, `/gex-heatmap`, `/flows`, `/platform/snapshot`, `/regime`, `/platform-intel`, `/nighthawk/edition`, `/grid/bootstrap`, `/track-record/plays`, `/market/spx/outcomes`, admin dashboards, and the Largo tool context. **Not** affected in *display*: member UI generally formats via `fmtPrice`/`fmtMoney`/`formatCompact`, so the noise reaches raw-JSON/admin/AI-context consumers, not most rendered numbers — which is why this class is MEDIUM, not HIGH.

---

## 6. What still needs the LIVE market-open (RTH) run + what needs the browser

This audit ran at 03:55 ET with the market closed; several paths could only be validated for their off-hours behavior. Re-run these during RTH to confirm the live path:

**Needs a live RTH run:**
- **Intraday HELIX flow tape** — REST arrays were empty/socket-down (expected off-hours). Confirm live ingest populates `underlying_price`/`otm_pct` once the string-vs-number SQL fix lands, and that the significance `score` is non-zero on the live writer path.
- **RTH SPX signals & VWAP** — `VWAP=null` off-hours is expected; validate VWAP anchoring, EMA/VWAP-cross signals, and `regime`/`above_gamma_flip`/`gamma_regime` transitions against live minute bars.
- **VIX as-of behavior** — confirm the change_pct sign self-consistency (HIGH #9) resolves once the RTH `value` and `session.change_percent` fields update together, and that the overnight desync does not recur intraday.
- **GEX WS ladder freshness** — confirm the cross-validation runs against the near-spot WS `gex_strike_expiry` ladder (not the deep-OTM REST fallback) during RTH, so the ±2-strike logic operates on the intended pool.
- **Live SPX play lifecycle** — an intraday THESIS/STOP/TARGET exit exercising the (fixed) classifyOutcome path end-to-end, and the morning-confirm cron (9:15 ET) writing `nh:play-status:{date}` (the 404 at 03:55 ET is expected/correct).
- **Internal correctness scorecard** — it self-skips outside RTH; run with `?force=1` or during RTH to confirm the King/flip/sign invariants against a live UW oracle.

**Needs the browser (visual / client-render, not derivable from JSON):**
- The **green-P&L-beside-red-"L" contradiction** on `/track-record` `PlayHistoryTable` — confirm it disappears after the classifyOutcome fix.
- Movers panel rendering the **+22,245% gainer** as the #1 top gainer (`GridMoversPanel.tsx`).
- FlowAlertStream **ITM/OTM chip silently missing** on REST rows (`FlowAlertStream.tsx:458-473`).
- Admin SPX dashboard rendering raw EMA/SMA floats (member desk formats them; admin does not).
- Dark-pool duplicate React key warning for same-second QQQ prints (console-only).
- Largo terminal end-to-end tool-call render (client-rendered Next.js shell with zero server-baked numbers).

---

## 7. Prioritized fix list

**P0 — ship immediately (member-facing correctness):**
1. **Fix `classifyOutcome` THESIS handling** (`spx-play-outcomes.ts:170`) **and** the `wasLoss` force in `spx-play-engine.ts:394-397` — grade by realized P&L. Restores the honest ~22% win rate (2W/7L). Add a unit test (THESIS + positive pnl → win). *(CRITICAL)*
2. **Add the cheap verifier invariant** (`track-record-verifier.ts`): flag any closed row with `outcome=loss` && `pnl_pts>0` (or win && <0). Prevents regression of #1. *(MEDIUM, tiny)*
3. **Fix VIX as-of / change_pct desync** (`polygon.ts:374-388`): unify closed-market VIX semantics or label the overnight quote, and bind `change_pct` to the shown `value`. *(HIGH)*

**P1 — fix this sprint (false-confidence + material data gaps):**
4. **Rebuild `gex_cross_validation`** to derive corresponding UW call/put/flip levels and compare like-to-like with strike-aware tolerance; rename/redefine `divergence`; alert on any `*Match===false`; band or null-out the deep-OTM REST fallback. Or, minimally, clearly document it as a heuristic and surface the real internal scorecard flag. *(HIGH cluster)*
5. **Fix flow `underlying_price` extraction** (`db.ts:964-968`) to accept numeric strings → restores `otm_pct` and the ITM/OTM chip on all REST rows. *(MEDIUM)*
6. **Add Movers upper-magnitude sanity bound** (`isClean`, `polygon.ts:322-326`) to drop/flag corporate-action artifacts (>~±1000%). *(MEDIUM)*
7. **Fix Night Hawk profitFactor clamp** (`track-record-page.ts:96-99`): floor per-row losses with `Math.min(0,…)`; cap display when loss-base is degenerate. *(MEDIUM)*

**P2 — hygiene (do together, one PR):**
8. **Introduce a shared `round2`/`roundSig` helper** and apply at the first-assembly sites listed in §5 (price, EMA/SMA, heatmap cells, net_* totals, distance_pct, Largo technicals); fix the persisted regime netGex at the **cron write site**. Eliminates ~2,900 noisy tokens across 19 endpoints. *(MEDIUM)*
9. **Wire the internal correctness scorecard** to annotate member payloads (or a distilled "independently-confirmed" flag) instead of hiding the strong check in an ops-only cron. *(LOW)*

**P3 — cosmetic / labeling (batch):**
10. Make SPX cross-val tolerance strike-aware (2 strikes = 10pt for SPX); dynamic PDH/PDL kind; congress `party`→`chamber` and `filed_at`→`filed_at_date`; round `iv_rank`; rename Largo `vwap`; persist/compute flow `score`; align flow-brief vs tape call-bias labeling; fix `market_label=EXTENDED`; hide unknown dark-pool side + de-collide React keys. *(LOW/INFO)*

---

*End of report. The platform's math is sound and there is no fabricated data — but the single headline stat members judge SPX Slayer on (win rate) is currently a lie produced by an outcome-labeling bug, and the "cross-validation" reassurance shown to members cannot actually catch a wrong wall. Fix #1 and #4 before anything else.*
