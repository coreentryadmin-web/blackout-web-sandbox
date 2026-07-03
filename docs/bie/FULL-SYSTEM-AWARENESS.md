# BIE Full System Awareness — roadmap and honest status

**The ask (verbatim intent, 2026-07-03):** BIE should have complete operational
awareness of BLACKOUT — logs, infra, APIs, database, alerts, business logic —
and become the platform's operating brain: it should not just answer questions,
it should actively find what's wrong, why, how serious, and what to fix first.
Every number traceable, every calculation reproducible, every rule versioned,
every alert carrying a full audit trail. The model should never invent a fact;
when it lacks validated access to something, it must say so.

This doc is the honest map: what's true today, what ships next with zero new
access, and what genuinely needs a decision or credential from the user. It
follows the same rule the rest of BIE holds itself to — **cite evidence, never
overclaim, say "I don't have that yet" instead of guessing.**

## Already true today (before this doc existed)

These aren't aspirational — they're how the platform has been built since the
pre-BIE audits, and BIE inherits them:

- **Every number traceable to source.** L1 Deterministic: GEX/greeks come from
  Polygon chains, scores/plans/grades come from named pure functions in
  `src/lib/zerodte/`, `src/lib/nighthawk/`. No LLM computes a trading number,
  ever — this predates BIE and BIE's router/composers only ever read from
  these same engines.
- **Calculations are reproducible.** The scoring/plan/grading functions are
  pure, unit-tested, and take the same inputs to the same outputs
  (`board.test.ts`, `bie.test.ts`, `scorer-direction.test.ts`, etc.).
- **Trading rules are versioned.** Git IS the version control for every gate,
  threshold, and formula (`PLAN_RULES`, `SETUP_MIN_AGGR_SHARE`, scorer weights)
  — every change is a commit with a message, in `FINDINGS.md`, and in a PR.
- **The model never invents a number.** L4 Verifier (`src/lib/bie/verifier.ts`)
  extracts every numeric claim Claude makes and checks it against the actual
  tool data served that turn; unverifiable-heavy answers carry an explicit
  caution. This is the closest thing to "say I don't have that yet" already
  built — extending it to say so in plain language for missing *systems* (not
  just missing *numbers*) is a natural next step (see Stage 2 below).
- **Alerts carry SOME audit trail already.** 0DTE setups log `flags_json`
  (why a setup fired: aggression, spike, dominance, gates passed) and
  `plan_outcome`/`plan_pnl_pct` (whether it was later correct). Night Hawk
  plays log dossier scores and post-hoc outcome grading. This is real, but
  it is NOT yet a single unified "input → logic → confidence → output →
  correct?" record across every alert type — that unification is Stage 3 work.

## Stage 1 — SHIPPED: repo, docs, API usage, schemas, configs

- L2 Knowledge: docs/, FINDINGS.md, AGENTS.md/CLAUDE.md, the platform map
  (generated from `TOOLS`/`CRON_JOBS` registries), latest Night Hawk edition —
  ingested daily, embedded (Voyage voyage-3, live as of 2026-07-03), retrieval
  floor evidence-calibrated (`docs/audit/FINDINGS.md`, 2026-07-03 entry).
- L5 platform discovery already read `api_telemetry_events` (third-party API
  latency/failure/rate-limit, by provider+endpoint) — this is real API usage
  monitoring, not aspirational.

## Stage 2 — IN PROGRESS: logs, errors, cron/worker health (zero new access)

Everything below reads tables this app **already writes** — no new
credentials, no new vendor, ships today:

| Item from the ask | Status | Source |
|---|---|---|
| backend API errors | **SHIPPED** (this PR) | `error_events` via `countRecentErrorEvents` — unhandled exceptions, request errors, now in the daily discovery report |
| cron job status / worker failures | **SHIPPED** (this PR) | `cron_job_runs` — last status per job, flags any `failed`, flags any job with no success in 3h+ |
| API rate limits (UW, Polygon, Claude) | **SHIPPED** (Phase 4) | `api_telemetry_events.rate_limited` — per-provider, per-endpoint, already in discovery |
| database query failures | **PARTIAL** | Failed queries that throw ARE captured by `error_events` if the caller uses the error sink; not every `dbQuery` call site does yet — auditing that coverage is next |
| duplicate/incorrect alerts | **PARTIAL** | 0DTE ledger + Night Hawk outcome grading already measure "was this alert later correct" (win/loss); "duplicate" detection is not built |
| frontend errors | **NOT YET** | No browser-side error capture wired to `error_events` today — would need a client-side reporter (e.g. `window.onerror` → a lightweight beacon endpoint). Buildable with zero new vendor, not yet built |
| missed alerts | **NOT YET** | Requires defining "should have fired but didn't" — needs a ground-truth definition first, not just more logging |

