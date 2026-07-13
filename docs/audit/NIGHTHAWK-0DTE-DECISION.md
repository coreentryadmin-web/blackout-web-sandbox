# Night Hawk 0DTE — decision point (v2)

**Date:** 2026-07-13 · **Branch:** `fix/nighthawk-0dte-decision` (docs only)
**Builds on:** `docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md` (v1, architecture maps + 7/13 live audit, on `fix/nighthawk-0dte`)
**Evidence base:** per-play forensics pulled 2026-07-13 ~22:50 UTC from staging APIs + Polygon —
47 joined per-play rows (25 Slayer graded + 14 Night Hawk resolved + 8 provisional 0DTE Command from 7/13),
plus 0DTE Command's own 38-play 14-day calibration aggregates and 1,215 signal observations.
Raw payloads, joined dataset, cut tables, and reproducible scripts: session scratchpad `nh0dte/`
(`derived.json`, `SUMMARY.md`, `manifest.json`, `raw/*.json`, `pull.mjs`, `derive.mjs`).
Every cut with n<5 is flagged LOW-N there; nothing below leans on an unflagged small sample without saying so.

---

## 0. The question, answered honestly

**Directive:** "come to a decision point on how to make the 0DTE plays Night Hawk is printing 100% winners."

**100% winners is not an achievable or honest target, and this document will not pretend it is.**
A gate stack cannot turn a probabilistic tape into certainty; a system optimized for literal 100%
either stops printing entirely or corrupts its own grading to protect the streak. What the payoff
math actually requires is much less than 100%: with 0DTE Command's asymmetric plan
(−50% stop / +100% trim), **breakeven is a 33.3% win rate**. Every point of win rate above that is
edge. The realistic, evidence-backed objective is:

> **Precision-first printing: far fewer plays, each surviving a stack of hard blocks built from
> the factors that demonstrably separated winners from losers — targeting a 55–65% win rate on an
> asymmetric payoff, with the losses capped and every play graded in public.**

On 7/13's ledger, the blocks specified below would have kept 1 winner and removed 5 of the 7 losers
before entry. That is what "make the plays real winners" means in practice: stop printing the losers
we can already see coming.

**Directive:** "do we strengthen the playbooks to 0DTE also? Or is 0DTE logic much advanced and better?"

Neither, precisely:

- **0DTE Command's logic is NOT more advanced.** It is an excellent *flow detector* (fill-anchored
  contract plans, chase guard, rejection log, breadth) with **no market-state discipline**: on 7/13
  it scanned 8, committed 8, rejected 0, on a down day, and went 1W/7L. Its own 14-day calibration
  says its 55–64 score band runs **18.8% WR (n=16)** — below the 33% breakeven line.
- **The playbook layer (PB-01..14) is architecturally more advanced but statistically EMPTY.**
  Promotion report: 49 out-of-sample instance rows, **0 closed trades**, 1 unique session; every
  win-rate/expectancy field null; PB-06 triggered 9 times and was blocked 9 times. Porting an
  unproven layer to a second surface would replicate machinery, not edge.
- **What is actually proven is Slayer's GATE + GOVERNOR + EXIT discipline** — the 20+ fail-closed
  entry gates, the trade governor (entry/loss caps, cooldowns, re-entry locks), and the exit engine
  (VIX-indexed targets, trailing, force-exit). That stack converts a ~42% raw-signal environment
  (1,130 graded observations) into a 48% closed ledger with capped losses. **That discipline — not
  the playbook FSM — is the thing to extend to the 0DTE breadth surface.**

**Decision in one line:** unify the member surface as **Night Hawk 0DTE** (one pane, one honest
ledger) fed by two engines — Slayer for SPX, a **gate-hardened 0DTE Command** for breadth — extend
Slayer's *discipline* (blocks, governor, exits, accountability) to 0DTE Command now, and revisit
porting the playbook FSM only after it has closed-trade evidence on its home surface (≥30 sessions).
This confirms v1's Phase 1–4 migration plan and sharpens Phase 2 into the concrete gate spec below.

