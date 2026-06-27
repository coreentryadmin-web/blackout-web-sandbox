# Night Hawk — Deep End-to-End Audit

- **Last audit:** 2026-06-27 ~18:05 ET (Sat, automated)
- **Last edition date:** 2026-06-29 (Mon) — next trading day
- **Auditor:** autonomous scheduled task `audit-night-hawk`

## Overall Health: WARN

A valid, high-quality, Claude-generated, critic-vetted edition **is currently published and
serving** for Mon 2026-06-29 — a genuine recovery from the #77 synthesis bug. But the rating is
**WARN, not PASS**, for three reasons:

1. The editions table holds **exactly one row.** Night Hawk published **no edition for the prior
   four trading days** (Tue 6/23 → Fri 6/26): 22 failed cron runs over 6/24–6/25 with
   `"Claude returned no parseable plays."` This was a live P0 for most of the week and is only
   just resolved.
2. The one edition that exists was **built off-window at ~04:05 ET Friday on Thursday's session
   data**, not during the Friday-evening window on Friday's close. The Friday-evening cron fired
   correctly but no-op'd (idempotency, no `force`), so the canonical Monday edition never picked up
   Friday's data.
3. The recovery is **one-edition deep and circumstantial** — not yet proven across a clean
   evening-cron cycle.

It is **not FAIL** because the served edition is real and well-grounded, the cron is now firing on
schedule, and the failures stopped after 6/25. **Mitigating context:** the tool is launch-gated
(`LAUNCHED_TOOLS` unset → "Coming Soon"), so the empty-week was visible only to admins, not paying
users.

## Last Edition Status (2026-06-29)
- **Generated:** yes — `status=published`, `current_stage=published`, no error.
- **Plays count:** 5 (full playbook, `recap_only=false`, `claude=true`).
- **All plays valid:** yes (see table).
- **Edition age at audit:** built `2026-06-26T08:05:28Z` (~04:05 ET Fri) → ~38h old at audit; for a
  Mon edition it is grounded in **Thursday 6/25's** session.
- **Build duration:** job `started 07:04:27Z → published 08:05:28Z` ≈ **61 min** (Claude synthesis +
  40-candidate dossier fan-out).
- **Candidates:** 40 · **Flow alerts:** 30 · **SPX (recap):** 7357.49.

## Play Quality Verification
| Check | Result | Notes |
|---|---|---|
| Tickers are real | ✅ PASS | AMAT, OKTA, HIMS, MRK, AAPL |
| Strikes are real numbers | ✅ PASS | 620, 120, 33, 125, 270 — no 0/9999 placeholders |
| Expiries are future dates | ✅ PASS | 2026-07-17, -07-17, -08-21, -07-17, -07-02 (all future) |
| Thesis references real data | ✅ PASS | flow $, UW fill counts (65/155/35/75), GEX walls, sector %, analyst PTs |
| Direction is clear | ✅ PASS | LONG×4, SHORT×1 (AAPL) |
| GEX levels grounded | ✅ PASS | call/put walls + GEX king/flip cited per play |
| Flow data included | ✅ PASS | per-play flow stacks w/ strike, expiry, $ and fill counts |
| Premium within affordability cap | ✅ PASS | entry prem 4.50/3.50/1.85/1.20/3.20 → ≤ $450/contract |
| IV ranks are real (non-round) | ✅ PASS | 100 / 52.24 / 64.42 / 38.71 / 66.35 — precise, not fabricated |

**Critic is doing real adversarial work** (this is the strongest signal of grounding). It
**downgraded** #1 AMAT (thesis contradicted by $2.86M in put stacks @605/@500; IV-rank-100 = expensive,
not bullish; ~1:1 R/R), #2 OKTA (1-day streak, net 3/5d flow only ~$59K), and #3 HIMS (technical 11/28,
put wall @32 is *resistance* not support, negative Polygon sentiment) — and **kept** #4 MRK (A, hard
FDA/M&A catalysts, 155 UW fills) and #5 AAPL (B short, confirmed put walls @280/277.50). Published
convictions (B/B/B/A/B) reflect those verdicts.

