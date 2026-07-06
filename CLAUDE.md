# CLAUDE.md — operating memory for BlackOut Trades audits

(Repo also has `AGENTS.md` — the general agent playbook. This file captures the
standing **audit + issue-handling policy**. Keep it and `docs/audit/FINDINGS.md` updated.)

## Issue-handling policy (standing instruction)
As soon as an issue is spotted during any audit/validation:
1. **Open a new branch off `main`**, named `fix/<slug>`. Do NOT push straight to `main`.
2. **Fix it and add a test** (extend the nearest `*.test.ts`; run `npx tsx --test <file>`).
3. **Log it in `docs/audit/FINDINGS.md`** (severity, root cause, file:line, evidence, fix, status).
4. **Open a PR to `main`, verify CI is green, then merge it.** Keep the PR small (one issue per branch/PR).
Documentation/policy changes (this file, FINDINGS, runbook) go on the audit branch, not a fix branch.

**Merge authorization, standing as of 2026-07-06:** explicit user instruction — auto-merge every
issue-handling-policy PR into `main` once local verification (tsc/test/build/lint as applicable)
and CI are green. Do not stop to ask for per-PR merge approval; do not wait for a review. This
supersedes any earlier per-PR confirmation habit in this doc's history. Still exercise judgment on
scope/blast-radius per the PR write-up policy below, and still keep PRs small/single-issue — the
standing authorization is for merging, not for skipping verification or scope discipline.

## PR write-up policy (standing instruction)
Every PR — fix or docs — gets a deep, clean write-up so Cursor (a parallel agent working the
same repo) can read the diff cold and understand it without asking follow-up questions:
- **Root cause**, not just symptom: the exact broken logic/line, why it was wrong, and why it
  wasn't caught earlier.
- **Evidence**: live numbers, header captures, or a before/after test run — whatever actually
  proved the bug, not just an assertion that it exists.
- **Blast radius**: every other call site/consumer touched by the same root cause (duplicated
  logic in a second file counts — fix and note all of them, not just the one you tripped over).
- **Fix rationale**: why this fix and not an alternative; what was deliberately left unchanged.
- In-code comments on the non-obvious parts (the WHY, per the repo's normal comment policy) so
  the reasoning survives even if the PR description is skimmed.

## Audit toolkit (committed)
- `scripts/audit/data-validator.mjs` — cross-provider validator (Polygon+UW ground truth vs the numbers members see: prices/indices, GEX/greeks, track-record math, malformed-number scan). Secrets from env only; one temp Clerk user per run, always deleted. Exits non-zero on any FAIL.
- `docs/audit/MARKET-OPEN-VALIDATION.md` — runbook + the daily market-open **Claude scheduled-trigger** prompt + secrets checklist (13:32 UTC weekdays).
- `docs/audit/BASELINE-2026-07-01.md` — pre-open baseline to diff the live run against.
- `docs/audit/FINDINGS.md` — living issue log (keep updating).

## Environment realities (this cloud sandbox)
- **WebSockets are blocked** by the agent proxy (WS upgrades unsupported). UW/Polygon WS run **server-side** (Railway); the browser gets data via **SSE + SWR polling**, so validate WS-sourced numbers through the REST/SSE endpoints that surface them.
- **Playwright mobile UI E2E works** — `npm run test:ios-ui-e2e` drives prod (or `VALIDATE_BASE`) with iPhone viewport + `BlackOutiOSApp` UA, Clerk cookie auth, tab/segment clicks, and screenshots under `/opt/cursor/artifacts/ios-ui-e2e/`. Full `ios-native-shell` CSS requires PR #557 merged/deployed; until then the suite still clicks the tab bar and primary controls on the live `ios-app` shell.
- **Direct Postgres (raw TCP) is blocked**, same as WebSockets — confirmed via a raw `/dev/tcp` connect to the `DATABASE_PUBLIC_URL` host:port (`thomas.proxy.rlwy.net:27432`), which hangs/fails with no SYN-ACK, and independently via the `pg` client (`ENOTFOUND postgres.railway.internal` on the private host — expected, VPC-only — then a hard `timeout expired` on the public host, i.e. never even completes a TCP handshake). Only HTTP(S) egress through the agent proxy works. So `pg_stat_activity`/lock/row-count probes against prod are **not possible from this sandbox** — root-causing a live DB-side issue (lock contention, slow query, table bloat) needs either a Railway-side shell/exec (e.g. `railway run` from a real Railway environment) or a temporary HTTP-exposed debug endpoint in the app itself. Don't spend time retrying a raw `pg.Client` connection here.
- **`${{shared.*}}` env refs do NOT resolve here** — set literals: `UW_API_KEY` (UUID), `DATABASE_URL`, `REDIS_URL`, `POLYGON_API_BASE`. Working: `POLYGON_API_KEY`, `CLERK_SECRET_KEY`, Clerk publishable key. **`BENZINGA_API_KEY` is missing** (news won't fetch live).
- Clerk instance requires a **phone number** on user creation; rapid sign-in/token cycles get **FAPI-rate-limited** — authenticate once per run.

## Auth model (quick ref)
- Admin: Clerk `publicMetadata.role === "admin"` (or `ADMIN_EMAILS`). Tier: `publicMetadata.tier` (Whop-driven; 60s cache). `role:admin` bypasses per-tool launch gates.
- Prod audit login: mint Backend-API `sign_in_token` → FAPI `clerk.blackouttrades.com` ticket exchange → `__session` cookie. Documented in `AGENTS.md`.

## Data-correctness notes learned
- Prices: validate app SPY/SPX/VIX against Polygon; SPX ≈ 10× SPY.
- EMA/VWAP logic: `src/lib/providers/ma-math.ts`. Prior-session OHLC: `src/lib/providers/spx-session.ts`.
- Systemic: several endpoints serve unrounded floats (e.g. `7499.360000000001`) — round at the data layer.
