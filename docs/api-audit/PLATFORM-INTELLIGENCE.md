# BlackOut Platform Intelligence
**Last updated:** 2026-06-27 05:30 ET
**Run type:** 🧠 **INAUGURAL BASELINE** (first learning-brain run — no prior history)
**Reports analyzed (last 26h):** 7 — 3× deep-platform-audit, 1× CTO audit, 1× HTTPS/network monitor, 1× connectivity matrix, OPEN-ISSUES log
**Today's findings (curated, deduped):** 31 total · **2 active P0** · 1 latent-at-scale P0 · 14 P1 · 8 P2 · 3 P3 · 3 WARN
**Platform trend:** BASELINE — no comparison possible until ≥2 days of history. First trend read available **2026-06-28**.

> **Method note (intentional, for every future run to follow):** I did **not** use the SKILL's regex
> extraction — it would have produced ~40 noisy, near-duplicate finding strings that poison future
> pattern-matching. Instead I read all 7 reports in full and wrote **31 canonical, deduplicated
> findings** to `learning/history.jsonl`, each with a stable `id`, `category`, `service`, and the
> *corrected* severity (e.g. the SPX ledger is logged as **P2-C**, the git-timing-corrected
> classification, not the CTO's pre-correction P0-1). Clean keys today = meaningful recurrence
> detection tomorrow.

---

## ⚖️ THE ONE DISAGREEMENT THAT MATTERS THIS CYCLE
The two deepest audits **disagree on the platform's single highest-stakes item**, and reconciling
that disagreement is the whole job of this brain:

- **CTO audit (03:00 ET)** filed the empty SPX track record as **P0-1 / P0-2** — "members see an
  empty/wrong P&L on the launched flagship."
- **Deep-platform-audit (07:10 ET)** *self-corrected* to **P2-C WATCH** after checking git: the
  fetch-bug fix `6f00a5e` merged **~20 min after Friday's RTH close**, so **no trading session has
  run with the fix yet**. An empty ledger is **EXPECTED**, not a regression.

**Brain's verdict:** the **07:10 reclassification is correct** on the *symptom* (empty ledger ≠ proof
of breakage), **but the CTO's P0-2 is a real, separate code bug** that survives the veto fix:
`recordPlayEntry` failures are swallowed (`spx-play-engine.ts:915-927`) and `insertOpenSpxPlay`
force-closes the prior open **with no outcome row** (`db.ts:1234-1238`). So the resolution is:
**ledger-emptiness = WATCH (verify Mon 06-29); durable-write correctness = FIX NOW.** These are two
different things that got collapsed into one P0. Separating them is recommendation #1.

---

## PLATFORM HEALTH SCORECARD (baseline)
| Service | Findings (today) | Worst | Headline issue |
|---|---|---|---|
| SPX Slayer | 5 | P1 | Swallowed `recordPlayEntry` write + force-close w/o outcome row; ledger empty (pending Mon validation) |
| Postgres | 6 | P1 | Re-init stampede on DB blip; 305MB write-only telemetry; FK indexes missing pre-fill |
| Polygon WS | 3 | P1 | Lock-refresh TOCTOU + wedge-on-construct-fail + 88-wide far-dated fan-out |
| UW WS | 2 | P0(scale) | **No leader election at all** + unbounded persist fan-out |
| Frontend | 4 | P0 | **No per-route error boundaries** → whole-app whiteout |
| Security/auth | 4 | P0 | `coaching/alerts` fails OPEN on unset env; auth is convention-only |
| Heatmaps/Largo/NWatch/Grid | 3 | WARN | Dual GEX path (W1), panel omits flows (W2), dual macro calendar (W3) |
| Telemetry/cache | 2 | P1 | Per-replica memory read-path; split-brain with no alarm |
| Network | 1 | P3 | `X-Powered-By` leak |
| Audit tooling | 1 | P3 | Stale probes generate false P0/P1 (found by **4** crons independently) |

---

## 🔁 SYSTEMIC PATTERNS (the dots the individual crons each miss)
No day-over-day recurrence exists yet, but **cross-report corroboration within this single cycle**
is itself strong signal. Five patterns, ranked by leverage:

### 1. 🔴 Fail-OPEN on a missing/empty env var — *a named, recurring failure CLASS on this platform*
`coaching/alerts` POST is unauthenticated whenever `CRON_SECRET` is empty (`if (cronSecret && …)` —
the guard is *skipped* when the var is falsy). The CTO explicitly tags this "a recurring failure
class on this platform," and institutional memory independently records the same class (Redis
fail-open ETIMEDOUT cascade; npm-ci lockfile red-lining all services). **The danger is not this one
route — it's the pattern: a single absent env var silently disables a guard.** One audited sweep for
`if (SECRET &&` / fail-open branches would catch the whole class.