## Stage 3 — NEEDS INFRASTRUCTURE ACCESS THIS CODEBASE DOES NOT HAVE

These are genuinely blocked — not because they're hard to code, but because
**the credentials/access don't exist in this environment**, and inventing a
connection without them would violate the "never invent" rule as badly as
inventing a number would:

| Item | Blocker | What it would take |
|---|---|---|
| Railway logs (raw container stdout/stderr) | No Railway API token configured | A Railway API token (project-scoped, read-only for logs is enough) — user decision, like the Voyage key was |
| Railway deployment status/errors | Same | Same token; Railway's GraphQL API exposes deploy status |
| Railway resource usage (CPU/memory) | Same | Same token; Railway exposes per-service metrics via GraphQL |
| Railway environment variables (listing/auditing) | Same, PLUS this is sensitive — should be read-only and never surfaced verbatim (secrets) | Same token; BIE would report *presence/absence* and *staleness*, never values |
| Redis usage / connection pool internals | No Redis `INFO`/`CLIENT LIST` introspection wired | Buildable with zero new access (Redis is already connected) — genuinely just not built yet, unlike the Railway items |
| Postgres connection pool saturation | **SHIPPED** (live snapshot, `/api/admin/bie-report` `db_pool`) | `getDatabasePoolStats()` (already existed in `db.ts`, used by `admin-api-dashboard.ts`/`market-health.ts`) — now surfaced in the BIE panel too, with a visual flag when `waiting > 0` (queueing pressure) |
| Postgres slow-query log (`pg_stat_statements`) | NOT YET | Not confirmed enabled on the Railway instance; a genuinely separate piece from pool stats |
| Redis internals (memory, key count, connected clients, uptime) | **SHIPPED** (live snapshot, `/api/admin/bie-report` `redis`) | `src/lib/redis-health.ts` — a dedicated diagnostic-only client (mirrors `uw-shared-cache.ts`'s isolation pattern, never touches the general-purpose cache path), one-shot `INFO`+`DBSIZE` then disconnect |
| Clerk/UW/Polygon spend dashboards | Those are billing dashboards on the vendor's side, not an API we call | Would need each vendor's usage/billing API if they expose one — separate research per vendor, not assumed to exist |
| Security warnings / auth failure monitoring | Clerk logs auth events on Clerk's side; we don't currently mirror failures into our own telemetry | Buildable: hook Clerk webhook events (already have webhook infra) into `error_events` or a new table |

**The honest line:** Redis internals, Postgres pool stats, and Clerk
auth-failure mirroring are Stage 2-equivalent (buildable now, just not done).
Railway logs/deploys/resources/env vars are Stage 3-blocked on a credential
only the user can provide — same pattern as the Voyage key.

## Stage 4 — Unified audit trail per alert (design work, not yet started)

The ask specifies a full audit trail per alert: input data, calculation
logic, decision logic, confidence score, timestamp, source API, rate-limit
status, final output, why it fired, and whether it was later correct. Today
this exists in *pieces* (0DTE `flags_json` + outcome grading, Night Hawk
dossier + outcome grading) but not as one **unified schema** every alert type
writes to. Building that unified schema, migrating existing alert types onto
it, and exposing it as queryable evidence is real design work — not a bug fix,
a new cross-cutting data model. Scoping this properly is the next planning
task, not a same-night patch.

## Stage 5 — BIE opens PRs autonomously

Explicitly the end state, explicitly not now. Everything BIE ships today is
**report-first**: calibration recommendations are evidence-cited text a human
reads and ships (`calibration.ts` — "never tunes on noise"); discovery
findings are the same. The infrastructure for BIE to open its own PRs would
reuse this session's own agent tooling, but doing that safely needs Stage
3-4 maturity first (a real confidence-scoring and incident-severity model) —
premature at Stage 2.

## What "never invent a fact" means in code, concretely

- `searchKnowledge` returns `[]` (not a guess) when nothing clears the
  similarity floor or the key isn't configured.
- `runBieDiscovery`/`runBieCalibration`/`runBieDailySelfEval` all return
  `null` on any failure — callers already treat `null` as "no report," never
  synthesize one.
- The router (`classifyBieIntent`) returns `null` (falls through to Claude)
  the moment a question is ambiguous — it does not guess an intent.
- The verifier flags unverifiable numeric claims rather than passing them
  through silently.
- This doc itself: every "NOT YET" and "BLOCKED" above is the literal
  "I do not have validated access to that data source yet" the ask requires
  — written down once, so BIE's own knowledge-layer ingestion of this file
  means a future question like "does BIE see Railway logs?" retrieves this
  honest answer instead of the router inventing one.
