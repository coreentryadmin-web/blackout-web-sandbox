# SPX Slayer — Playbook Full Specification v2

**Scope:** complete rules for every playbook (registry PB-01…PB-14), all safety
gates, regime routing, state machine, primary selection, per-playbook confluence
checklists, sizing, telemetry, and evidence-gated rollout.
**Data contract:** every rule below maps to a field that EXISTS today on
`SpxDeskPayload` (`spx-desk.ts`) or `PlayTechnicals` (`spx-play-technicals.ts`).
Rules that need a field we don't have are marked **[NEEDS-FIELD]** and are not
implementable until that field ships.
**Evidence:** calibrations marked **[EV]** come from
`docs/spx/PLAYBOOK-EVIDENCE-BASE.md` (19 prod outcomes, small sample).

---

## 0. Coverage analysis — is 12 (now 14) enough?

Coverage by **session phase**:

| Phase (ET) | Playbooks |
|------------|-----------|
| 09:30–09:45 open | PB-13 gap fade (pre-OR), PB-03 forming |
| 09:35–10:30 opening drive | PB-03 ORB, PB-14 failed-break reversal |
| 09:45–14:00 morning trend | PB-01, PB-02, PB-05, PB-06, PB-10 |
| 11:00–14:00 midday chop/pin | PB-04, PB-11 |
| 14:00–15:45 expiry gravity | PB-07 |
| 15:00–15:55 power hour | PB-08 |
| Any RTH | PB-06, PB-09, PB-12 |

Coverage by **market regime**:

| Regime | Playbooks |
|--------|-----------|
| Trend (bull/bear) | PB-01, PB-05, PB-06, PB-10 |
| Weak/distribution | PB-02 |
| Chop / range | PB-11, PB-04 |
| Gamma pin (mean_revert) | PB-04, PB-07 |
| Vol expansion (amplification) | PB-03, PB-05, PB-12 |
| Event/flow-driven | PB-09, PB-08 |
| Gap open | PB-13 |

**Gaps found in the original 12 → two additions:**

- **PB-13 Gap Fade / Gap-and-Go** — the original catalog had NO open-gap
  playbook. Gap handling was only a `gap_pct` info field. 0DTE gap fill /
  gap continuation is a distinct, high-frequency setup with its own
  invalidation (fade fails when the gap is a breakaway).
- **PB-14 Failed Breakout Reversal** — ORB fail (break of OR high that
  re-enters and breaks the other side) is one of the most reliable 0DTE
  reversals and is NOT the same as PB-03's invalidation — it's the mirror
  trade. Original catalog had no failed-break pattern.

**Deliberately NOT added** (cases considered and rejected):

- Halt-reopen momentum — halts are a hard gate (`shouldBlockForTradingHalt`);
  trading the reopen is a risk policy change, not a playbook.
- Macro-release momentum (post-CPI/FOMC drive) — macro windows are hard-blocked
  by `macroHardBlock()`; the post-event trend after the window reopens is
  already caught by PB-05/PB-06/PB-08 shapes.
- Overnight/AH plays — engine is RTH-only by design (session guards).
- VIX term inversion crash hedge — portfolio posture, not a 0DTE scalp.

**Why more playbooks would be wrong:** with ~5–8 plays/week, 14 playbooks need
months to accumulate `MIN_EVIDENCE=10` outcomes *each*. Breadth without
evidence = untested rules gating real money. The registry caps at 14; any new
pattern must replace or merge an existing one.

---

## 1. Global safety gates (Layer A — ALL must pass for BUY)

As-built in `spx-play-gates.ts::evaluatePlayGates` (BUY intent). These are
AND-ed; any block kills BUY (WATCH tolerates soft blocks).

