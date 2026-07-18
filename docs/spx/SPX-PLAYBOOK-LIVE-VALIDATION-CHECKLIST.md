# SPX Slayer / Playbook — Live Market-Hours Validation Checklist & Autonomous SDLC

*Owner: Claude. This is BOTH (a) the standing live-RTH deep-dive audit for the SPX Playbook and
(b) the instruction source the recurring SPX validation agent reads each run. Refining this file
refines what the agent checks. Companions: `docs/spx/PLAYBOOK-SYSTEM-DEEP-SWEEP-2026-07-11.md`,
`docs/spx/PLAYBOOK-ARCHITECTURE-STATUS.md`, `docs/ops/STAGING-F4-MONDAY.md`, `docs/ops/WORK-LEDGER.md`,
`docs/audit/FINDINGS.md`.*

> **The standing P0 is F4 — the live RTH proof.** The whole deep-sweep (#1–#38, PRs #100–#113) was
> verified with the market **closed**, so the single unanswered question is: *with the market open,
> does the engine actually produce gated, graded plays, are the gates healthy, and do real
> instance-linked out-of-sample outcomes start accruing?* Today there are **0 instance-linked OOS
> rows** and the **trading edge is explicitly unproven** — this validation exists to (a) prove the
> machinery runs correctly live and (b) START accruing honest OOS outcomes. **Never claim edge from
> sophistication; only from accumulated graded OOS results.**

> **Code lives under `src/features/spx/lib/`** (not the older `src/lib/spx-*` paths some docs cite).

---

## 0. The SDLC loop (same as Vector's)

Recurring agent fires several times per trading day (RTH). Each run: reads THIS file → validates
staging live → logs to `docs/audit/SPX-PLAYBOOK-LIVE-VALIDATION-LOG.md` → opens a **draft PR** on any
FAIL/regression (append to `docs/audit/FINDINGS.md`) → notifies the user. Findings feed back into
this checklist. **Do not fix engine code in the validation run** unless trivial + obviously correct;
the run finds + documents, a focused PR fixes. Honesty over green: an un-runnable check is `SKIPPED`
with the reason, never `PASS`. One temp Cognito admin/user per run, always deleted. Only fresh
`docs/spx-live-*` / `fix/spx-live-*` branches off `origin/blackout-web-sandbox`.

## 1. Pre-open sanity (once, ~09:00–09:25 ET)

- [ ] Staging reachable; deploy = latest `blackout-web-sandbox` HEAD (ECS PRIMARY rollout COMPLETED).
- [ ] **`isStagingDeploy()` true** — `NEXT_PUBLIC_SITE_URL` contains `staging.` (turns on the playbook
      lab + live gate + Claude gate; `src/lib/clerk-env.ts:10`, `spx-play-config.ts:406/414`).
- [ ] **🔴 VOYAGE precheck (the #1 entry-killer):** `VOYAGE_API_KEY` present in
      `blackout-staging/app/env` AND `DATABASE_URL` set. On staging the Claude/BIE gate is ON by
      default (`playClaudeGateEnabled` unset → `isStagingDeploy()`), so if Voyage/DB is missing,
      `evaluateClaudePlayApproval` **fail-closes and VETOes every entry** with "BIE gate blocked —
      Voyage/DB not configured" (`spx-play-claude.ts:296-304`). Confirm via `staging-live-check.mjs`
      (VOYAGE boolean ~`:78`) or `npm run validate:staging-rth`. **If VOYAGE is unset, EVERY live
      check below reads as a playbook failure that is really a config gap — flag it P1 and stop.**
- [ ] `spx-evaluate` cron ENABLED (the 5-min engine tick, `cron-registry.ts:34`; real schedule in
      the ECS task definition). Also `alert-outcome-sync` (6h), `spx-signal-observe` (5m).
- [ ] `SPX_CLAUDE_DAILY_MAX_CALLS` budget not already exhausted; `PLAYBOOK_LIVE_ALLOWLIST` unset or
      includes PB-01/02/03.

## 2. Engine produces gated plays (F4 core — every run during RTH)

Drive `GET /api/market/spx/play` (premium/cron auth) AND the member `/dashboard` page:

- [ ] API returns a **`playbook_shadow` block** with `market_open:true` during RTH (not
      `{available:false, action:"SCANNING"}` — that's the closed/degraded shape).
- [ ] A **primary playbook fired** — `primary_playbook_id` ∈ live allowlist (PB-01 VWAP Reclaim /
      PB-02 / PB-03 ORB) with a phase (ARM → FIRE), OR an honest SCANNING/WAIT when no setup is live.
- [ ] The play carries **entry / stop / target** levels (from nearest GEX wall + VIX-indexed target)
      and an **action** (BUY at |score|≥22, HOLD ≥10, else WAIT) + a **grade** (A+/A/B/C/D).
- [ ] Member `/dashboard` (SPX Slayer, premium) renders the play card + desk terminal + monitor lane
      with the SAME entry/stop/target/grade the API returns (no card-vs-API divergence).
- [ ] Halt-degraded banner absent (or correct if a real halt); the page never 502s (route degrades
      to `{available:false, action:"SCANNING"}`).

## 3. Gate correctness (A17 stack — `spx-play-gates.ts`)

- [ ] **Live allowlist enforced** — only PB-01/02/03 can go live on staging; a fired PB-04+ stays
      shadow (`isPlaybookLiveAllowlisted`, `spx-play-config.ts:446`; also requires
      `executionModeMeets(mode,"paper_executable")`).
- [ ] **Regime fail-closed** — `isUnknownPlaybookRegime(desk)` blocks when EMA regime is unknown
      (`spx-play-gates.ts:245`).
- [ ] **Data-quality fail-closed** — `shouldFailClosedLiveOnDataQuality` + `playbookDataQualityBlockReason`
      block on severe DQ (`:250-255`); a stale desk suppresses the play.
- [ ] **Trade governor single-thread** (F3 / #98, `trade-governor.ts`) — no double-fire / concurrent
      duplicate plays; one active play at a time.
- [ ] **Confirmations checklist** — 4 required + 6 optional (`spx-play-confirmations.ts`) reflected
      honestly in the payload.

## 4. Confluence + grading math (`spx-signals.ts`)

- [ ] `computeSpxConfluence` score in [-100,100]; **action thresholds** BUY≥22 / HOLD≥10 / WAIT hold.
- [ ] **`scoreToGrade`** correct: A+ needs abs≥72 & ≤1 conflict, A ≥58 & ≤2, B ≥45 & ≤3, C ≥30, else D.
- [ ] Conflicts (`computeWeightedConflicts`, `spx-play-conflicts.ts`) surfaced and consistent with the
      grade (a high-conflict setup can't show A+).
- [ ] Entry/stop/target math: entry off nearest GEX wall + ~3pt buffer; target VIX-indexed; no
      malformed/unrounded numbers.

## 5. BIE arbiter (`spx-play-claude.ts` — despite the name, NO Anthropic calls)

- [ ] With VOYAGE set + a healthy corpus: precedent search runs (`findSimilarPrecedents`), the arbiter
      tallies for(target) − against(stop) precedents (`:227-249`); **net<0 → VETO, net==0 →
      mechanical-only, net>0 & mechanical-approved → APPROVE_BUY** (`:372-417`).
- [ ] **Fail-closed paths (gate ON / staging)** honestly VETO: no Voyage/DB, daily-cap exhausted,
      search error, thin corpus (< MIN_TOTAL_PRECEDENTS), inconclusive (< MIN_USABLE_PRECEDENTS=2) —
      each with the correct reason string, and **every path writes `alert_audit_log` via
      `logPlayVerdict`** (deep-sweep #8 — verify the audit row appears even on a VETO).
- [ ] `bieSearchAvailable() = dbConfigured() && bieEmbeddingsConfigured()` reflects reality.

## 6. Outcome tracking & grading correctness

- [ ] **`spx_play_outcomes` accrues** — after a play closes, a row lands; `classifyOutcome`
      correct (`spx-play-outcomes.ts:172`): pnl>0 → win, pnl<-1 → loss, `pnl<0 & was_loss` → loss,
      else breakeven; `playCloseWasLoss = pnl<=-1`. Cross-check `/api/market/spx/outcomes` (win/loss,
      adaptive gates).
- [ ] **`alert_audit_log` graded** by `alert-outcome-sync` (6h cron → `syncAlertAuditOutcomes`) —
      copies each row's outcome from its origin table (zerodte/nighthawk/spx). Advisory-locked; no
      double-grading.
- [ ] **#27 open-candidate class (watch):** ambiguous same-direction/near-price plays return NULL
      (ungraded) via the `COUNT(*)=1` uniqueness gate (`db.ts:4793`). Count how many plays fall into
      this class over the session — a large share means the win-rate denominator + precedent corpus
      are being undercounted. Log the number.
- [ ] **Instance-linked OOS rows START accruing** — the standing "0 instance-linked OOS rows" gap:
      confirm new plays are writing `playbook_instance_id`-linked outcomes so the OOS corpus finally
      grows. This is the whole point of F4.

## 7. Crons healthy (via admin routes / read-backs — Postgres TCP is blocked from sandbox)

- [ ] `spx-evaluate` firing every ~5 min during RTH (fresh play/alert timestamps).
- [ ] `spx-issues-sync` — no unexpected `admin_incidents` spikes for the SPX engine.
- [ ] `alert-outcome-sync` last-run recent; grading progressing.
- [ ] `spx-signal-observe` snapshotting weights (30-min outcome backfill).
- [ ] Admin surfaces reachable (Cognito): `GET /api/admin/playbook/fsm-today`,
      `/api/admin/playbook/promotion-report`, `/api/admin/spx/health` — FSM shows today's plays,
      promotion report sane.

## 8. Cross-tool coherence (playbook-blindness residual, #4/#5)

- [ ] The member brief / commentary rail / Largo narrative and the play card do **not** show
      contradictory theses (e.g. card says long PB-01 while the brief says short) — `crossToolAlignment`
      / `liveEngineConflict` thread `playbookShadow`; verify live.

## 9. Regression watch-list (must keep holding)

| Ref | Must stay true |
|-----|----------------|
| #102 | `hod_break`/`lod_break` actually FIRE during RTH (`sessionBreakoutExtremesFromBars`) — the CRITICAL one |
| #27 | Candidate-uniqueness gate returns NULL on 2+ matches (no wrong-trade grading) |
| #32 | `buildSpxDeskFlow` returns null GEX on spot≤0 (`spx-desk.ts:1758`); consumers gate on `available:false` |
| #38 | FK + retention CASCADE/SET-NULL ordering doesn't orphan/wrong-cascade outcome rows |
| #8  | Every arbiter path (incl. fail-closed VETO) writes `alert_audit_log` |
| F1  | VWAP fail-closed (#96) · F2 promotion data-quality (#100) · F3 governor single-thread (#98) |

## 10. Environment realities & honesty guardrails

- **WebSockets + raw Postgres TCP are blocked** from the sandbox — DB-side state is verified ONLY via
  admin HTTP routes (`fsm-today`, `promotion-report`, `spx/health`, `/outcomes`) or the cron
  read-backs, never a raw `pg` socket. Mark a DB check SKIPPED if genuinely unreachable.
- Data arrives via **SSE + SWR** (WS proxied off). `npm run test:ios-ui-e2e` is the working Playwright
  harness (iPhone UA + Clerk/Cognito cookie auth). `validate:staging-rth` / `staging-live-check.mjs`
  are the scripted RTH validators.
- **Edge honesty:** the architecture is sophisticated but the **edge is unproven**. Never report a
  win-rate as validated edge; report it as accruing OOS data with n and the ungraded (#27) share.
- Authenticate ONCE per run (Clerk/Cognito rate-limit rapid cycles). Keep each run < ~15 min.

## 11. Backlog / things to surface as findings warrant

Promotion of PB-04 from shadow; expanding the live allowlist beyond PB-01/02/03 (only once OOS
supports it); the #31 UW positional-contract hardening; the #32 numeric-field split-return; tightening
the #27 ungraded class (e.g. tie-break instead of NULL) if it swallows too many plays.

---

### Change log
- 2026-07-12 — created from the SPX system map (deep-sweep + architecture-status + F4 runbook +
  code anchors under `src/features/spx/lib/`). Initial focus: F4 live proof, the VOYAGE gate
  precheck, gated-play production, grading correctness, and starting to accrue instance-linked OOS
  outcomes. Edge remains unproven — validate the machinery, accrue honest results.
