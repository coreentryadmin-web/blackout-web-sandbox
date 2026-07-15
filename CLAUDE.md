# CLAUDE.md — operating memory for BlackOut Trades audits

(Repo also has `AGENTS.md` — the general agent playbook. This file captures the
standing **audit + issue-handling policy**. Keep it and `docs/audit/FINDINGS.md` updated.)

## Issue-handling policy (standing instruction)
As soon as an issue is spotted during any audit/validation:
1. **Open a new branch off `main`**, named `fix/<slug>`. Do NOT push straight to `main`.
2. **Fix it and add a test** (extend the nearest `*.test.ts`; run `npx tsx --test <file>`).
3. **Log it in `docs/audit/FINDINGS.md`** (severity, root cause, file:line, evidence, fix, status).
4. **Open a PR to `main`, verify CI is green, then auto-merge it.** Keep the PR small (one issue per branch/PR).
Documentation/policy changes (this file, FINDINGS, runbook) merge the same way once verified.

**Merge authorization — standing, ongoing (confirmed 2026-07-06):** auto-merge every
verified PR into `main` once local checks (tsc/test/build/lint as applicable) and required CI
(`verify`) are green. Do **not** stop to ask for per-PR merge approval; do **not** wait for a
human review. Enable GitHub auto-merge (`gh pr merge --auto --squash --delete-branch`) as soon as
the PR is open and mergeable — the repo's `automerge.yml` does this automatically for `cursor/*`
branches; agent branches named `fix/*` or `cursor/*` must still be merged by the agent if CI
passes before the workflow fires. This supersedes any earlier "leave OPEN for end-of-day review"
language in `FINDINGS.md` or elsewhere. Still exercise judgment on scope/blast-radius per the PR
write-up policy below, and still keep PRs small/single-issue — the standing authorization is for
**merging**, not for skipping verification or scope discipline.

**Do not auto-merge:** draft PRs; PRs with failing required CI; Dependabot major-version bumps
until CI is fixed; changes the user explicitly flags as deploy-risky (hold on a branch until
they say go).

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

## Vector per-push E2E validation (STANDING GATE — do this for EVERY push, not once)
After **every** Vector change deploys to staging, run the full end-to-end validation and only move
on when it's green. This is a hard gate, repeated per push — never a one-time check.
- **Harness:** `scripts/vector-staging-e2e.mjs` (`npm run validate:vector-push-gate`). Signs into staging
  (Cognito temp admin+premium user, always deleted) and sweeps **multiple stocks × multiple
  timeframes × multiple expiries** — default `SPX,SPY,NVDA,ASTS` × `1m,5m,15m,1H` × `0DTE,WEEKLY,
  MONTHLY,ALL` (override via `VECTOR_E2E_TICKERS/TFS/DTES`). Per ticker it asserts: chart canvas +
  GEX ladder rows + spot + desk terminal + regime banner render; every DTE toggle re-scopes; every
  timeframe redraws; the indicator menu shows BOTH groups and enabling one of each kind (overlay /
  session level / prior-day level) actually draws; and **zero console errors**. Exits non-zero on
  any failure. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY` so `~/.aws/credentials`
  is used. Screenshots under `SHOT_DIR`.
- **Rule:** a change isn't "done" until this passes on the deployed build. If it fails, fix (new
  PR) before starting the next feature. Deploys take a few min — validate after the deploy settles,
  not mid-deploy (mid-deploy chunk-hash races produce transient `_next` 404/MIME noise).

## Vector HARDCORE suite (deep value + dynamism + wall/bead dynamics — RTH-reusable)
Beyond the render gate: `scripts/vector-hardcore-e2e.mjs` (`npm run validate:vector-hardcore`) asserts
the ACTUAL values are correct AND re-render dynamically on every selection change (the "stale data
didn't update" class), plus that the wall/bead rail forms/updates/grows/fades over time. Per
ticker × DTE × TF it checks (via the clean JSON APIs + DOM + canvas-hash diffs): ladder rows
finite/descending/magnitude∈[0,1]/one-king-per-side/no-malformed-floats/spot-in-band; regime wording
matches spot-vs-flip; max-pain within band; DTE re-scopes maxPain/flip/regime/terminal; timeframe
redraws the canvas + re-aggregates bars; indicator toggles redraw + badge tracks; replay frame count
(rail formed over time) + start≠end (beads change); narrowed-horizon wall strength growth/fade; and
zero console errors; plus cross-ticker SPX≈10×SPY. **Reusable during RTH:** `RTH=1` adds a live-poll
that asserts the wall rail advances within 35s (real forming/growing/fading). Run with
`env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. KEEP GROWING IT — add a case whenever a new
value/mapping/surface ships. Off-hours the narrowed-horizon rail can be empty (recorder idle); that's
a SKIP not a fail, and the replay frame count covers the temporal aspect.