| # | Gate | Rule (exact) | Source field |
|---|------|--------------|--------------|
| A1 | Session open | `desk.market_open` | desk |
| A2 | Trading halt | `shouldBlockForTradingHalt` — confirmed live halt blocks; stale channel = fail-open + warning | UW WS + `halt_channel_stale` |
| A3 | Dealer map | `gex_walls.length > 0` | desk |
| A4 | Data freshness | `max(desk age, gex_age_ms) <= SPX_PLAY_GEX_STALE_MAX_SEC (90s)` | desk |
| A5 | Mixed tape | `weighted_conflicts < mixedTapeBlockThreshold(grade)` (A gets +1 headroom) | confluence |
| A6 | Grade floor | `gradeRank >= B` | confluence |
| A7 | Macro window | no CPI/FOMC/NFP/PPI/GDP inside `[t−5, t+60]` | `macro_events` |
| A8 | Cash open | no BUY before 09:30 ET | clock |
| A9 | No-entry cutoff | no BUY after cutoff (`spx-play-session-guards`) | clock |
| A10 | Pre-7:00 ET | hard block | clock |
| A11 | Opening range | no BUY until 09:30 + `SPX_PLAY_OPENING_RANGE_MINUTES` (20) → 09:50 | clock |
| A12 | Score floor | `|score| >= SPX_PLAY_WATCH_MIN_SCORE (38)` | confluence |
| A13 | Buy cooldown | 600s after any exit (A+ bypasses with warning) | session meta |
| A14 | Stop cooldown | 15 min after a STOP exit | session meta |
| A15 | Re-entry lock | same-direction 1200s after a loss | session meta |
| A16 | R:R floor | `playMinRiskReward` vs stop/target distances | confluence levels |
| A17 | **Playbook trigger** | `primary_playbook_id != null` — **only when `PLAYBOOK_LIVE_GATE=1`** | matcher |

**Policy decisions encoded:**
- Halt feed **stale** = fail-open (warn); halt **confirmed** = fail-closed. Per
  PB-03/PB-13 strict clause, breakout playbooks self-suppress on degraded feed
  even though the global gate fails open.
- Gates never pick direction; they only veto.

---

## 2. Regime Router (Layer B)

As-built `playbook-regime-router.ts`. Buckets from `desk.regime`
(EMA20/50 inference) + opening-drive clock override:

| Bucket | Source |
|--------|--------|
| `opening_drive` | 09:30–10:30 ET clock (overrides all) |
| `trend_bull` | `regime="bullish"` |
| `trend_bear` | `regime="bearish"` |
| `recovery` | `regime="recovering"` |
| `weak` | `regime="weak"` |
| `neutral` | `regime="neutral"/"chop"` |
| `unknown` | missing — **fail-open** (all playbooks stay eligible) |

Eligibility matrix (× = eligible):

| PB | opening_drive | trend_bull | trend_bear | recovery | weak | neutral | unknown |
|----|---------------|------------|------------|----------|------|---------|---------|
| 01 VWAP Reclaim | × | × | | × | | × | × |
| 02 VWAP Reject | | | × | | × | × | × |
| 03 ORB | × | × | × | × | × | × | × |
| 04 Pin Fade | | × | × | × | × | × | × |
| 05 Wall Break | | × | × | × | × | | × |
| 06 Flip Ride | × | × | × | × | × | | × |
| 07 Max Pain | | × | × | × | × | × | × |
| 08 Power Hour | | × | × | × | × | × | × |
| 09 HELIX Surge | × | × | × | × | × | × | × |
| 10 EMA Pullback | | × | × | | | | × |
| 11 Range Scalp | | | | | | × | × |
| 12 Lotto Reversal | × | × | × | × | × | × | × |
| 13 Gap Fade | × | | | | | | × |
| 14 Failed Break | × | × | × | × | × | × | × |

*(Rows 05–07, 09–14: MVP matchers on staging — FULL-SPEC §3 `*spec*` = simplified pre, not absent code.)*

The gamma-specific pin check (PB-04/07) lives in the **matcher** via
`gamma_regime`, not the router — the router's EMA regime and the dealer gamma
regime are independent axes.

---

## 3. The 14 playbooks — full rules

Format per playbook: **Preconditions** (arm) → **Trigger** (fire) →
**Invalidation** (disarm/exit) → **Target/Stop** → **Window** → direction rule.
`prox` = `playStructureProximityPts()` (10), `buf` = `playMtfBufferPts()` (1.0).

### PB-01 VWAP Reclaim — *implemented*
- **Pre:** `minutes_below_vwap >= 15` (or `above_vwap=false`) AND
  `ema9_curling_toward_vwap != false`. Mirror for short.
- **Trigger:** `m3_consecutive_closes_above_vwap >= 2` OR `breakout.vwap_reclaim`,
  AND `flow_0dte_net` not bearish. Mirror short: closes below / `vwap_lost`, flow not bullish.
- **Invalidation:** close back through VWAP against the reclaim; regime flips chop.
- **Target/Stop:** nearest opposing wall (`gex_walls`) / below reclaim bar low.
- **Window:** 09:45–14:00 **[EV: 13:00–14:00 was worst band; window may tighten to 13:00 after more data]**