## Data Grounding
What live data feeds generation (verified from `market_recap` + `meta`):
- **GEX data:** present — per-play call/put walls, GEX king/flip, gamma regime; recap `spx_desk` populated.
- **Flow alerts:** 30 in recap; per-play flow stacks with strikes/expiries/$/fill-counts.
- **SPX close:** `SPX 7357.49 (-0.01%) · H 7419 L 7324 · VIX 17.28 (+3.0%)` — real, not hardcoded.
  (This is **Thursday 6/25's** close, since the edition built 4am Fri — see WARN #2.)
- **Tide:** `BEARISH — calls 17% ($40.1M) vs puts $192.4M` · hot_chains: 10 · index_dossiers: 6.
- **UW scanner:** used (candidate extraction + dossier flows; 40 candidates).
- **Anthropic:** `ANTHROPIC_API_KEY` configured; `claude=true`; synthesis temp 0, 90s timeout,
  maxRetries 1 (the #77 fix in `claude-edition.ts`).
- ⚠️ **Grounding counts not persisted:** `meta.grounded / dropped_ungrounded / flagged` are **null**
  on the row — these counts are emitted only to the funnel log, never written to edition meta. The
  grounding pipeline (`grounding.ts`) DID run, but its summary isn't observable from the DB. Minor
  observability gap (see Recommendations).

## Cron Health
- **Playbook schedule:** `*/15 21-23 * * 1-5` UTC = every 15 min, 17:00–19:00 ET Mon-Fri.
- **Fri 6/26 evening run:** ✅ fired correctly — skipped 17:00/17:16 (pre-17:30 target), `ok`
  (build dispatched, 202 fire-and-forget) at 17:30–19:16 ET, skipped 19:31/19:45 (past
  target+120m catchup). Window logic + #77 fire-and-forget pattern working (21–30 ms dispatches).
- **BUT it no-op'd:** edition 6/29 was already `published` from the 04:05 ET build, so the evening
  re-fires returned `resumed:true` without rebuilding (no `force`). → the edition never got Friday's
  data.
- **22 FAILED runs** 6/24–6/25 evenings: `"Claude returned no parseable plays"`, durations 87–119 s
  (= 90s timeout + retry). The synthesis zeroing persisted on 6/24–6/25 even after the 90s timeout
  landed; it cleared by the 6/26 04:05 build. Net: **3 consecutive evenings produced no edition.**
- **Outcomes cron:** ✅ healthy — `nighthawk-outcomes` fired dual-band (20:32 + 21:33 UTC), `status=ok`.
- **Stuck job:** `edition_for=2026-06-26` is `status=running / stage_synthesis`, untouched since
  6/25 04:00 → 6/26 00:45. Orphaned; never published, never reaped (no watchdog). Doesn't serve
  (6/29 is latest) but is stale state.

## Outcomes Recording
- **Yesterday's outcomes recorded:** N/A — the only edition (6/29) is for a **future** Monday; its 5
  plays are `pending`. Prior editions never published rows, so there is nothing to resolve.
- **Win rate this week:** 0/0 (no resolved plays). Outcome machinery is healthy but **unexercised** —
  it has never resolved a real Night Hawk play because no edition survived to its next session until now.
- `syncNighthawkPlayOutcomes` correctly seeded 5 `pending` rows for 6/29.

## Serving
- `/api/market/nighthawk/edition` → **401** (auth + launch gated) — route is live and enforcing.
- Homepage → **200**. Serving logic (code-reviewed) is sound: no-store/CDN headers, recap-only
  `available` gate, stale-fallback flagging, legacy-engine fallback. The 6/29 row computes
  `available:true` with 5 plays.

## Known Issues
- **Task #77 (cron failed / empty editions):** the synthesis-zeroing root cause is **resolved** (90s
  timeout + fire-and-forget + recap-only fallback all present and the 6/29 build succeeded Claude-true).
  But the **empty-edition consequence recurred through 6/26** and the recovery is one-deep — keep #77
  open until ≥2 clean evening-cron cycles publish on schedule.

## Recommendations
1. **P1 — Make the evening cron authoritative for the day's edition.** Today an off-window early build
   wins the idempotency race and the evening cron no-op's, leaving the edition grounded in the *prior*
   session. Either (a) have the evening run `force`-rebuild when the published edition's `session_date`
   is older than the most recent completed RTH session, or (b) suppress ad-hoc pre-window builds so the
   17:30 ET run produces the canonical edition off the current close.
2. **P2 — Reap orphaned jobs.** Add a watchdog that flips a `running` `nighthawk_job` older than ~2 h
   to `failed` (or resumes it) so rows like 6/26 don't sit `running` indefinitely.
3. **P2 — Persist grounding counts to `meta`.** Stamp `grounded/dropped_ungrounded/flagged` (already
   computed in `generateEditionPlays`) into edition `meta` at publish, so grounding is auditable from
   the row, not just the funnel log.
4. **P3 — Verify across a full cycle next run.** This audit caught a single recovered edition; confirm
   the 6/29 (Sun-eve) and subsequent evening crons publish fresh editions on schedule and that the
   6/29 plays resolve to outcomes after Monday's close.

---
*Method: full source read (cron route, edition-builder, claude-edition, grounding, morning-confirm,
outcomes, serving route, page); live production Postgres queries (editions / jobs / outcomes /
cron_job_runs via Railway public proxy); live HTTP liveness. No secrets printed. Temp query scripts
removed after use.*
