# Night Hawk OVERNIGHT playbook — architecture, forensics, decision (deep-dive)

**Date:** 2026-07-14 · **Branch:** `docs/nighthawk-overnight-decision` (docs only — no code touched)
**Scope:** the EVENING edition ("tomorrow's plays", published ~5:30 PM ET for the next session) — NOT
the intraday 0DTE Command board, which was rebuilt separately tonight (#311–#325).
**Companion docs:** `docs/audit/NIGHTHAWK-0DTE-DECISION.md` (framing conventions, breakeven math,
F-1..F-6), `docs/audit/NIGHTHAWK-CORTEX-DESIGN.md` (the evidence composer this doc proposes reusing).
**Evidence base:** staging APIs pulled 2026-07-14 ~03:15 UTC (temp Cognito admin+premium user, deleted
after each run) + Polygon daily bars. All 26 plays the product has ever published (10 editions,
2026-06-29 → 2026-07-14) were reconstructed from the edition API and independently re-graded with a
line-for-line mirror of the app's own `resolveOutcome()`. Raw payloads + joined dataset + reproducible
scripts: session scratchpad `nh-overnight/` (`raw/*.json`, `derived.json`, `pull.mjs`, `pull2.mjs`,
`pull3.mjs`, `derive.mjs`). LOW-N discipline: n is stated on every cut; the entire product history is
26 published / 14 app-resolved plays, so **every** cut here is LOW-N — treat direction-of-effect as the
signal, not the percentages.

---

## 0. Executive summary — the five load-bearing findings

1. **The "12 pending" is a P0 grading bug, not slow data.** `ensureSchema()` re-issues the
   `nighthawk_play_outcomes_outcome_check` CHECK twice: `src/lib/db.ts:547-551` adds it WITH
   `'unfilled'`, then `src/lib/db.ts:820-823` (stale, pre-fix copy) DROPs and re-ADDs it WITHOUT
   `'unfilled'`. The later statement wins on every boot, so **every UPDATE that grades a play
   `unfilled` throws a check-constraint violation and the row stays `pending` forever.** The
   cron-health meta for `nighthawk-outcomes` lists exactly the 12 stuck rows (AAPL/CSX/MAGS@07-06,
   AMZN/BAC/TSLA@07-07, AMD/DELL/WFC@07-08, PG@07-09, META/PANW@07-10 — `raw/cron-health.json`),
   and 12 = published 26 − resolved 14 exactly. Compounding it: the resolver only looks back 7 days
   (`play-outcomes.ts:582`) while `pending_count` is unwindowed (`db.ts:6049-6051`), so once the fix
   lands the backfill must be explicit or these become permanent orphans.

2. **Every advertised win was unfillable at the published entry.** Bucketing the 14 app-resolved
   plays by "did the stock open beyond the entry band in the trade direction": open-beyond-band
   plays went **6 target / 1 stop, avg +5.11%** — all 6 of the record's wins live here — while plays
   that opened fillable went **0 target / 4 stop, avg −1.39%** (n=7 each). Re-grading all 26 plays
   under the CURRENT `resolveOutcome()` rules (fillability included): **1 target / 5 stop / 3 open /
   17 unfilled** — a scoreable record of 1W/5L (~11% WR, n=9), and the single surviving "target"
   (AMD 2026-07-01) had a close-based return of **−0.94%**. The advertised 42.9% WR is 5 wins
   grandfathered from before the fillability rule existed plus 1 win that lost money.

3. **Entry bands are systematically detached from the live price at publish time.** 14 of 24 LONG
   plays published an entry-band top >3% BELOW the prior close; the six thin-edition backfill plays
   are the extreme: bands 6.4%–45.5% below the market with targets +8.6% to **+106.6%** above the
   band (DELL 2026-07-08: band $226.82–227.27, stock at $417, target $469.47). No publish gate
   checks that the entry is reachable or the target achievable within the one-session grading
   horizon. These six all wear conviction "A" — assigned mechanically by `convictionFromScore`
   (≥55 → "A", `scorer.ts:690-695`), not earned.

4. **The book is a long-only monoculture with no market-state discipline.** 24/26 plays LONG
   (both shorts were June); all 16 July plays LONG. The regime context only *scales* scores
   (multiplier 0.7–1.2, `scorer.ts:58-75`) — nothing flips or vetoes the book on a bearish tape.
   July's resolved plays went 0 target hits (7/07, 7/09, 7/10 editions: 0W across n=4), semis took
   7 of 14 resolved slots (1W/6L, −1.41% avg — the API's own `by_sector`), and AMD was re-published
   3 editions in 8 days (A+ 7/07 → −6.6%). Tonight (7/14), on the first genuinely BEARISH evening
   tape in the dataset (SPX −0.79%, breadth 30.5% advancing), the funnel published **zero plays** —
   recap-only. The machine can only say "long" or say nothing.

5. **Morning confirm can see the disaster and cannot stop it.** The 9:15 ET check
   (`nighthawk-morning-confirm/route.ts`) computes CONFIRMED/DEGRADED/INVALIDATED per play —
   including "gapped through the stop" (`morning-confirm-verdict.ts:87-89`) — but an INVALIDATED
   verdict only writes a Redis badge (24h TTL) and a Discord ops ping (`route.ts:375-408`). The
   edition is never mutated, the play is never pulled, and the verdict is never persisted, so
   confirm-vs-outcome calibration is impossible (the 0DTE doc's C-2 gap, replayed). AMD 7/07 (the
   record's only A+) gapped −6.55% through its published stop pre-market and stayed on the board to
   book −6.59%.

**Decision in one line:** the overnight edition's losses are dominated by (a) grading debt —
fix and regrade before believing any number — and (b) publish-time gates that do not exist
(band-vs-spot, achievable target, catalyst veto, book-vs-tape alignment); wire the already-built
Cortex composer + the 0DTE discipline stack (context pinning, honest LOW-N record, tier engine,
morning re-compose → auto-pull) into the edition funnel via small PRs (§4) rather than building
anything new.

---

## 1. Architecture map (the full pipeline, file:line)

### 1.1 Evening build — cron → funnel → publish

**Trigger.** `/api/cron/nighthawk-edition` (`src/app/api/cron/nighthawk-edition/route.ts`), window
17:30 ET + 120min catch-up (`route.ts:27-37`, env-overridable). Fire-and-forget: the route dispatches
`buildEveningEdition()` via `after()` and returns 202 in <60s (`route.ts:90-141`); the real work runs
on the ECS worker (`npm run nighthawk:run`). Status/resume via the `nighthawk_jobs` checkpoint row.

**Builder.** `buildEveningEdition()` (`src/features/nighthawk/lib/edition-builder.ts:317`), staged and
checkpoint-resumable, with a funnel accumulator logged at every exit (`edition-builder.ts:53-84`):

| Stage | What | Where |
|---|---|---|
| 1 context | `fetchMarketWideContext()` — UW flow alerts (limit 450), hot chains, sector/ETF tides, top-net-impact, VIX IV rank/term, breadth, market news, **tomorrow's earnings** (UW premarket+afterhours calendars filtered to tomorrow, `market-wide.ts:141-150,293`), after-hours Benzinga catalysts, platform intel | `edition-builder.ts:397-413` |
| 2 candidates | `extractCandidateTickers()` — premium-relative gate: weighted premium (sweep ×1.5, opening ×1.3) vs 30-day avg-premium baseline ("unusualness"), 28 premium slots + 12 unusual slots, max 40 (`constants.ts:44-48`); excludes indices/leveraged ETPs/SPAC suffixes (`candidates.ts:52-58`), penny floor $2 | `candidates.ts:205-271` |
| 3 dossiers | `fetchAllDossiers()` per candidate (flow, technicals, dark pool, OI change, positioning, strike stacks, news+earnings articles, congress/institutional, fundamentals, catalysts, FDA calendar, risk-reversal skew, short interest) → staged to `nighthawk_dossiers_staging`, archived on clear (task #129) | `dossier.ts`, `edition-builder.ts:459-513` |
| 4 scoring/ranking | `scoreCandidate()` sums flow (≤38, `scorer.ts:311-422`) + technicals (−10..28, `:424-455`) + positioning (≤18, `:474-528`) + news (−6..8, `:655-688`) + smart money (−2..8, `:599-636`) + fundamentals (±8, `:142-190`) + short interest (≤5) + catalysts (±5, `:207-265`) + earnings −6 (`:823-831`) + anomaly −10 (`:854-860`), × regime multiplier 0.7–1.2 (`:58-75`), clamp 0–100. `rankCandidates()` (`:929-965`): only `trading_halt` is a hard cut; fundamental blocks soft-demote. Top 12 → synthesis (`constants.ts:53`) | `scorer.ts:740-912` |
| 5 synthesis | `generateEditionPlays()` — chain prefetch (12 tickers), Claude (temp 0, 4500 tok, 90s timeout, `claude-edition.ts:243-247`) or the deterministic selector when Claude is off (`:182-211`); then the deterministic gate chain: **geometry** (`validatePlayGeometry`, `:266-289`) → **premium cap** $20/share (`constants.ts:74`) → **soft strike gate** (OI-contradiction only) → **numeric grounding** (`groundPlays`, `grounding.ts:469-518`: OI≥500, live-mark premium overwrite, level-traces, PT strip) → **sector cap** 2/sector (`play-constraints.ts:183`). Every rejection now writes a durable audit row (tasks #141/#142). Then the LLM critic `critiquePlays` (`play-critic.ts`) → slice to 5 | `claude-edition.ts:112-451` |
| 5b backfill | `backfillThinEditionPlays()` tops up thin editions from the ranked pool with chain-grounded contracts + `buildDirectionalStockLevels()` entries (`play-levels.ts:59-95`) | `edition-builder.ts:779-792` |
| 6 publish | final geometry gate (`:799-809`), zero-play guard → recap-only, `upsertNighthawkEdition`, `syncNighthawkPlayOutcomes` (creates the pending grading rows), job → published | `edition-builder.ts:794-929` |

**"Grounded plays cleared"** (the pane's empty state, `PlaybookBoard.tsx:255`): *grounded* = survived
`groundPlays` numeric grounding (every published number traces to a real chain contract / dossier
figure / S/R level); *cleared* = survived the whole funnel above. A recap-only edition means the
funnel legitimately zeroed — `publishRecapOnlyEdition` (`edition-builder.ts:202-315`) still writes a
real market-recap row (never fabricated plays) with `meta.recap_only_reason` naming the stage that
zeroed, and a clobber guard so a rescue can never overwrite a good playbook (`:275-295`).

**Caps/gates that exist at publish:** geometry, $20/share premium, OI≥500 grounding, sector≤2,
5-play slice. **Caps/gates that do NOT exist:** entry-band-near-spot, achievable-target (target
distance vs 1-day range), catalyst/earnings *veto* (only a −6/−3 score nudge, §3.4), book-vs-tape
direction alignment, cross-edition repeat governor (AMD published 3× in 8 days), Cortex evidence.

### 1.2 Morning confirmation — a label, not a gate

`/api/cron/nighthawk-morning-confirm` fires 13:15 + 14:15 UTC weekdays (dual band for DST; the
off-band fire self-skips via the 9:10–9:45 ET window guard, `route.ts:65-69` — this is why cron-health
shows a benign "Last run skipped" warning). Holiday guard (`:210-214`), session-match guard (`:245-253`),
and a global abstain when every data source is unreachable (`:322-338` — verdicts are withheld, not
fabricated). Per play, `computePlayVerdict()` (`morning-confirm-verdict.ts:53-228`) checks, in order:
the play's OWN pre-market price vs its stop/target/band (check 0, the strongest), SPX gap >20 pts
against direction, contrary flow anomalies (1 = DEGRADED, ≥2 = INVALIDATED), GEX wall shifts vs
edition walls (10/30 pt soft/hard), regime mismatch (bear regime vs LONG = INVALIDATED), zero-checks
→ UNVERIFIED.

**What INVALIDATED actually does:** writes the blob to Redis `nh:play-status:{date}` (TTL 24h,
`route.ts:47-48,375-386`) for the UI badge, Discord ops alert (`:398-408`) — **and nothing else**.
The header comment is explicit: "The edition is NEVER mutated" (`route.ts:17-18`). The play stays
tradeable on the board all day, the badge freezes as a 9:15 snapshot (staleness flagged after 4h,
`morning-confirm-verdict.ts:29`), and the verdict evaporates with the Redis TTL — there is no
persisted verdict history anywhere, so "how predictive is DEGRADED?" is unanswerable (C-2 class).

### 1.3 Grading — next-day daily bar, underlying only

`/api/cron/nighthawk-outcomes` (16:30 ET window; 20:30+21:30 UTC fires) →
`resolvePendingNighthawkOutcomes({lookbackDays: 7})` (`play-outcomes.ts:575-627`): one Polygon daily
bar per play for `edition_for` (the play's single target session — hold duration is hardcoded one
session, `outcomeSessionDate` `:495-497`). `resolveOutcome()` (`:499-573`):

- `pending` if no close; **`unfilled`** if the session never traded back into the entry band
  (LONG: low > band-top; SHORT: high < band-low, `:531-535`);
- `target` if session high/low touched target; `stop` only with intraday data; both-touched
  tiebreaks on the open, else `ambiguous` (`:557-570`);
- `stop_data_unavailable` when a stop exists but no intraday H/L.

**Grading holes (same class as the 0DTE index-root null-grades):**
- **H-1 (the P0):** `'unfilled'` verdicts cannot be written — the stale second
  `ALTER TABLE ... ADD CONSTRAINT` at `db.ts:820-823` re-issues the CHECK without `'unfilled'`,
  clobbering the correct one at `db.ts:547-551` on every boot. All 12 "pending" rows are failed
  `unfilled` writes (§0.1). The cron still logs `last_status: ok` with the 12 errors tucked in
  `meta.errors` — a red loop that never pages anyone.
- **H-2:** resolver lookback 7d vs unwindowed `pending_count` → silent permanent orphans once H-1's
  rows age out (2026-07-06's rows left the window today).
- **H-3:** options plays are graded on the UNDERLYING's level touch, not option P&L — a "target"
  can lose premium and a "stop" can profit (the 0DTE doc's F-6: 3 of 14 tags contradict close-based
  returns — AMAT 6/29 "stop" +5.25%, NVDA 7/09 "stop" +1.05%, AMD 7/01 "target" −0.94%).
- **H-4:** `parsePlayLevels` splits the whole entry text on `-` (`play-levels.ts:26-28`), so a
  contract token like "Jul-17" poisons the band — OKTA/MRK 6/29 persisted `entry_range_low=17`
  vs highs of 115/114.36 (the #207 corrupt-range class; `entryRangeMid`'s >20%-width guard nulls
  the P&L but the rows still grade).

### 1.4 Display / record

`NightHawkFeed.tsx` pulls `/api/market/nighthawk/record?days=30` (SWR) → `HawkRecordStrip`. Under
`TRACK_RECORD_MIN_SAMPLE = 30` resolved (`components/track-record/format.ts:11`) it renders the
building state — hence "Hawk Record — 14/30 resolved · 12 pending". The 14 and the 30 are honest;
the **12 pending is H-1**, not genuine pendingness: 12/26 published plays (46%) are stuck in a
failed-write loop, and under current rules they are all `unfilled`. The record route
(`api/market/nighthawk/record/route.ts:16-45`) serves `getNighthawkMetrics()` (`analytics.ts:222-311`)
which correctly excludes `unfilled` + `stop_data_unavailable` from ratio denominators — the math is
honest; the inputs are stuck.

---

## 2. Track-record forensics (all 26 published plays, quantified)

Dataset: `nh-overnight/derived.json` — the 26 plays from the edition sweep (`raw/editions-sweep.json`)
joined with Polygon daily bars, app grades from `/api/track-record/plays`, and a line-for-line mirror
of `resolveOutcome()`. Methodologies are never blended: "app-graded" = what the product served;
"current-rules" = the same grader re-run with today's fillability rule on all 26.

### 2.1 The headline record, three ways

| Methodology | n | Target | Stop | Open | Unfilled | WR (scoreable) |
|---|---|---|---|---|---|---|
| App-graded (what members see) | 14 | 6 | 5 | 3 | 0 | **42.9%** |
| Current-rules re-grade, same 14 | 14 | 1 | 5 | 3 | 5 | **11.1%** (1/9) |
| Current-rules, all 26 published | 26 | 1 | 5 | 3 | 17 | **11.1%** (1/9) |

Five of the six advertised wins (OKTA, HIMS, MRK 6/29; ANET, ORCL 6/30) grade `unfilled` under the
product's own current rules — they were graded before the fillability fix and never re-graded. The
sixth (AMD 7/01) filled and touched target intraday but closed −0.94% from band mid. **There is no
methodology under which the overnight book has a real, fillable, positive-expectancy record yet.**
(The economics-vs-tags mirror: `profitable_rate` 58.3% vs WR 42.9% on app grades — H-3.)

### 2.2 Where the losses concentrate (named failure modes)

**N-1 · Constraint-clobbered grading (GRADING).** §0.1 / H-1. Effect: 46% of all published plays
invisible to the record; the strip under-reports both the unfilled problem and the sample size.

**N-2 · Phantom-win record / methodology blend (GRADING).** §2.1. open-beyond-band=true: 6T/1S,
avg +5.11% (all six wins); open-beyond-band=false (genuinely fillable): **0T/4S, avg −1.39%**.
The record's wins are gap-aways the entry could never catch; its fillable plays all failed.

**N-3 · Detached entry bands (STRATEGY + missing publish gate).** 14/24 LONG band-tops >3% below
prior close (max −45.5% DELL). The six backfill plays (MAGS/CSX 7/06, DELL 7/08, PG 7/09, PANW/META
7/10) pair a ~0.1%-wide band far below spot with dossier "resistance" targets +8.6%..+106.6% away —
structurally ungradeable placeholder plays, all conviction "A", all now stuck in H-1. Root: the
backfill anchors entries at deep dossier supports (`buildDirectionalStockLevels`, support×0.998) with
no band-vs-live-quote check anywhere in the publish path.

**N-4 · Long-only monoculture, no tape discipline (STRATEGY).** 24/26 LONG; all 16 July plays LONG.
July resolved: 0 target hits (n=4 across the 7/07–7/10 editions) vs 6 target hits across the 10
resolved plays from the 6/29–7/01 editions — the entire winning tail is one late-June up-tape week.
SPX-down-day sample: n=1 (AMD A+ 7/07, −6.59%) — the same degenerate-evidence gap as
Slayer (0DTE doc F-3). The regime multiplier (0.7–1.2) can shave a score; it cannot short the book,
skip the night, or demand alignment.

**N-5 · Sector/name crowding (STRATEGY).** Semis: 7/14 resolved slots, 1T/6-non-win (API `by_sector`:
14.3% WR, −1.41% avg). AMD published 3 editions in 8 days (7/01 "target" −0.94%, 7/07 A+ stop −6.59%,
7/08 unfilled). The per-edition sector cap (≤2) landed only recently and nothing governs
cross-edition repetition or correlated-book risk.

**N-6 · Conviction/score inversion (CALIBRATION — F-5 family, 4th independent surface).** App-graded:
A+ 0/1 (−6.59%); A 3T/0S but avg **−0.55%** (wins that lose money); B 3T/4S avg +2.99%. Score bands:
70–84 → 25% WR (n=4) vs 55–69 → 66.7% (n=6). And conviction "A" is mechanically over-issued: every
score ≥55 maps to "A" (`scorer.ts:690-695`), the backfill path takes the deterministic letter
unmodified, so all six N-3 placeholder plays shipped as "A". LOW-N everywhere, but the same top-band
inversion now appears on four surfaces independently.

**N-7 · Morning confirm is advisory (PROCESS).** §1.2. It correctly detects gapped-through-stop
(AMD 7/07 −6.55% pre-market) and can only badge it. Verdicts unpersisted (Redis 24h) → no
confirm-vs-outcome calibration possible; the 7/13 blob survives (`raw/play-status-2026-07-13.json`,
an honest all-zero blob for a zero-play edition — the #324 fix working as designed) but 6/29–7/10
verdicts are gone forever.

**N-8 · Bearish-night collapse (STRATEGY/coverage).** Recap-only nights: 7/02, 7/13, 7/14. Tonight's
recap (`raw/edition-current.json`): "BEARISH — calls 0% ($4.3K) vs puts $2.2M … VIX 15.84". The funnel
zeroed exactly when a short book would have been the play. 180d rejection funnel: 15 rejections =
10 ungrounded + 3 illiquid-strike + 2 geometry (`analytics-180.json.funnel`) — grounding is doing its
job; nothing upstream generates short candidates on a red tape (the flow scorer CAN emit shorts —
2/26 — but nothing forces the question "should tonight's book be short or empty?").

**N-9 · Corrupt band parses (GRADING, residual).** H-4 (OKTA/MRK `entry_range_low=17`). The publish
geometry gate now catches new instances; the two historical rows still sit in the record as "target"
wins (both also N-2 phantom wins).

### 2.3 Cuts the data supports (all LOW-N, app-graded n=14)

- **Direction:** LONG 12 (5T/4S, +0.04% avg) · SHORT 2 (1T/1S, +7.74%). No short evidence, same as
  every other surface.
- **Day-of-week (edition target session):** Mon 5 (3T/2S, +2.62%) · Tue 4 (2T/2S) · Wed 2 (−3.88%)
  · Thu 2 (0T/1S) · Fri 1 (0T). Nothing actionable at n≤5.
- **Gap direction vs pick:** gap-with 7 (4T/3S, +4.47%) · gap-against 7 (2T/2S, −1.83%) — but §2.2
  N-2 shows the "gap-with wins" are mostly the unfillable ones; the honest lesson is *the gap decides
  the outcome before the member can act*, which is exactly what a morning re-compose gate should own.
- **VIX-at-entry / regime-at-entry / confirmed-vs-degraded buckets: impossible** — not persisted
  per-play anywhere (the 0DTE C-2 gap verbatim; morning verdicts additionally expire in 24h).

---

## 3. Gap analysis vs tonight's arsenal (what the overnight picker ignores)

### 3.1 Cortex (`src/lib/nighthawk/cortex/`) — the highest-leverage plug-in

`fetchCortexInputs(ticker, direction)` (`fetch.ts:378`) + `composeCortexEvidence(inputs)`
(`compose.ts:103-216`) already exist, are pure/deterministic, and are wired ONLY into the 0DTE gate
stack (`src/lib/zerodte/cortex-gate.ts`). Eight sources (gex-walls, wall-trend, flow-quality,
sector-heat, catalyst-news, vex-charm, darkpool-confluence, opening-harvest), per-source support caps,
unbounded vetoes (one loud bearish fact kills an entry; one loud bullish signal can never buy one),
evidence decay with half-lives, conviction capped at A while the F-5 inversion stands.

- **At PUBLISH time:** after the sector cap in `generateEditionPlays` (`claude-edition.ts:401-424`),
  compose per play (`direction` from the play), attach `verdict` to the play card (evidence table =
  `verdict.narrative`), and treat `vetoes.length > 0` as a sixth rejection stage
  (`NighthawkRejectionDetail` gains `{stage:"cortex_veto"}` — the audit-row machinery from #141/#142
  is already generic). Two decay caveats to handle honestly: at 5:30 PM ET the opening-harvest source
  is absent-by-design, and fast-half-life evidence (flow clusters) will be near-silent — the evening
  composition is mostly the structural sources (gex-walls, wall-trend, sector-heat, catalyst-news,
  darkpool). That is the correct subset for an overnight hold.
- **At MORNING-CONFIRM time (the real prize):** re-compose per play at 9:15 with fresh inputs and
  make the result BINDING (§3.6/PR-N3): fresh veto or direction-contradicting regime → the play is
  status-latched PULLED (never re-armed), badge + strike-through on the board, persisted verdict row.
  This converts N-7 from a label into the discipline the 0DTE rebuild proved tonight (#312's G-gates).

### 3.2 Vector (walls / beads / gamma regime / flip)

The morning confirm already consumes wall drift crudely (±10/30 pt SPX walls,
`morning-confirm-verdict.ts:137-199`). What it ignores: per-TICKER wall structure. Cortex's gex-walls
+ wall-trend sources already encode "path to target is through the dominant opposing wall" and
"wall forming/growing/fading" — an overnight LONG whose target sits beyond a hardening call wall on
the ticker's own ladder is fighting dealer structure. Plug-in point is the same as §3.1 (no separate
integration needed — Vector reaches the edition THROUGH Cortex). Additionally, the edition's SPX walls
are captured in `market_recap` but per-play `editionCallWall/PutWall` are read from the recap only for
SPX (`nighthawk-morning-confirm/route.ts:308-311`) — per-ticker edition-time walls should be pinned in
`entry_context` (§3.5) so the 9:15 re-compose can measure *shift* rather than just level.

### 3.3 Thermal / heatmaps (strike×time GEX, sector heat)

N-5 (semis 1W/6L) is a sector-crowding failure the sector-heat source already measures. At publish:
sector-heat oppose/veto flows into the Cortex verdict per §3.1. Beyond Cortex, one cheap deterministic
gate: when >N of tonight's candidates share a sector AND that sector's day change is against the play
direction, demote below the slice line (the data is already in `ctx.sector_tides` /
`dossier.sector`). Dealer-positioning context (strike×time GEX heat) rides in via gex-walls.

### 3.4 BIE — breadth, fundamentals, catalysts/earnings (the overnight killer, checked)

**What exists today (it is NOT nothing, but it is only a nudge):**
- `tomorrow_earnings` is fetched every night (UW premarket+afterhours calendars,
  `market-wide.ts:141-150,293`) and threaded through `rescoreDossier` (`hunt-builder.ts:148-176`,
  called on the edition path at `edition-builder.ts:503-513`);
- earnings today/tomorrow + a flow expiry into the event ⇒ **−6** catalyst-score penalty +
  `earnings_risk` flag (`scorer.ts:823-831`); Benzinga binary/FDA ⇒ **−3** (`scorer.ts:217-227`);
  both clamped inside the ±5 catalyst cap.

**Why that is insufficient as an overnight gate:** (a) it is a score dent on a 0–100 scale — a
hot-flow name absorbs −6 and publishes anyway; (b) the earnings penalty only fires when a FLOW EXPIRY
matches the event date — a Friday-expiry play published the night before Tuesday earnings takes zero
penalty; (c) breadth/regime only touches the multiplier. **No play can currently be VETOED for an
earnings/binary event, and no play was:** the mechanism to check whether any of the 26 got published
into an earnings gap does not exist per-play (no `earnings_risk` on outcome rows — C-2 again).
Fix shape: earnings-tomorrow (or before the play's option expiry) + directional premium ⇒ hard
publish veto via the Cortex catalyst-news source (it already discriminates report timing), with the
usual SKIP-card visibility instead of silence.

### 3.5 The 0DTE discipline stack as a template (all merged tonight, all reusable)

| 0DTE piece | Overnight analogue |
|---|---|
| C-2 `entry_context` pinning (#311) | Pin on every `nighthawk_play_outcomes` row at publish: VIX close, regime, SPX/ticker walls, gap plan, score components, Cortex verdict JSON, morning-confirm verdict (when it runs). Cheap now, priceless in 30 sessions — the single biggest analysis blocker in §2.3. |
| Honest record w/ LOW-N chips (#322) | `HawkRecordStrip` already gates at n=30; add the unfilled/pending split and methodology tag so a regrade (PR-N1/N2) is visible, not silent. |
| Calibration loop + counterfactual SKIP grading (#323) | Grade REJECTED evening candidates too (the #141 audit rows already persist them) — "what would the vetoed plays have done" is the only way gates earn or lose their thresholds. |
| Exit engine (#321) | Overnight analogue is the morning re-compose auto-pull (§3.1) + a first-hour invalidation rule; a full intraday exit engine is out of scope for a next-day-graded product. |
| Governor (#312 G-5) | Per-edition: max plays per sector (exists), max same-name repeats per rolling week (missing — AMD ×3), halt-after-N-stopped-editions (missing). |
| Merit-tier engine (#325, `zerodte/tiers.ts`) | Directly reusable shape: tier from named factors (VIX band, score band, alignment…), display A+ LOCKED until `minGraded:10, minWinRatePct:80` (`tiers.ts:94`) — replaces `convictionFromScore`'s unearned letters (N-6). |
| One-way status latch (in flight) | Exactly what INVALIDATED needs (N-7): pulled-is-pulled, no flapping back to green at 9:40. |

### 3.6 Anything else in-repo the overnight path ignores

- **SPX Slayer desk bias / market-regime detector** — fetched into the synthesis prompt as prose
  (`edition-builder.ts:610-625`) but never a gate; tonight's `composite_regime` only nudges the
  multiplier.
- **The deterministic selector** (`deterministic-edition.ts`) — already builds grounded, geometry-
  valid plays without Claude; a natural place to force SHORT candidates on a bearish tape (N-8)
  since the Claude prompt currently inherits the long-heavy candidate pool.
- **`alert-outcome-sync` + BIE precedent search** — NH rows feed it, so every H-1-stuck row is also
  invisible to BIE precedents.

---

## 4. Decision + build plan

### 4.1 Honest framing

"100% winners" remains unachievable for the same reasons as the 0DTE doc §0 — and the overnight
surface is further from breakeven than 0DTE was: with the current one-session band→target/stop
geometry there is no asymmetric payoff plan at all (non-backfill targets sit 0.9–11% from the band,
stops are uncapped through overnight gaps — AMD 7/07 lost 6.6% against a 1.4% target), and the honest
fillable record is **1W/5L (n=9)**, not 42.9%. The
0DTE breakeven math (33.3% WR at −50%/+100%) does not even apply until the edition defines a payoff
plan; on stock-move grading the bar is a positive-expectancy fill-adjusted record, full stop.
Realistic target after the gates below, stated with LOW-N humility: **a fillable-play record in the
45–55% WR band on ≥30 graded, context-pinned plays, with unfilled rate <20% and zero
earnings-gap losses** — then tighten. Volume will drop (some nights: zero plays, honestly labeled);
that is the same precision-first trade the user accepted for 0DTE tonight.

### 4.2 GRADING bugs vs GENUINE strategy failures — do not conflate

**Grading (fix = migrate/regrade/backfill; no strategy change):**
- N-1/H-1 constraint clobber (P0), H-2 orphan window, N-9/H-4 corrupt bands, N-2's *methodology
  blend* (5 grandfathered wins), H-3 tag-vs-economics divergence (report both, as `profitable_rate`
  already does).
- After PR-N1+N2 land, the true record will REPORT WORSE (fewer wins, 17 unfilled). That is not a
  regression; it is the floor the strategy work is measured from.

**Strategy (fix = gates/evidence at publish + morning):**
- N-3 detached bands (publish gate), N-4 long-only/no-tape-discipline (Cortex + regime posture),
  N-5 crowding (governor), N-6 conviction inflation (tier engine), N-7 advisory morning confirm
  (binding re-compose), N-8 bearish-night collapse (short-side candidates or honest empty).

### 4.3 The PR ladder (small, one issue each, in order)

| PR | Root cause fixed | Change (files) | Expected effect | Validation |
|---|---|---|---|---|
| **PR-N1** | N-1/H-1 (P0 grading) | Delete the stale re-issue at `src/lib/db.ts:820-823` (keep `:547-551`); one-shot regrade of the 12 stuck rows (`?force=1&days=30` on `/api/cron/nighthawk-outcomes` after widening the lookback for one run, or a tiny backfill script); surface `meta.errors` as cron FAILURE not `ok` | 12 pending → graded (expect ~12 `unfilled`); pending_count ≈ tonight's edition only | unit: ensureSchema idempotence asserts `'unfilled'` allowed; staging: record shows 26 resolved, cron-health errors empty |
| **PR-N2** | N-2 methodology blend | Regrade ALL historical rows with current `resolveOutcome` (idempotent — same inputs persisted); stamp `grading_version` on rows; HawkRecordStrip shows unfilled count | One honest record (≈1T/5S/3O/17U); strip stops advertising phantom 42.9% | test on the 26-row fixture from `derived.json`; API diff before/after |
| **PR-N3** | N-3 detached bands | Publish gate in `generateEditionPlays` + backfill: reject/re-anchor when band-top <(spot−1.5%) for LONG (mirror for SHORT) or target further than k×ATR(14) (start k=1.0) from band; kills the placeholder-backfill class | Unfilled rate collapses; backfill either produces real plays or none | unit tests with the 6 backfill fixtures (MAGS/CSX/DELL/PG/PANW/META must all reject); funnel logs new stage |
| **PR-N4** | C-2 blindness | `entry_context` JSONB on `nighthawk_play_outcomes` (VIX, regime, walls, score components, Cortex verdict, spot-at-publish), written in `syncNighthawkPlayOutcomes`; persist morning-confirm verdicts to a table (not just Redis) | Every future calibration cut becomes possible | unit: row shape; staging: tonight's edition rows carry context |
| **PR-N5** | N-4/N-8/§3.1 | Cortex compose at publish: verdict attached to each play card + `cortex_veto` rejection stage (calibration mode first: log verdict, veto only on `catalyst-news` earnings/binary — the §3.4 overnight killer — for the first 2 weeks) | No more publishing into earnings gaps; evidence table on every card | unit on composer inputs; replay the 26-play fixture (AMD 7/07 must veto or heavily oppose on regime); staging edition meta carries verdicts |
| **PR-N6** | N-7 advisory confirm | Morning re-compose → binding: INVALIDATED/fresh-veto ⇒ one-way PULLED latch on the play (edition row untouched; a `pulled` overlay in the play-status blob + DB), UI strike-through; verdicts persisted (PR-N4 table) | Gapped-through-stop plays stop costing members money after 9:15 | unit on latch one-wayness; forced staging run with a synthetic gapped play |
| **PR-N7** | N-6 inflation | Port the #325 tier engine: conviction from named factors with A+ locked behind `minGraded≥10 & WR≥80%`; deterministic letters stop mapping 55→"A" | Conviction becomes earned; backfill plays can't outrank vetted ones | reuse `tiers.test.ts` pattern; replay: the six backfill plays must not exceed C |
| **PR-N8** | N-5 crowding | Cross-edition governor: same ticker ≤1 publish per rolling 5 sessions unless prior play graded target; sector cap counts the rolling week, not just tonight | Stops the AMD ×3 pattern | unit + replay on 7/01–7/08 fixture (7/07 and 7/08 AMD must block) |
| **PR-N9** | N-8 coverage | Bearish-tape posture: when tide/breadth/regime are bearish, force the deterministic selector to evaluate SHORT candidates from put-side flow before allowing recap-only | Red evenings produce shorts or an explicit "no aligned setups" skip note | replay tonight's 7/14 context fixture |

**Recommended build order: PR-N1 → PR-N2 → PR-N4 → PR-N3 → PR-N5 → PR-N6, then N7–N9.** N1/N2 are
prerequisites for believing any number the later gates are judged by; N4 must precede N5/N6 so the
gates are born calibratable.

### 4.4 Standing verification

- Every PR ships with unit tests + a replay assertion against the 26-play fixture in
  `nh-overnight/derived.json` (this doc's §2 tables become regression tests, same pattern as the
  0DTE gates' 7/13 replay suite `gates-replay-2026-07-13.test.ts`).
- Re-run `nh-overnight/pull*.mjs` + `derive.mjs` after 10 gated editions; diff the cut tables. The
  gates must move the unfilled rate and the fillable-play WR, or be revisited.
- The market-open validation runbook gains: "NH pending_count equals tonight's play count; no
  `outcome_check` errors in nighthawk-outcomes cron meta; morning-confirm verdicts persisted."

---

*Prepared read-only: no code, schema, or config was modified. All staging access used one temp
Cognito admin+premium user per pull, deleted in `finally`. Numbers not derivable from the committed
APIs are reproducible from the scratchpad scripts named in the header.*
