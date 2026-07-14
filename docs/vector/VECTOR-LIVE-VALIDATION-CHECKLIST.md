# Vector — Live Market-Hours Validation Checklist & Autonomous SDLC

*Owner: Claude (Vector mandate). This is BOTH (a) the Monday-open deep-dive checklist and (b) the
standing instruction source for the recurring market-hours validation agent. The agent reads THIS
file every run; refining this file refines what the agent checks. Companion to
`VECTOR-PRODUCT-VISION-2026-07-11.md` and `docs/audit/FINDINGS.md`.*

> **Why this exists.** Almost everything shipped in the 2026-07-11/12 cycle was verified against a
> **closed market** (last session Fri 2026-07-10), so the beads/rails were the *modeled* underlay,
> not real point-in-time recordings. The single most important open question — *does everything
> update dynamically & automatically, and are the walls/beads correct, for ALL stocks across ALL
> timeframes & DTE horizons during live RTH?* — can only be answered with the market open. This
> checklist drives that validation every trading day and feeds fixes back through a real SDLC loop.

---

## 0. The SDLC loop (how this runs all week)

1. **Recurring agent** fires several times per trading day during RTH (see `§9 Cadence`). Each run
   is a fresh, standalone session in this environment (repo cloned, AWS creds, Playwright ready).
2. Each run **reads this file**, executes the checks in `§2–§7` against **staging**
   (`https://staging.blackouttrades.com`) for a rotating ticker set (`§8`), and records results.
3. **On any FAIL/anomaly:** open a **draft PR** that appends a dated entry to `docs/audit/FINDINGS.md`
   (severity, ticker, timeframe/horizon, expected vs actual, evidence, suspected root cause). Do NOT
   fix product code in the validation run unless the fix is trivial + obviously correct; the run's
   job is to *find and document*, then hand the fix to a focused PR.
4. **On all-PASS:** append a one-line dated "healthy" note to the live-validation log
   (`docs/audit/VECTOR-LIVE-VALIDATION-LOG.md`, create if missing) and stay quiet otherwise.
5. **Notify the user** with a short summary each run (what was checked, PASS/FAIL counts, any P0/P1).
6. **Feedback:** as real findings land, Claude (main session) refines THIS checklist + the agent's
   trigger prompt — new things to look out for, tickers that misbehave, thresholds to tighten.

**Guardrails:** honesty over green — never fabricate a PASS; a check you couldn't run is `SKIPPED`
with the reason, never `PASS`. One temp Cognito user per run, always deleted. Never push to `main`
or any branch other than a fresh `fix/vector-live-*` / `docs/vector-live-*` branch off
`origin/blackout-web-sandbox`. Keep PRs small + single-concern.

---

## 1. Pre-open sanity (run once, ~09:25 ET / 13:25 UTC)

- [ ] Staging reachable (HTTP 200 on `/vector` after auth-redirect).
- [ ] Latest deploy = latest `blackout-web-sandbox` HEAD (ECS PRIMARY rollout COMPLETED; compare the
      running task image tag to the head SHA).
- [ ] Recorder cron `blackout-staging-vector-universe-snapshot` EventBridge rule ENABLED
      (`cron(*/5 11-21 ? * MON-FRI *)` unless we tightened it).
- [ ] `CRON_SECRET` present in `blackout-staging/app/env`; `POLYGON_API_KEY`, `CLERK/COGNITO` keys set.
- [ ] Redis (`blackout-staging-redis`) healthy: evictions ~0, memory < 70%.
- [ ] `vector_wall_history` table reachable (row count baseline captured for the diff below).

## 2. DYNAMIC / AUTOMATIC UPDATES — the headline (recheck every run)

This is the core "is everything live" question. For SPX + 2 rotating universe names + 1 non-universe:

- [ ] **Walls update with no user action** — leave the chart open ~2 min; the `gexAsOf` age chip
      stays fresh (< 30s during RTH), walls/flip values move with the tape.
- [ ] **New walls appear dynamically** — over ≥30 min, a strike that was NOT a top wall early
      becomes one later → a **new bead row starts at that point in time** (not retroactively filled).
- [ ] **Beads form/accumulate at 15s** — the rail densifies through the session; count beads in a
      fixed strike row at T and T+5min → count grew by ~roughly (elapsed/15s).
