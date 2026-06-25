# BlackOut — Autonomous SDLC Automation Plan

Turns idle compute (weeknights + weekends, when the RTH market-data audit is dormant) into a 24/7 SDLC engine: build/test health, UI rendering, E2E interactions, error triage, security, performance, a11y, UI enhancements, backlog grooming. Each scheduled task runs FRESH (no memory) — it reads its section here and executes autonomously.

## ⚡ AGGRESSIVE MODE — ACTIVE (set 2026-06-25)
Every job runs FULL-DEPTH, never a spot-check. Each run MUST:
- **Launch a thorough multi-agent DEEP-PASS workflow** for its dimension (5–8 agents over disjoint sub-dimensions) — be EXHAUSTIVE, dive deep, leave no stone unturned. A light/quick check is unacceptable.
- **Fix MORE per run** — every high-confidence, build-gated correctness/render/interaction/perf/a11y bug it finds, sequentially (not "a few"). Branch+flag the risky/large ones.
- **Compound** — cross-check live + code + the prior run's log so coverage deepens over time.
- Still build-gated + safe (the FIX-vs-FLAG policy governs main vs branch) and still TERMINATE (exhaustive within the run, then log — no infinite loop).
The jobs run FREQUENTLY (multiple deep passes daily, see schedule), so depth × frequency = continuous thorough coverage.