### PB-02 VWAP Reject — *implemented*
- **Pre:** rally into VWAP from below: `above_vwap=false` AND `0 <= vwap−price <= prox`
  AND (`minutes_above_vwap >= 2` OR near-band).
- **Trigger:** (`breakout.vwap_lost` OR `m3_consecutive_closes_below_vwap >= 1`)
  AND `flow_0dte_net < 0` AND near-band.
- **Invalidation:** acceptance above VWAP (2 m3 closes above + buf).
- **Target/Stop:** put wall / session low; stop above VWAP band (+prox).
- **Window:** 10:00–15:00.

### PB-03 Opening Range Breakout — *implemented*
- **Pre:** `or_defined` (09:30 + 20m from bars) AND `gamma_regime != "mean_revert"`.
- **Trigger:** `price > or_high + buf` (long, requires `above_gamma_flip=true`,
  flow not bearish) or `price < or_low − buf` (short, mirror). Feed degraded
  (`feed_stalled | halt_channel_stale | active_halts`) suppresses.
- **Invalidation:** re-entry inside OR.
- **Target/Stop:** 1× OR width extension; wall beyond / OR mid.
- **Window (registry):** 09:35–10:30 ET matcher eligibility.
- **Effective BUY window:** ~09:50–10:30 ET (OR 20m + gate A11).

### PB-04 Gamma Pin Fade — *implemented* **[EV]**
- **Pre:** `gamma_regime="mean_revert"` AND spot between a resistance wall above
  and support wall below (`gex_walls.kind`).
- **Trigger:** wall touch within `prox` + no live HOD/LOD breakout + flow not
  against the fade. Direction = away from touched wall.
- **Invalidation:** sustained breakout through wall (`hod_break | lod_break`).
- **Target/Stop:** opposite wall or `max_pain`; stop just beyond touched wall (+3 pts).
- **Window:** 11:30–15:00.

### PB-05 Wall Break Continuation — *spec*
- **Pre:** price compressed under a call wall (or over a put wall):
  `|price − wall.strike| <= prox` for ≥ 5 consecutive m1 bars **[NEEDS-FIELD:
  bar-window wall proximity streak — add to PlaybookBarMetrics]**; VEX magnitude
  rising (`greek_exposure` VEX total vs 15m ago **[NEEDS-FIELD: greek deltas]**).
- **Trigger:** m3 close through wall by > buf AND `flow_0dte_net` same direction
  AND `net_prem_ticks` accelerating same side.
- **Invalidation:** reclaim inside wall within 5m (m3 close back).
- **Target/Stop:** next wall in `gex_walls` ladder; stop = broken wall −3 pts.
- **Window:** 10:00–15:30.
- **MVP fallback (implementable now):** drop the two NEEDS-FIELD preconditions;
  arm on simple wall proximity, trigger unchanged. Lower fidelity, honest detail string.

### PB-06 Flip Level Ride — *spec*
- **Pre:** `gamma_flip != null` AND `|price − gamma_flip| <= prox` AND router
  bucket is a trend bucket.
- **Trigger:** m3 close through flip by > buf with `m1_ema9` on the break side
  and `m5_trend` agreeing. Direction = break side (`above_gamma_flip` flips).
- **Invalidation:** recross flip and hold 3m (1 m3 close back).
- **Target/Stop:** next wall / flip ± OR width; stop = flip ∓ 3 pts.
- **Window:** all RTH (09:50 gate A11 still applies).

### PB-07 Max Pain Gravitation — *spec*
- **Pre:** `max_pain != null` AND `|price − max_pain| / price > 0.3%` AND
  ET ≥ 14:00 AND `gamma_regime="mean_revert"` (charm proxy — real charm needs
  **[NEEDS-FIELD: charm total on desk]**; heatmap CHARM lens exists server-side).
- **Trigger:** momentum stall toward pain: `m5_trend="flat"` AND
  `flow_0dte_net` sign points toward pain.
- **Invalidation:** strong flow trend away from pain (`|flow_0dte_net|` spike against).
- **Target/Stop:** `max_pain` strike; stop 0.15% beyond entry extreme.
- **Window:** 14:00–15:45. Direction = toward max pain.

### PB-08 Power Hour Momentum — *implemented* **[EV]**
- **Pre:** dominant one-sided flow: `flow_0dte_net` sign + same-side VWAP streak
  ≥ 10m (`minutes_above/below_vwap`).