- [ ] **Beads thicken as a wall strengthens** — the dominant wall's band gets visibly fatter in the
      stretch where its `pct` share rose; a fading wall thins. (Strength×time, per #172.)
- [ ] **`vector_wall_history` DB accrues** — row count for each viewed ticker increased vs the
      pre-open baseline; `spxRailLen` (from the cron read-back / a force-run) increments run-over-run.
- [ ] **Terminal narration updates live** — regime / magnet / proximity / integrity change as the
      walls move (not frozen); a flip-cross fires a regime-change mark when spot crosses the flip.
- [ ] **Recorder health** — CloudWatch shows no `[vector-wall-persist] append failed` spam; the cron
      returns `{ok, rows:21, spxRailLen:>prev}`.
- [ ] **Off-hours contrast** — confirm the RTH rail is SOLID observed beads (full opacity), NOT the
      dim modeled underlay (which is the closed-market look).

## 3. WALL CORRECTNESS (independent ground-truth, rotate 3–4 tickers/run)

- [ ] **Spot prices** match Polygon last/close (SPX ≈ 10× SPY; per-ticker within ~0.2%).
- [ ] **Top call & put walls** match an **independent Polygon-chain BSM recompute** (own gamma×OI×100×S²·0.01,
      monthly horizon) — reuse `scratchpad/gex-groundtruth.mjs` pattern; use FULL pagination (don't cap
      contracts — the SPX flip mismatch on 2026-07-12 was a truncation artifact, fix it here).
- [ ] **Gamma flip** near spot and sensible; matches the independent recompute to < ~0.5 pt.
- [ ] **Oracle path (SPX/SPY/QQQ)** — `all` walls come from UW's per-strike gamma; sanity-check the
      dominant strikes roughly agree with the chain-BSM (methodology differs; not exact).
- [ ] **No malformed numbers** — scan API payloads for unrounded floats (e.g. `7499.360000000001`).
- [ ] **Call/put sign** — call walls net-positive gamma (gold), put walls net-negative (purple).

## 4. BEAD RENDERING & THICKNESS (across colors, verify visually + from data)

- [ ] **Thickness = strength, relative to the in-view king** (#172): on a CONCENTRATED name (NVDA-
      type, one 30–40% wall) the king is a fat band and stragglers are thin; on an EVEN name (AMD-
      type, 7–15% spread) bands are honestly similar. Confirm the ratio isn't collapsed (regression
      guard: a 40% vs 14% wall must not render identically).