---

## 1. What the per-play data says (the factor forensics)

The five findings that drive the gate spec, strongest first:

**F-1 · VIX regime is the strongest per-play split in the whole dataset.**
Slayer plays on days opening with VIX 15–17: **69.2% WR (9W/4L, n=13, avg +1.85 pts)**.
VIX 17–20: **25.0% WR (3W/9L, n=12, avg −1.54 pts)**. Same engine, same fortnight, opposite outcomes.
(Derived from day-open I:VIX — **no surface persists VIX-at-entry today**, which is itself a finding; see §3.)

**F-2 · 0DTE Command's 55–64 score band is where the money dies.**
From the engine's own 14-day calibration (38 graded plays): score 55–64 → **18.8% WR, avg −24.5% premium
(n=16)**; 65–74 → 50% WR, +21.1% (n=10); 75+ → 50% WR, +9.9% (n=12). The system already *knows* its
own floor is too low. Spike setups beat non-spike 42.1% vs 31.6% (n=19 each).

**F-3 · Nobody has red-day evidence except the surface that just bled on one.**
All 25 Slayer plays are LONG and all 6 of its traded sessions were SPX up-days — its alignment cuts
are degenerate by construction, and there is zero short-side or down-day track record. 7/13 (SPX −0.43%)
on the 0DTE surface: **longs 0/5, avg −54.7%; shorts 1W/2L, −7.9%** (provisional grades). Counter-tape
entries are the single most visible killer in the dataset.

**F-4 · The first ~hour is the weakest window on every surface that has data.**
0DTE Command 9:50–11:00: 36.8% WR (n=19, its own calibration). Signal observations: hour-9 36.1%
(n=147) vs hour-14 60.5% (n=126). Slayer's best populated bucket is 11:30–14:00 at 53.8% (n=13).
Four of 7/13's five opening-window entries died at the stop.

**F-5 · The top conviction band is mis-calibrated on all three surfaces, independently.**
Slayer score 85+ → 33.3% (n=6) vs 75–84 → 63.6% (n=11); grade A+ → 25% (n=4, LOW-N) vs A → 54.5% (n=11).
NH edition conviction A+ → 0/1 vs A → 3W/0L (n=4, LOW-N) vs B → 42.9% (n=8). Observations score 70+ →
45.1% (n=125) vs 60–70 → 60.8% (n=57). Each cut alone is LOW-N; the same inversion appearing three
times independently is a pattern: **the scorers over-reward crowded/late/obvious setups at the top of
their range.** Until recalibrated, "A+" must not mean "bet bigger."

**F-6 (damning) · Aggregate economics are thinner than the win rates suggest.**
Slayer's expectancy is **+0.22 pts/play** across 25 plays — statistically indistinguishable from zero;
its four STOP exits averaged −8.24 pts. NH edition's 42.9% "win rate" *understates* its economics
(profitable rate 58.3%, PF 4.2 on stock-move math) because 3 of 14 outcome tags contradict the
close-based return (intraday touch grading). And the platform's most active 0DTE surface exposes **no
multi-day per-play history through any API** — its record is invisible to members and to us.

---

## 2. The gate spec (Phase-2 of the v1 plan, made concrete)

Applied to **0DTE Command** as hard, fail-closed entry blocks (each block persisted to
`zerodte_scan_rejections` and shown as a SKIP card — visible discipline, not silent silence).
Slayer already has equivalents; it is untouched except where marked.