### 2. 🔴 Auth-by-convention with no default-deny — *4 endpoints, one root*
`coaching/alerts` (fails open), `/api/market/anomalies` + `/api/market/regime` (serve 200
unauthenticated), and `middleware.ts` itself (documents "each route must self-authorize" but enforces
nothing). **One fix covers all four:** a build-time grep test asserting every
`src/app/api/**/route.ts` calls one of `{requireTierApi, isCronAuthorized, resolveAdminApi}` and
fails CI on an unallowlisted miss. This is the highest-leverage single PR in the security column.

### 3. 🟠 Distributed-systems seams unguarded — *single-process-correct, multi-replica-unsafe*
Polygon got leader election; **UW did not** (P0-4). `reconcileAllMemberships` has no lock.
Telemetry reads per-replica memory. Cache split-brains silently. Even Polygon's *own* lock has a
TOCTOU refresh + wedge-on-construct-fail. **The platform is hardened for one process and exposed at
every replica boundary.** The repo already contains the fix pattern once
(`polygon-socket.ts:117-156`) — porting it to UW is the single biggest scale-out win.

### 4. 🟠 Dual-path / divergent-source — *same logical value derived two ways*
W1 (GEX walls: `fetchPolygonPositioningBundle` vs `fetchGexHeatmap`) and W3 (macro calendar:
`readGridEconomy` vs `mergeMacroEventsToday`). Both are bounded (same math / both grounded), but both
can show a user **two different answers for the same question** depending on which surface they ask.
Converge each to one source-of-truth function.

### 5. 🔵 The audit tooling lies to itself — *rediscovered by 4 crons this cycle*
Every one of deep-audit-00, deep-audit-07, the HTTPS monitor, and the connectivity matrix
**independently** hit the same stale probe paths (`/api/market/spx-pulse`, `/api/flows`,
`/api/nighthawk/latest-edition`, `/api/grid/news`), wrong env names
(`UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`), and the `pool.on`→`livePool.on` regex miss — and each
wasted effort overriding false P0/P1s. **This is P3 by severity but #1 by frequency.** Until the
SKILL probe lists are fixed, every future audit (and this brain) starts by re-debunking phantoms.
Fixing it makes *all* downstream intelligence more trustworthy.

---

## 📉 TRADING IMPACT SUMMARY
| Impact Type | Count | Severity | What the user would experience |
|---|---|---|---|
| Data integrity (wrong/contaminated values) | 3 | 🔴 CRITICAL | W1 wrong wall strike in Largo vs Heatmap; `spx-desk-merge` cross-request structure bleed; ledger empty→wrong P&L (pending) |
| Security fail-open (paid/AI surface exposure) | 3 | 🔴 CRITICAL | `coaching/alerts` open write; anomalies/regime open read; no default-deny |
| Stale data (old info shown as live) | 3 | 🟠 HIGH | `spx_signal_log` 10d stale; `engine/health` build-time snapshot; cache split-brain ≥30s |
| Disconnected channels | 2 | 🟠 HIGH | NWatch panel verdict can't fire flow signal (W2); Grid vs desk macro disagree (W3) |
| Broken feature / whiteout | 2 | 🟡 MEDIUM | No error boundaries → one bad payload whites out app; SPX opens (pending Mon) |
| Cost / perf ballast | 4 | 🟡 MEDIUM | 305MB write-only telemetry; 88-wide GEX fan-out; 187KB sync bundle; 24/7 polling |

**No confirmed "wrong price shown to a user" today** — the market is closed and every data endpoint
correctly 401s. The two CRITICAL data-integrity items (W1, desk-merge race) are *latent* — they bite
during RTH under concurrency. **First authenticated RTH numeric cross-check (W1 empirical confirm) is
the most valuable missing measurement** and should be the connectivity cron's Monday priority.

---

## 🎯 INTELLIGENT RECOMMENDATIONS (priority order)

### 1. [DATA INTEGRITY] Separate the SPX ledger WATCH from the durable-write FIX
- **Do now (code bug, veto-independent):** wrap the open + `recordPlayEntry` in **one transaction**
  and **fail-closed on durability** — never run a live managed play whose outcome row didn't persist;
  never force-close a prior open without writing its outcome (`db.ts:1234-1238`,
  `spx-play-engine.ts:915-927`).
- **Do Monday (verification, not code):** after 06-29 RTH close, re-query prod `spx_open_play` (≥1 row
  if opens work) + `spx_play_outcomes` (populates on close). If still 0 → read the `63567cb`
  diagnostic logs for the rejecting gate; **do NOT re-touch the veto** (already fixed).
- **Why:** this is the launched flagship's headline proof. The fix and the verification are different
  jobs — conflating them (as the single P0-1) risks "we waited for Monday" standing in for "we fixed
  the swallowed write."