- [ ] **Both colors visible** — gold call AND purple put beads both render (post #174 viewport +
      #176 luminance). If a chart shows only one color, confirm the other side genuinely has no wall
      (not a clip/luminance regression).
- [ ] **Per-side normalization** — the strongest PUT wall is full-weight on its own even when calls
      dominate (purple never washes out just because a call wall is bigger).
- [ ] **Beads stop short of the price axis** (rightOffset whitespace, #173) — bands don't run flush
      into the axis.
- [ ] **Modeled vs observed** — during RTH the beads are SOLID (observed); the dim modeled underlay
      should be overwritten wherever the recorder has real samples.
- [ ] **Bead re-bucketing per timeframe** — see §5.

## 5. TIMEFRAMES (test 1m / 3m / 5m / 15m + one custom, per 2–3 tickers)

- [ ] **Wall count scales with TF** (#169): 1m→6, 3m→8, 5m→10, ≥15m→12 near→far walls shown; more,
      further-out walls appear as you zoom out; extra lines clear on downshift.
- [ ] **Beads re-bucket** per TF (coarser buckets on higher TF) without dropping the dominant wall.
- [ ] **Axis adapts** — autoscale widens on higher TF to reveal the outer walls; stays tight on 1m.
- [ ] **Candle aggregation correct** — OHLC per TF matches the 1m rollup (no gaps/dupes at bucket
      boundaries; last forming bar updates live).
- [ ] **No flicker/leak** on TF switch (overlays repaint once, no orphaned price lines).

## 6. DTE HORIZONS (0DTE / weekly / monthly / all, per 3–4 tickers incl. SPX/SPY/QQQ)

- [ ] **Walls + flip re-scope** across horizons for EVERY ticker incl. the oracles (#171 regression:
      SPX/SPY/QQQ must NOT show identical walls/flip for 0dte/weekly/monthly).
- [ ] **Terminal re-scopes with the toggle** (#170): regime/magnet/proximity/integrity + banner flip
      match the horizon's walls, and re-derive the instant you toggle (not on the next tick only).
- [ ] **Coherence** — the banner's gamma-flip number == the walls-API flip for the selected horizon.
- [ ] **Toggle present** for all optionable tickers (not hidden).
- [ ] **Honest sparse-expiry fallback** — thin names (ASTS/RKLB/EOSE, monthlies only) legitimately
      show the same walls across 0dte/weekly/monthly (nearest-expiry fallback), NOT a bug.

## 7. NON-UNIVERSE STOCKS (the "all stocks, not just 21" mandate)

Pick 2–3 NON-universe optionable names each run (rotate: ASTS, RKLB, SNOW, CRWD, EOSE, PLTR, SOFI,
IREN, ALAB, HOOD, etc.):

- [ ] Loads 200, zero console errors, DTE toggle present, walls+beads+terminal all render.
- [ ] **Records + persists during RTH** — after viewing for ~1 min, the `vector_wall_history` DB has
      new rows for that ticker (the SSE `persistWallSampleDebounced` path, every 15s), i.e. it
      behaves like a universe name while viewed. Confirm the rail survives after closing the tab
      (re-open → the accumulated beads are still there).
- [ ] **Cold-load speed** — first paint (walls/beads) within a few seconds; note the time.
- [ ] **A cheap (<$10) name** (EOSE-type) for price precision — strikes/labels not collapsed by
      integer rounding.

## 8. Ticker rotation (cover breadth over the week, not all every run)

- **Indices/ETFs:** SPX, SPY, QQQ, IWM, DIA, NDX
- **Mega-cap universe:** NVDA, TSLA, AAPL, AMZN, META, MSFT, GOOGL, AMD, NFLX, COIN, MSTR, SMH
- **Non-universe rotation:** ASTS, RKLB, SNOW, CRWD, EOSE, PLTR, SOFI, IREN, ALAB, HOOD, SMCI, AFRM
- Each run: ~1–2 indices + ~3 mega-caps + ~2–3 non-universe + 1 cheap name. Rotate so all are hit
  across the week. Always include SPX (oracle baseline) + one repeat from the prior run (drift check).

## 9. Cadence & run procedure

- **Cadence:** ~4×/trading day — near the open (≈09:35 ET), late-morning (≈11:30), midday (≈13:30),
  and before the close (≈15:35). Weekdays only. (Cron min is hourly; see the Routine.)
- **Per run:**
  1. `git fetch origin blackout-web-sandbox && git checkout` a fresh `*/vector-live-*` branch off it.
  2. Read THIS file + the last few `docs/audit/FINDINGS.md` entries + the live-validation log tail.
  3. Sign into staging (temp Cognito, `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`, pattern
     from `scratchpad` shot scripts / `scripts/staging-cognito-e2e.mjs`). `POLYGON_API_BASE=https://api.massive.com`.
  4. Run §2–§7 for the rotation set; capture screenshots + structured JSON; run the Polygon
     ground-truth cross-check (§3).
  5. Diff `vector_wall_history` row counts vs the run's own pre-check baseline (proves accrual).
  6. Write results to the live-validation log; open a draft PR **only if** there are findings
     (append to `FINDINGS.md`), else quiet.
  7. Notify the user: `[Vector live-check HH:MM ET] N checks, P pass / F fail; <top finding or "all healthy">`.
- **Time budget:** keep each run under ~15 min; if the rotation is large, cover a subset and log
  what was deferred (never silently skip).

## 10. Environment realities (carry-over, must respect)

- WebSockets + raw Postgres TCP are blocked from the sandbox; use HTTPS egress only. DB checks go
  through an app endpoint / `railway`-side, or via the cron read-back (`spxRailLen`), not a raw `pg`
  socket. (`vector_wall_history` direct reads may not be possible from here — prefer the read-back /
  an HTTP debug path; note if a DB check is SKIPPED for this reason.)
- Bead rail bucket = **15s** (`DEFAULT_WALL_TRAIL_SAMPLE_SEC`). Recorder cron baseline = 5 min
  (universe only, zero-viewer). SSE while-viewed = 15s for ANY ticker.
- Oracle tickers = SPX/SPY/QQQ (UW per-expiry ladder). Everyone else = Polygon-chain BSM.
- Clerk/Cognito rate-limits rapid sign-in cycles — authenticate ONCE per run.

## 11. Regression watch-list (fixes that must keep holding)

| Ref | Must stay true |
|-----|----------------|
| #171 | SPX/SPY/QQQ DTE toggle re-scopes (not identical across 0dte/weekly/monthly) |
| #172 | Bead thickness scales with strength; 40% vs 14% walls render differently |
| #173 | Clean axis — no wall/dark-pool labels; single flip line; right-edge whitespace |
| #174 | Nearest put wall pulled into view (purple not clipped) |
| #176 | Purple reads at parity with gold |
| #170 | Terminal/banner follow the DTE horizon + re-derive on toggle |
| #169 | Wall count scales with timeframe |
| #164 | `vector_wall_history` durable write-through (rail survives Redis restart) |

## 12. Backlog to (re)validate or build as findings warrant

Heatmap render (#14), expected-move cone (#15), AH rail extension (#12), dark-pool $ levels (#23),
alerts+push (#19), flow markers (#20). The live agent may surface which of these members most need.

---

### Change log for this checklist (append as we refine)
- 2026-07-12 — created from the 07-11/12 cycle + the RTH-dynamics discussion. Initial focus: prove
  dynamic recording/rendering for ALL stocks at 15s across all TF + DTE; ground-truth wall
  correctness; the shipped-fix regression watch-list.