- **Trigger:** `hod_break` (long, bullish dominant) / `lod_break` (short, bearish dominant).
- **Invalidation:** flow flip + VWAP cross against.
- **Target/Stop:** session extreme extension / wall; stop = micro-range mid.
- **Window:** 15:00–15:55.

### PB-09 HELIX Flow Surge — *spec*
- **Pre:** HELIX-tier SPX/SPXW print in `spx_flows`: `premium >= 1M` AND
  `has_sweep=true` within last 2 play polls (~6s… use `alerted_at` ≤ 120s).
- **Trigger:** desk direction (`flow_0dte_net` sign) matches surge side within
  2 polls AND `|price − strike| <= 15` (strike cluster proximity from print).
- **Invalidation:** no follow-through next poll; opposite surge ≥ same premium.
- **Target/Stop:** wall in surge direction; stop 5 pts against.
- **Window:** all RTH.

### PB-10 EMA Stack Pullback — *spec*
- **Pre:** stack aligned: `m1_ema9 > ema20 > sma50` (bull, from desk EMAs) or
  inverse; pullback: `|price − m1_ema9| <= 3` after ≥ 10m above stack
  (`minutes_above_vwap` proxy).
- **Trigger:** bounce bar: m3 close back in trend direction + `flow_0dte_net` agrees.
- **Invalidation:** m3 close through `ema20` against trend.
- **Target/Stop:** prior swing (HOD/LOD) / wall; stop below bounce bar.
- **Window:** 10:00–15:00.

### PB-11 Range Chop Scalp — *spec*
- **Pre:** router bucket `neutral` AND defined 30m range: `hod − lod <= 0.35%` of
  price after 11:00 AND no breakout flags.
- **Trigger:** touch of range edge (`|price − hod| <= 3` or `|price − lod| <= 3`)
  + rejection m3 close back inside. Direction = fade toward mid.
- **Invalidation:** range break (`hod_break | lod_break`).
- **Target/Stop:** range mid / opposite edge; stop 3 pts beyond edge.
- **Window:** 11:00–14:00. Reduced size (see §6).

### PB-12 Lotto Reversal — *spec*
- **Pre:** rapid extension: `|spx_change_pct|` move > 0.5% in 15m **[NEEDS-FIELD:
  15m rolling change — derivable from m1 bars, add to PlaybookBarMetrics]**;
  `m5_rsi >= 72` or `<= 28`; near wall (`prox`).
- **Trigger:** reversal m3 bar + flow exhaustion (`net_prem_ticks` decelerating).
- **Invalidation:** continuation to new extreme with fresh flow.
- **Target/Stop:** VWAP or range mid; tight stop 4 pts.
- **Window:** all RTH; **half size always** (§6).

### PB-13 Gap Fade / Gap-and-Go — *spec, new*
- **Pre:** `|gap_pct| >= 0.3%` at open (`gap_pct`, `gap_source`).
- **Trigger (fade):** first 15m fails to extend gap (no `hod_break` beyond open
  print for gap-up) AND m3 close back toward `prior_close` → direction = gap fill.
- **Trigger (go):** gap extends with `or_high` break + flow aligned → PB-03 takes
  precedence (§5) — PB-13 only fires the fade side.
- **Invalidation:** new session extreme beyond the open drive.
- **Target/Stop:** `prior_close` (full fill) or half-gap; stop above open-drive extreme.
- **Window:** 09:35–10:30.

### PB-14 Failed Breakout Reversal — *spec, new*
- **Pre:** PB-03-style OR break occurred (either side) within last 30m
  **[NEEDS-FIELD: recent-break memory — derivable: `or_defined` + price re-entry]**.
- **Trigger:** price re-enters OR AND crosses OR mid AND flow flips to the
  reversal side. Direction = opposite the failed break.
- **Invalidation:** price re-exits OR on the original break side.
- **Target/Stop:** opposite OR extreme, then 0.5× OR width beyond; stop = OR mid.
- **Window:** 09:50–11:30.

---

## 4. Playbook state machine (Layer D — to build)

States per playbook instance (`playbook-state.ts`, next build item):

```
IDLE → ARMED:      regime_eligible AND session_window_open AND precondition_match
ARMED → IDLE:      invalidation OR window close OR regime flip (log disarm reason)
ARMED → TRIGGERED: trigger_fired
TRIGGERED → OPEN:  safety gates (A1–A17) all pass, openPlay() commits
TRIGGERED → ARMED: soft gate block (cooldown/score) — re-arm, don't discard
TRIGGERED → IDLE:  invalidation before gates clear
OPEN → MANAGING:   trim/trail rules engage (existing engine logic)
MANAGING → CLOSED: STOP | TARGET | THESIS | SESSION | THETA | TRAIL
CLOSED:            outcome row with playbook_id (shipped) + state history [NEEDS-FIELD]
```