## Audit toolkit (committed)
- `scripts/audit/data-validator.mjs` — cross-provider validator (Polygon+UW ground truth vs the numbers members see: prices/indices, GEX/greeks, track-record math, malformed-number scan). Secrets from env only; one temp Clerk user per run, always deleted. Exits non-zero on any FAIL.
- `scripts/vector-staging-e2e.mjs` — the Vector per-push E2E gate (see the section above).
- `scripts/vector-hardcore-e2e.mjs` — the deep value/dynamism/wall-dynamics suite (see the section above).
- `docs/audit/MARKET-OPEN-VALIDATION.md` — runbook + the daily market-open **Claude scheduled-trigger** prompt + secrets checklist (13:32 UTC weekdays).
- `docs/audit/BASELINE-2026-07-01.md` — pre-open baseline to diff the live run against.
- `docs/audit/FINDINGS.md` — living issue log (keep updating).

## Environment realities (this cloud sandbox)
- **All infrastructure runs on AWS ECS only** — there is no Railway. Docker images are built and pushed to ECR, ECS services are force-deployed, Cloudflare cache is purged. Staging: `blackout-staging-cluster` / `blackout-staging-web` at `staging.blackouttrades.com`.
- **WebSockets are blocked** by the agent proxy (WS upgrades unsupported). UW/Polygon WS run **server-side** (AWS ECS); the browser gets data via **SSE + SWR polling**, so validate WS-sourced numbers through the REST/SSE endpoints that surface them.
- **Playwright mobile UI E2E works** — `npm run test:ios-ui-e2e` drives prod (or `VALIDATE_BASE`) with iPhone viewport + `BlackOutiOSApp` UA, Clerk cookie auth, tab/segment clicks, and screenshots under `/opt/cursor/artifacts/ios-ui-e2e/`. Full `ios-native-shell` CSS requires PR #557 merged/deployed; until then the suite still clicks the tab bar and primary controls on the live `ios-app` shell.
- **Direct Postgres (raw TCP) is blocked**, same as WebSockets — only HTTP(S) egress through the agent proxy works. So `pg_stat_activity`/lock/row-count probes against prod are **not possible from this sandbox** — root-causing a live DB-side issue (lock contention, slow query, table bloat) needs either an AWS ECS exec session or a temporary HTTP-exposed debug endpoint in the app itself. Don't spend time retrying a raw `pg.Client` connection here.
- **`${{shared.*}}` env refs do NOT resolve here** — set literals: `UW_API_KEY` (UUID), `DATABASE_URL`, `REDIS_URL`, `POLYGON_API_BASE`. Working: `POLYGON_API_KEY`, `CLERK_SECRET_KEY`, Clerk publishable key. **Benzinga rides the Polygon key** — the Benzinga news/catalysts feed is served under the same Polygon subscription at `{POLYGON_API_BASE}/benzinga/v2/news?...&apiKey={POLYGON_API_KEY}` (re-verified live 2026-07-13: 200 for `channels=fda|guidance|m&a` and `ticker=NVDA&channels=earnings`). There is **no separate `BENZINGA_API_KEY`**; news fetches live via the Polygon key. (Earlier note claiming the key was missing was stale.)
- Clerk instance requires a **phone number** on user creation; rapid sign-in/token cycles get **FAPI-rate-limited** — authenticate once per run.

## Auth model (quick ref)
- Admin: Clerk `publicMetadata.role === "admin"` (or `ADMIN_EMAILS`). Tier: `publicMetadata.tier` (Whop-driven; 60s cache). `role:admin` bypasses per-tool launch gates.
- Prod audit login: mint Backend-API `sign_in_token` → FAPI `clerk.blackouttrades.com` ticket exchange → `__session` cookie. Documented in `AGENTS.md`.

## Data-correctness notes learned
- Prices: validate app SPY/SPX/VIX against Polygon; SPX ≈ 10× SPY.
- EMA/VWAP logic: `src/lib/providers/ma-math.ts`. Prior-session OHLC: `src/lib/providers/spx-session.ts`.
- Systemic: several endpoints serve unrounded floats (e.g. `7499.360000000001`) — round at the data layer.