| # | Gate | Rule (initial value) | Evidence | Effect on 7/13 ledger |
|---|---|---|---|---|
| G-1 | **Tape alignment block** | play direction vs SPY/desk session bias conflict → BLOCK (was a −6 score dent) | F-3; v1 §2.2 | removes SPY/SPXW/MU/AMD/NVDA longs — 5 losers |
| G-2 | **Opening-window block** | no entries before 10:30 ET (Slayer-style; its own no-BUY-before-9:50 is looser because its regime gates carry the rest) | F-4 | removes 4 of the 5 (overlaps G-1) |
| G-3 | **Score floor 65** | commit only ≥65 (55–64 band = 18.8% WR, below breakeven) | F-2 | conviction-C rows re-scored; floor kills the weak tail |
| G-4 | **VIX regime throttle** | day-open VIX ≥17: require BOTH G-1 alignment AND score ≥75; VIX ≥20: index/ETF setups only, half plan size | F-1 (LOW-N — run as calibration for 30 sessions, then harden or drop) | 7/13 VIX open 17.2 → all counter-tape longs double-blocked |
| G-5 | **Session governor** | max 3 concurrent open plans; max 3 stopped plans/session then halt for the day; 20-min same-direction re-entry lock after a stop | Slayer governor, proven; 7/13 had 7 stops with no ceiling | halts the session after the third opening-window stop |
| G-6 | **Cross-system conflict gate** | 0DTE flag opposing the live Slayer play or today's NH edition direction on the same/index-correlated ticker → CONFLICT state, requires score ≥80 to print | v1 §2.2 (META short vs NH META long A) | META short becomes CONFLICT |
| G-7 | **Macro hard-block windows** | adopt Slayer's CPI/FOMC/NFP ±windows verbatim (shared module, not a copy) | Slayer gate list | none on 7/13 |

Projected 7/13 replay under G-1..G-7: **prints QQQ short (+76.6%) and at most INTC short (−50%) /
META-as-CONFLICT — 1W/1-2L instead of 1W/7L.** Volume drops sharply on trend days. That is the point,
and expectations must be set with the user: **precision mode prints less.**

**Calibration fixes (all surfaces):**
- C-1: stop displaying A+/85+ as the top tier until the inversion (F-5) is understood — cap display
  conviction at A while investigating whether top scores select crowded/late entries.
- C-2: **persist regime-at-entry, VIX-at-entry, score, and playbook/gate verdicts on every outcome row**
  (all four surfaces). The single biggest obstacle to this analysis was that none of these exist per-play;
  every future calibration depends on them.
- C-3: NH edition grading already has v1's P-1 (band-not-midpoint geometry + R:R floor) queued — that
  removes the unearnable-edge class (~29% of its resolved sample) at the source.

---

## 3. Build sequence

**Now (this week, small PRs in order):**
1. G-1, G-2, G-3, G-5 on 0DTE Command (one PR each or G-1+G-2 together; each with tests + SKIP-card UI).
2. C-2 outcome-row context columns + write-path (cheap now, priceless in 30 sessions).
3. v1's P-3: multi-day per-play 0DTE endpoint + aggregate track record surface (the record exists,
   ungraded rows from the index-root bug backfilled per P-6).
4. v1's P-1 geometry gate + P-4 index dossier + P-5 retire the ungraded Day-Trade lane.

**Next (after the above settles):** G-4 VIX throttle and G-6 conflict gate as *calibration mode*
(log the verdict, don't block) for 30 sessions → harden whichever earns it with data.

**Then (≥30 sessions of gated data):** revisit the playbook question with closed-trade evidence on
both surfaces; decide whether 0DTE Command earns the FSM/promotion machinery; decide whether NH
editions stop publishing 0–1 DTE contracts entirely (the data already suggests overnight/swing is
the edition's real identity).

**Explicitly NOT doing:** porting PB-01..14 to 0DTE Command today (zero closed evidence — F-6);
blending the three ledgers into one marketing win rate (methodologies stay separately labeled);
promising or engineering toward "100% winners" (§0).

---

## 4. Standing verification

- Every gate PR ships with unit tests on the block logic + a replay assertion against the 7/13
  fixture ledger (the projected-outcome table in §2 becomes a regression test).
- The morning-gate checklist gains: "0DTE Command SKIP cards visible and populated; governor state
  correct after simulated 3-stop session; outcome rows carry regime/VIX/score context."
- Re-run the factor forensics (`nh0dte/pull.mjs` + `derive.mjs`) after 10 gated sessions and diff
  the cut tables against `derived.json` — the gates must move the 55–64/opening-window/counter-tape
  buckets or be revisited.