Persistence: `spx_playbook_states` table (per session_date × playbook_id ×
instance_seq). Until built, ARMED≈`precondition_match`, TRIGGERED≈`trigger_fired`
recomputed per tick (stateless approximation — acceptable in shadow).

---

## 5. Primary selection & conflict resolution

1. Compute verdicts for all eligible playbooks.
2. Drop verdicts where `!regime_eligible || !session_window_open`.
3. If >1 `trigger_fired`, pick by **explicit priority** (replaces registry order
   once state machine ships): specificity first —
   `PB-09 > PB-13 > PB-14 > PB-03 > PB-05 > PB-06 > PB-04 > PB-07 > PB-08 > PB-01 > PB-02 > PB-10 > PB-11 > PB-12`.
   Rationale: event-driven and structure-specific setups outrank generic
   VWAP/EMA patterns; lotto is always last.
4. Known conflicts:
   - **PB-05 wall break vs PB-04 pin fade** — same wall, opposite trades. PB-04
     requires `gamma_regime=mean_revert` AND no breakout flags; PB-05 requires a
     confirmed m3 close through. Mutually exclusive by construction; if both
     somehow fire, priority gives PB-05 (a confirmed break beats a fade thesis).
   - **PB-03 vs PB-13** — gap-and-go = PB-03 (priority); PB-13 only fades.
   - **PB-01 long vs PB-02 short same tick** — regime router already separates
     (trend_bull excludes PB-02; weak excludes PB-01); in `neutral`/`unknown`
     both possible → priority picks PB-01 only if directions conflict on the
     same tick; log both verdicts regardless.
5. One PRIMARY at a time. Secondary triggered playbooks are logged
   (`primary=false`) for telemetry ranking.

---

## 6. Per-playbook confluence checklist & sizing (Layer E — target)

When a playbook is ARMED, the confluence panel becomes ITS checklist (not the
global soup). Checklist = that playbook's remaining preconditions + trigger
components + 3 universal items:

1. Data fresh (A4 green)
2. Flow agrees (`flow_0dte_net` sign vs direction)
3. No macro window within 30m (A7 lookahead)

Sizing ladder (uses existing `entry_mode` full/starter):

| Condition | Size |
|-----------|------|
| Checklist 100% + grade ≥ A | full |
| Checklist ≥ 80% + grade ≥ B | starter |
| PB-11, PB-12 always | starter cap |
| `PLAYBOOK_LIVE_GATE=0` (shadow) | n/a — no gating |

**[EV]** Grade alone must never size up: A+ won 1/4 in the track record.

---

## 7. Telemetry & evidence gating

- Every tick: `logPlaybookShadowMatch` → one row per registry playbook
  (`playbook_pb_XX_match`, direction, detail, primary flag). *Shipped.*
- Every open: `playbook_id` on `spx_open_play` + `spx_play_outcomes`. *Shipped.*
- Promotion rule: a playbook may enter **limited-live** only per progressive tiers in
  `PLAYBOOK-EXTERNAL-REVIEW-2026-07-10.md` (replaces the deprecated n=10 / WR≥45% rule).
  Until then: shadow + staging lab research only; initial allowlist PB-01/02/03/04/14 (+ PB-08 when qualified).
- Weekly re-run of `PLAYBOOK-EVIDENCE-BASE.md` SQL after each RTH week.

---

## 8. Rollout status

| Phase | Content | Status |
|-------|---------|--------|
| 1 | Shadow matcher PB-01…14 (MVP for 05–07, 09–14) | live (staging) |
| 2 | ARM UI + fidelity + regime router | live (staging) |
| 2b | Full-fidelity matchers PB-04/08 | live (staging) |
| 3 | Playbook live gate on staging | **always on** (`isStagingDeploy()`); prod needs `PLAYBOOK_LIVE_GATE=1` |
| 4 | `playbook_id` telemetry | shipped |
| 5 | State machine (`playbook-state.ts`) | next |
| 6 | Playbook checklist replaces global soup in UI | after state machine |
| 7 | Watch key = PB instance | open |
| 8 | Evidence-gated limited-live per playbook | Progressive tiers (see EXTERNAL-REVIEW) |

**Deprecated:** n=10 / WR≥45% promotion — too weak for 0DTE (external review 2026-07-10).