### 2. [SCALE] Port Polygon's leader election to UW (P0-4) + bound the persist fan-out
- Copy `polygon-socket.ts:117-156` Redis-SETNX leader lock to `uw-socket.ts`; non-leaders read from
  Redis. Add a `p-limit` semaphore to the `flow_alerts` persist fan-out (`uw-socket.ts:592-615`).
- **Why:** masked today at ~2 replicas; it's the **thing that breaks first** the moment you autoscale
  for a launch-day traffic spike — 5× joins against a 2-RPS cap → reconnect storm → flapping flow feed
  during exactly the window you scaled for. While there, fix the Polygon lock TOCTOU + wedge.

### 3. [SECURITY] One CI grep-test kills the whole auth-by-convention class
- Add a build-time test asserting every `route.ts` calls an auth helper (allowlist the
  intentional-public ones); fix `coaching/alerts` to `isCronAuthorized(req)` (one-line); guard or
  annotate `anomalies`/`regime`.
- **Why:** this is **pattern #1 + #2** above in one PR. The platform is one forgotten guard away from
  a public Anthropic-spend endpoint, and the fail-open class has already bitten twice in memory.
  <1 hour, removes disproportionate risk.

### 4. [FRONTEND] Add scoped `error.tsx` to live-data route groups
- `(site)/heatmap`, `/terminal`, `/grid`, `/nighthawk`, `/track-record`.
- **Why:** a single malformed market payload currently whites out the **entire app shell**, not just
  the panel. For a live-data product this is a when-not-if. <1 hour.

### 5. [CONSISTENCY] Converge the two dual-path sources (W1, W3)
- Route Largo `get_positioning` + Night Hawk dossier through the same `fetchGexHeatmap` matrix the
  Heatmap/NWatch use; converge Grid econ + desk macro on one calendar.
- **Why:** standing W1 has been on the books across multiple audits and in memory — it is the most
  likely "Largo told me a different SPY call wall than the Heatmap" complaint. Confirm empirically on
  Monday's authenticated RTH run before/after the converge.

---

## 🔌 DISCONNECTED / DIVERGENT CHANNELS
Connectivity is **structurally STRONG: 16 wired channels, 0 hard silos, 3 WARN.** No service is
fabricating data. The three open WARNs are consistency risks, not silos:
- **W1** Dual per-ticker GEX path → Largo/NHawk can name a different wall strike than Heatmap/NWatch.
- **W2** Night's Watch *panel* verdict omits HELIX flows (detail view has them) → panel can't fire a
  flow signal; asymmetric verdicts between list and modal.
- **W3** Grid `/api/grid/economy` (UW) vs SPX desk `mergeMacroEventsToday` → two macro calendars that
  can disagree on dates/labels.

---

## ✅ WHAT'S ALREADY GOOD (verified-fixed this cycle — the baseline to defend)
Closed and re-confirmed across reports: **#100** pg pool error handler (`db.ts:113`), **#101** Clerk
`user.created` webhook, **#102** Polygon WS leader election, **#73** Largo SPX confluence grounding,
**#97** `SpxDarkPoolCard` now mounted (`SpxDashboard.tsx`), SPX option-chain veto neutered, Redis
`family:0`, the WIP `platform/intel` TS errors (now `tsc --noEmit` clean), and **prompt caching is
live** (`anthropic.ts:165-197`). Engineering health graded **B+/A-**. **Memory correction:** task
**#103 "no prompt caching" is STALE — caching is implemented.**

## WHAT GOOD LOOKS LIKE (the bar)
- ✓ All service data timestamps within ~2 min during RTH · ✓ Largo walls == Heatmap walls (W1 closed)
- ✓ SPX opens write an outcome row on open AND close · ✓ Every `route.ts` provably behind an auth helper
- ✓ Every WS has multi-replica leader election · ✓ Zero fail-open-on-missing-env branches
- ✓ P0 count trending down week-over-week · ✓ Zero recurring findings (every finding new = learning)

---

## 📈 LEARNING VELOCITY
- **Days of history:** 1 (baseline established today)
- **Findings on record:** 31 (curated, deduplicated)
- **Recurring root causes:** 0 detectable yet — recurrence needs ≥2 days
- **Resolved & defended:** 9 prior tasks confirmed fixed this cycle (see "What's Already Good")
- **Next milestone:** 2026-06-28 — first day-over-day trend; **2026-06-29 (Mon RTH)** — first
  authenticated numeric cross-check (resolves SPX ledger WATCH + W1 empirical confirm).

---
*Generated by the platform learning-brain cron (05:30 ET daily). Reads every audit from the prior 24h,
deduplicates into canonical findings, reconciles cross-report disagreements, and tracks recurrence to
drive root-cause fixes. No secrets, keys, DB URLs, or user data printed. This is the inaugural run —
its chief output is a clean baseline so tomorrow's run can detect what recurred.*
