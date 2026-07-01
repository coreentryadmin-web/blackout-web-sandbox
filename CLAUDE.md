# CLAUDE.md — operating memory for BlackOut Trades audits

(Repo also has `AGENTS.md` — the general agent playbook. This file captures the
standing **audit + issue-handling policy**. Keep it and `docs/audit/FINDINGS.md` updated.)

## Issue-handling policy (standing instruction)
As soon as an issue is spotted during any audit/validation:
1. **Open a new branch off `main`**, named `fix/<slug>`. Do NOT push straight to `main`.
2. **Fix it and add a test** (extend the nearest `*.test.ts`; run `npx tsx --test <file>`).
3. **Log it in `docs/audit/FINDINGS.md`** (severity, root cause, file:line, evidence, fix, status).
4. **Open a draft PR** to `main`. Keep the PR small (one issue per branch/PR).
Documentation/policy changes (this file, FINDINGS, runbook) go on the audit branch, not a fix branch.

## Audit toolkit (committed)
- `scripts/audit/data-validator.mjs` — cross-provider validator (Polygon+UW ground truth vs the numbers members see: prices/indices, GEX/greeks, track-record math, malformed-number scan). Secrets from env only; one temp Clerk user per run, always deleted. Exits non-zero on any FAIL.
- `docs/audit/MARKET-OPEN-VALIDATION.md` — runbook + the daily market-open **Claude scheduled-trigger** prompt + secrets checklist (13:32 UTC weekdays).
- `docs/audit/BASELINE-2026-07-01.md` — pre-open baseline to diff the live run against.
- `docs/audit/FINDINGS.md` — living issue log (keep updating).

## Environment realities (this cloud sandbox)
- **WebSockets are blocked** by the agent proxy (WS upgrades unsupported). UW/Polygon WS run **server-side** (Railway); the browser gets data via **SSE + SWR polling**, so validate WS-sourced numbers through the REST/SSE endpoints that surface them.
- **Browser (Playwright/Chromium) is blocked** (`ERR_CONNECTION_CLOSED` to every host). Visual/interactive/console/rendered-UI checks need a working browser env; until then, audit at the code + captured-HTTP level.
- **`${{shared.*}}` env refs do NOT resolve here** — set literals: `UW_API_KEY` (UUID), `DATABASE_URL`, `REDIS_URL`, `POLYGON_API_BASE`. Working: `POLYGON_API_KEY`, `CLERK_SECRET_KEY`, Clerk publishable key. **`BENZINGA_API_KEY` is missing** (news won't fetch live).
- Clerk instance requires a **phone number** on user creation; rapid sign-in/token cycles get **FAPI-rate-limited** — authenticate once per run.

## Auth model (quick ref)
- Admin: Clerk `publicMetadata.role === "admin"` (or `ADMIN_EMAILS`). Tier: `publicMetadata.tier` (Whop-driven; 60s cache). `role:admin` bypasses per-tool launch gates.
- Prod audit login: mint Backend-API `sign_in_token` → FAPI `clerk.blackouttrades.com` ticket exchange → `__session` cookie. Documented in `AGENTS.md`.

## Data-correctness notes learned
- Prices: validate app SPY/SPX/VIX against Polygon; SPX ≈ 10× SPY.
- EMA/VWAP logic: `src/lib/providers/ma-math.ts`. Prior-session OHLC: `src/lib/providers/spx-session.ts`.
- Systemic: several endpoints serve unrounded floats (e.g. `7499.360000000001`) — round at the data layer.
