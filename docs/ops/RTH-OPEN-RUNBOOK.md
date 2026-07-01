# RTH-open runbook (autonomous — no user prompt)

**Cloud agents:** run this at the start of every **weekday** session when US equity RTH is
open or warming up (09:00 ET+). **Do not ask the user** — execute immediately, fix failures,
commit, push, re-validate until GREEN.

## Trigger (agent self-start)

| Condition | Action |
|---|---|
| Weekday, ET ≥ 09:00 | Run `npm run validate:rth-open` first thing |
| User message is empty / "continue" / "keep going" on a weekday | Same — treat as RTH resume |
| Weekend or ET < 09:00 | Skip RTH checks unless `--force`; routine work only |
| After every push to `main` | `deploy-smoke.yml` auto-runs; locally: `npm run validate:deploy-wait && npm run validate:gha-smoke` |

## Command

```bash
npm run validate:rth-open
# off-hours override:
node scripts/rth-open-check.mjs --force
```

## What it checks

1. **`validate:deploy`** — Railway SUCCESS, live HTTP, Postgres, Sentry, sockets, crons
2. **RTH session checks** (weekdays; agent may run from 09:00 ET pre-open through ~16:15 ET post-close grace for crons — **US equity RTH is 9:30 AM–4:00 PM ET**):
   - `spx-evaluate` ok run in last 20m
   - `market_regime` writes in last 20m
   - `data-correctness` latest run ok
   - `provider-health-reconcile` latest run ok (when Railway service provisioned)
   - options-socket **authenticated** (after 09:30 ET)
   - no uw-socket stall storms

## Fix loop (until GREEN)