## GLOBAL GUARDRAILS (every job obeys these)
- **Repo:** `C:/Users/raidu/blackout-platform/blackout-web` (a junction; the literal string "blackout-web" alone is blocked by a git classifier — always use this full junction path for git). `git pull --ff-only` before working.
- **Validate every change:** `npx tsc --noEmit` AND `npm run build` MUST both be green before ANY commit. Never commit broken code; if you can't get green, revert.
- **FIX-vs-FLAG policy (critical):** AUTONOMOUSLY FIX + push to `main` ONLY for HIGH-CONFIDENCE, small, isolated, build-gated correctness/render/interaction bugs. For anything risky, large, ambiguous, design-altering, or product-deciding (refactors, UI redesigns, dependency MAJOR bumps, schema changes): create a branch `auto/<job>-<YYYY-MM-DD>`, commit + push the BRANCH, and FLAG it (TaskCreate + log) for human review — do NOT push to `main`.
- **Depth (AGGRESSIVE):** each run does a FULL multi-agent deep audit and fixes EVERY high-confidence build-gated issue it finds (branch+flag the risky ones). Not a light check. It must still terminate — exhaustive within the run, then log.
- **Concurrency safety (jobs now overlap):** ALWAYS `git fetch && git pull --rebase origin main` before committing. If a push is rejected non-ff (a concurrent job pushed), `git pull --rebase origin main` + retry the push ONCE. Prefer `auto/<job>-<date>` branches for non-trivial changes (branches never collide on main); keep main pushes small + high-confidence so rebases stay clean.
- **Brand:** emerald(bull)/bear(#ff5c78)/sky/gold; NO grey (no text-grey/zinc/neutral). Secrets never in client/NEXT_PUBLIC.
- **Log:** append to `docs/auto/<job>-<YYYY-MM-DD>.md` (create if new): timestamp · ✅/⚠️/❌ · evidence · action taken (fixed+sha / branched / flagged).
- **No duplication / no theater:** if another job owns a concern in its window, skip it; every run must fix something real or log a real finding.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## JOBS

### 1. green-build-test-gate — nightly weeknights
Catch regressions on `main` overnight. Run `npx tsc --noEmit`, `node --test` (valuation/verdict tests), `npm run build`. All green → log "green". Red → diagnose; fix if high-confidence+small (re-validate → main), else branch+flag. Report which check broke + the fix.

### 2. visual-render-sweep — nightly weeknights
Catch UI render bugs. Via the Chrome bridge load each page (`/`, `/dashboard`, `/flows`, `/heatmap`, `/nighthawk`, `/terminal`, `/upgrade`, `/embed/track-record`, `/admin`): screenshot + read console (errors, React #418 hydration, failed fetches) + check broken layout / overlap / all-"—" / broken images / grey-color violations / empty-state correctness. NOTE after-hours = market CLOSED, so "market closed" empty states are EXPECTED, not bugs. Fix high-confidence render bugs (→ main); flag layout/design issues.

### 3. error-triage — daily (incl. weekends)
Triage production errors. Check Sentry / the error sink / logs for NEW error signatures + rate since last run. For each new/spiking error: reproduce + root-cause; fix high-confidence (→ main); flag the rest with stack + repro. Log the error inventory.

### 4. e2e-interaction-sweep — nightly weeknights
Catch broken interactions. Via the Chrome bridge exercise + assert (no error): NW add position (VALID future weekday expiry) → values → close → realized P&L → delete; Largo ask 2 questions → grounded; heatmap ticker+lens+view switches → data changes; flows filters; admin cron "Run now". Fix high-confidence broken interactions (→ main); flag the rest. Clean up test artifacts (keep one NW position for #74).

### 5. security-dep-scan — weekly (Sat)
`npm audit` (CVEs); grep secrets in client/NEXT_PUBLIC; verify launch-gating (locked tools 403 non-admins) + admin-route auth + embed/sovereignty + Whop webhook signature. Fix trivial-safe only (e.g. a patch dep bump that builds green); FLAG everything security-sensitive (never auto-bump majors). Log inventory + severities.

### 6. performance-audit — weekly (Sat)
Measure page-load + per-route bundle size + Core Web Vitals (Chrome) on key pages; find slow Redis/PG queries, N+1s, oversized chunks. Fix clear safe wins (e.g. dynamic-import an oversized client chunk, build-gated → main); flag bigger perf work. Log metrics + trend.

### 7. accessibility-audit — weekly (Sat)
Across key pages: color contrast (enforce AA + no-grey/bear-text), keyboard nav, focus states, ARIA, alt text, reduced-motion. Fix clear safe a11y bugs (→ main); flag larger ones. Log WCAG findings.

### 8. ui-enhancement-audit — weekly (Sun)
Design polish + the "Living Terminal" visual language (#81 VITALS): consistency, mobile/responsive, micro-interactions, motion gaps. PROPOSE enhancements — design is a product call, so almost always BRANCH + flag (TaskCreate), NOT auto-push to main. Implement only trivially-safe token/spacing fixes directly. Log proposals.

### 9. backlog-groomer — weekly (Sun)
Keep the roadmap moving. Review the open TaskList + recent auto/audit logs; pick the highest-value, lowest-risk, well-specified pending item; implement it (build-gated → main if safe, else branch+flag); update the task. ONE item per run. Log what advanced.

## SCHEDULE (PT local; durable, recurring)
| Job | Cron | When |
|---|---|---|
| green-build-test-gate | `13 20 * * 1-5` | 8:13 PM weeknights |
| visual-render-sweep | `13 21 * * 1-5` | 9:13 PM weeknights |
| error-triage | `13 22 * * *` | 10:13 PM daily |
| e2e-interaction-sweep | `13 23 * * 1-5` | 11:13 PM weeknights |
| security-dep-scan | `7 9 * * 6` | Sat 9:07 AM |
| performance-audit | `7 11 * * 6` | Sat 11:07 AM |
| accessibility-audit | `7 13 * * 6` | Sat 1:07 PM |
| ui-enhancement-audit | `7 9 * * 0` | Sun 9:07 AM |
| backlog-groomer | `7 11 * * 0` | Sun 11:07 AM |

Plus existing: `market-hours-audit` (30 min RTH), `railway-deploy-monitor` (hourly 6AM–7PM). All durable + recurring — they run indefinitely until disabled in the Scheduled section. The machine + app must be running at fire time, else a job runs on next launch.