1. Diagnose failing check (Postgres `cron_job_runs`, Railway logs, Sentry)
2. Fix in code if needed → branch → PR → merge
3. Poll Railway until deploy SUCCESS
4. Re-run `npm run validate:rth-open`
5. Confirm first SPX play / lotto ticket shows **real premium** (not "—") after chain fixes (#36, #39)

## Scheduled automations

| Method | Schedule (ET, weekdays) | Secrets required |
|---|---|---|
| **`deploy-smoke.yml`** | **on every `main` push** | `CRON_SECRET` optional (SPX desk probe) |
| **`rth-preopen-smoke.yml`** | **09:30** | `CRON_SECRET` optional |
| **`rth-open-check.yml`** | **09:40** | `CRON_SECRET`, `DATABASE_PUBLIC_URL` |
| **`rth-cloud-agent.yml`** | **09:32** | `CURSOR_API_KEY` |
| **`rth-deep-audit.yml`** | **10:00, 14:00, 16:30** | `CRON_SECRET` (required), `POLYGON_API_KEY`, `DATABASE_PUBLIC_URL`, `SENTRY_AUTH_TOKEN` optional |
| **`rth-post-close-smoke.yml`** | **17:15** | `CRON_SECRET`, `SENTRY_AUTH_TOKEN` optional |
| **`off-hours-health.yml`** | **every 6h** | none (public `/api/ready`) |
| **`railway-audit-apply.yml`** | **Sun 06:00 UTC** + on `railway.*.toml` push | `RAILWAY_TOKEN`; optional `DISCORD_*` |
| **`railway-cron-config-check.yml`** | **on PR/push** (cron TOML/registry) | none |
| **`cron-audit-query.yml`** | **hourly RTH** + **every 6h** off-hours | `DATABASE_PUBLIC_URL` |
| **`ops-auto-fix.yml`** | **every 20 min** | `CURSOR_API_KEY`, `DATABASE_PUBLIC_URL`, `CRON_SECRET`, `GITHUB_TOKEN` (repo) |

### Railway env (blackout-web service)

| Variable | Value | Purpose |
|---|---|---|
| `CRON_WATCHDOG_SELF_HEAL` | `1` | Auto re-warm stale RTH crons when watchdog fires (safe writers only) |

Provision new cron trigger services with:

```bash
node scripts/railway-apply-cron-config.mjs provider-health-reconcile
```

All scheduled workflows also support **Run workflow** (manual) from GitHub → Actions.

### GitHub secrets — add before first scheduled run

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Required for | Source |
|---|---|---|
| `CRON_SECRET` | deep audit + smoke desk probe | Railway `blackout-web` |
| `POLYGON_API_KEY` | SPX oracle in deep audit | Railway `blackout-web` |
| `DATABASE_PUBLIC_URL` | Postgres writer/cron freshness | Railway **Postgres** service |
| `CURSOR_API_KEY` | Cloud Agent auto-launch | Cursor → Integrations → API key |
| `SENTRY_AUTH_TOKEN` | Sentry token smoke (deep audit + post-close) | Sentry → Settings → Auth Tokens |
| `RAILWAY_TOKEN` | Railway audit apply (cron sync) | Railway → Account → Tokens (project scope) |

### One-time: enable API-triggered agents

1. Cursor → Settings → Integrations → create **User API key** (or service account)
2. GitHub repo → Settings → Secrets → Actions → add `CURSOR_API_KEY`
3. Next weekday 09:32 ET, `rth-cloud-agent.yml` starts an agent with this runbook prompt

### Cursor Automation template (dashboard)

- **Schedule:** Mon–Fri 09:32 AM ET (cron `32 13 * * 1-5` in EDT months; add `32 14` for EST)
- **Repo:** `coreentryadmin-web/blackout-web` on `main`
- **Prompt:** same as `rth-cloud-agent.yml` (run RTH-OPEN-RUNBOOK autonomously)

## RTH COMPREHENSIVE TEST SWEEP (browser + API + correctness)

> Run this FULL sweep on every RTH agent launch this week, **multiple passes per session**
> (at minimum: ~09:35 open, ~11:00, ~13:00, ~15:00, ~15:55 close). Each pass: sign in with a
> premium session, then exercise EVERY page. Capture evidence (screenshots/numbers/timings).
> Append findings to `docs/api-audit/OPEN-ISSUES.md` and open a GitHub issue (label
> `ops-auto-fix`) for any **P0/P1**; then run the Fix loop until GREEN.

**Pages to cover every pass:** `/dashboard` (SPX Slayer), `/flows` (HELIX), `/heatmap`
(BlackOut Thermal — test BOTH Matrix and Profile), `/grid` (and each of the 12 panels),
`/nighthawk`, `/terminal` (Largo), `/track-record`.

### 1. Speed (per page)
- Measure **TTFB** and **time-to-interactive** on hard load, and **soft-nav** time (click the
  nav link → first meaningful paint). Prefetch is enabled, so soft-nav should feel near-instant.
- Flag any page where soft-nav > ~1.5s to usable, or a long blank/frozen gap before the skeleton.
- Record numbers; compare across passes to catch RTH-load degradation.

### 2. Live auto-update (per page) — NO manual refresh
- Sit on each page WITHOUT refreshing and confirm numbers/tiles **tick on their own**.
- Measure **how soon** each surface updates (note the observed interval) and that it matches the
  intended cadence (e.g. dashboard pulse ~1–10s, Thermal matrix ~20s + quote ~15s, grid panels
  20–90s, flows tape via SSE near-real-time). Flag anything that does NOT move during RTH.
- Confirm SSE/stream liveness (flows tape, dashboard pulse, Thermal index spot) is pushing.
- Alt-tab away ~30s, return: data should re-sync immediately (focus revalidation is on).

### 3. Data correctness (NO fabricated / faulty numbers)
- For key numbers, **verify against the canonical source via direct API call** (instant
  verification): hit the relevant `/api/market/*` or `/api/grid/*` with the session and compare
  the rendered value to the API payload. Examples:
  - SPX spot/VIX/breadth on the dashboard + grid Pulse vs `/api/market/spx/merged`.
  - GEX flip / call wall / put wall: Thermal vs grid GEX panel vs Largo vs
    `/api/market/gex-positioning` — they must agree (same canonical cache).
  - Grid Pulse breadth must be REAL adv/dec (not the ADD line); dark-pool premium must be $ not share size.
- Run the in-app verifier: `GET /api/cron/data-correctness?force=1` (Bearer `CRON_SECRET`) and
  treat any `flags[]` as a correctness defect to fix.
- **Freshness honesty:** every "live"/"updated" indicator and `as_of` timestamp must reflect reality —
  flag anything labeled live that is actually stale.
- **No fabrication:** flag any placeholder/zero/"—"/made-up value shown as real; values must be
  grounded in a live source or shown as unavailable.

### 4. API verification (every market endpoint)
- For each `/api/market/*` and `/api/grid/*`: assert HTTP 200, `as_of` fresh (within its cadence),
  numbers in sane bounds, and no unexpected nulls where data is expected. Log any 4xx/5xx, 404s,
  or empty payloads during RTH.

### 5. Console / render health
- Check the browser console on each page for errors, React hydration warnings, and CSP violations.

### 6. Largo (Terminal)
- Ask multi-tool questions (e.g. "dark pool + options flow on NVDA"); confirm the working status
  names the live sources, the answer is grounded (numbers match the tools), and follow-ups are dynamic.

### 7. Missing-field audit (EVERY page + sub-page)
Goal: find every user-visible field that has **no value** and determine **why**, then fix the real ones.

- **Scan** each page/panel for empty/placeholder values: `—`, `–`, blank, `N/A`, `null`/`undefined`
  text, `$—`, `—%`, `0`/`0.00` where zero is implausible, empty tables/lists, "No data" where data
  should exist. Cover the deep views too (Thermal matrix + profile cells, grid's 12 panels, the SPX
  desk panels, Night Hawk play tickets, position rows, earnings/flow/congress rows).
- **Root-cause each empty field** by checking the backing API (call it directly with the session):
  | Cause | How to tell | Action |
  |---|---|---|
  | **UI bug** — API HAS the value but the field renders empty | API payload contains the field; UI shows `—` | **FIX** (wrong field mapping/path, bad formatter, render guard) — like the breadth/SPX-premium classes |
  | **Upstream/data gap** — API itself returns null/empty | endpoint returns null/missing for that field during RTH | **FIX or escalate**: wrong upstream endpoint, missing provider call, cache not warmed, or a writer cron not running (check `cron_job_runs`) |
  | **Off-hours / market-closed** | desk/session gated; value resumes at open | **Expected** — note, do not "fix" |
  | **Tier/launch gate** | `coming_soon`/empty for locked tool | **Expected** |
  | **Cold cache** — first read before warm | populates on next poll/warm | Transient — re-check; flag only if persistent during RTH |
- **No fabrication:** the fix is to surface the REAL value or honestly show unavailable — never invent
  a placeholder number to fill a blank.
- Record every empty field found, its page, its backing endpoint, and the cause classification.

### Report each pass
- Append a dated entry to `docs/api-audit/OPEN-ISSUES.md`: per-page speed numbers, observed update
  intervals, and any correctness/freshness/API defects (with the API evidence).
- Open/My update a GitHub issue (label `ops-auto-fix`) for P0/P1; fix → branch → PR → merge → re-verify.

## References

- Probe paths for audits: `docs/api-audit/AUDIT-SKILL-REFERENCE.md` · in-repo SKILL: `.cursor/skills/platform-audit/SKILL.md`
- Open issues: `docs/api-audit/OPEN-ISSUES.md`
- Agent instructions: `AGENTS.md` § Autonomous RTH resume
