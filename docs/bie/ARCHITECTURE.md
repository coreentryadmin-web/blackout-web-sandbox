# BLACKOUT Intelligence Engine (BIE)

**Mission:** the institutional brain of BLACKOUT — a continuously improving intelligence
system where every number is deterministic and traceable, most questions are answered
without any LLM, and external models (Claude) are the general-reasoning *fallback*, not
the foundation. Not a chatbot. An intelligent operating system.

**BIE is not a server or a message bus.** It is a set of plain TypeScript modules under
`src/lib/bie/*` that export async functions. Three things import them directly: Largo's
tool dispatcher (`src/lib/largo/run-tool.ts`), the admin report route
(`/api/admin/bie-report`), and a couple of dashboard routes (0DTE board echo). There is no
network hop between "BIE" and its callers — it is a library, not a service, so nothing
depends on a separate BIE process being up.

**A note on how this doc stays honest:** this file only holds things that need human
judgment — mission, philosophy, what's authorized. It deliberately does NOT enumerate
BIE's exact tool list, ecosystem-context fields, or rollout-stage detail, because a
hand-typed inventory is exactly what went stale before: this doc described only the very
first BIE PR for weeks while a dozen more tools shipped, and Largo repeated that stale
description to a member (`docs/audit/FINDINGS.md`, 2026-07-04). That inventory is now
**generated at ingestion time straight from source** — `ingestBieKnowledge()`
(`src/lib/bie/knowledge.ts`) builds a `platform:bie-capabilities` knowledge chunk by
reading `tool-defs.ts`'s actual tool descriptions and `ecosystem-context.ts`'s actual field
list on every run, so it cannot drift out of sync with the code the way prose can. Full
current-state detail (Stage 2-5 evidence, what's blocked and why) lives in
`docs/bie/FULL-SYSTEM-AWARENESS.md`, which gets the same nightly re-ingestion.

## Honest realism (read this first)

- **We do NOT train our own frontier LLM.** Pretraining or live weight-updates
  ("train every second") costs 8-9 figures in compute plus a research team, and no
  serious lab updates weights live in production — it is how models get corrupted.
- **We DO get "learning every minute"** — through knowledge and calibration updates:
  every scan, every graded play, every verified/unverified claim, every interaction
  becomes structured data that measurably changes behavior. Auditable, reversible,
  and honest.
- **The trust goal, correctly framed:** not "a model no one can question" but a system
  where every claim is so traceable that questioning it is EASY — and it survives.
- **Phase 4 (optional, data-gated):** fine-tune a small open-weight model on months of
  accumulated, outcome-graded Q&A. Only sensible once the data exists; by then it is
  cheap. Claude remains the fallback for open-ended reasoning either way.
- **BIE never invents a correctness verdict.** Accuracy comes from validation systems,
  audit trails, deterministic calculations, and source-of-truth checks — all plain code,
  independently verifiable. BIE's job is to detect, explain, rank, and (as of Stage 5
  step 1) *propose* — never to decide on its own that something is correct, and never,
  today, to act on that proposal itself.
- **The one standing authorization boundary:** Stage 5's end state (BIE opening its own
  PRs) is NOT built and NOT authorized — only step-1 dry-run text proposals are live, and
  they never write a file, run git, or call the GitHub API. Stage 6 (using outcome data to
  actually calibrate live scoring) is NOT started and NOT authorized — every precursor
  measurement is read-only. Both require their own explicit decision, not inferred from
  general enthusiasm about BIE.

## The five layers

| Layer | What | Status |
|---|---|---|
| **L1 Deterministic** | Every number from verified calculation engines — greeks/GEX (Polygon chains), scorers, plan math, grading. No LLM ever computes a figure. | LIVE (platform law since the audits; 0DTE stack fully deterministic) |
| **L2 Knowledge** | Structured, searchable domain + platform knowledge (portable JSONB embeddings, cosine in Node). Docs, FINDINGS, editions, the generated platform map, and the generated BIE capabilities inventory (see note above). Ingested nightly via the `db-cleanup` cron — a doc fix propagates to Largo's retrieved grounding on the next ~3 AM ET run, not instantly. | **LIVE** (VOYAGE_API_KEY provisioned 2026-07-03; cold chunks backfill automatically) |
| **L3 Reasoning/Router** | Deterministic answer router: questions that map onto platform truth are answered instantly from source-of-truth readers — no LLM, no cost, zero hallucination. Ambiguous/reasoning questions → Claude with retrieved grounding plus Largo's full tool surface, growing as more instruments get a query surface. | **Phase 1 — SHIPPED** (`src/lib/bie/router.ts`, `composers.ts`); a handful of hand-tuned intents (today's-plays, ledger-ticker play state, SPX structure, market context) — unsure always falls through to Claude, on purpose |
| **L4 Self-evaluation** | Numeric-claim verifier: every figure in an LLM answer is matched against the data actually served that turn; unverified-heavy answers carry an explicit caution. Same philosophy as Night Hawk's grounding gates. | **Phase 1 — SHIPPED** (`src/lib/bie/verifier.ts`) |
| **L5 Learning** | Outcome-graded feedback: daily self-eval report, 14-day calibration harness (evidence-cited gate recommendations, report-first, never tunes on noise), telemetry discovery report (slow/failing/expensive call patterns, application + infra health) — all persisted into the knowledge store on the daily cron tick. | **SHIPPED**, expanding — full rollout history in `docs/bie/FULL-SYSTEM-AWARENESS.md` |

## Cross-instrument awareness — the ecosystem-context line

Every instrument (0DTE Command, Night Hawk, HELIX flow, the regime detector) already
writes its own findings into shared Postgres. Nothing used to let one instrument — or a
member asking Largo a question — see what another instrument already found.
`src/lib/bie/ecosystem-context.ts`'s `fetchEcosystemContext(ticker)` is that shared read
layer: one function, one ticker, a cross-instrument snapshot spanning today's 0DTE take,
the most recent published Night Hawk take, the unified alert audit trail, recent options
flow, pattern-detected flow anomalies, and whether the live flow pipeline is actually up
right now (so silence can be reported as "unknown" instead of "quiet" when it's really an
outage). Fails open to an all-empty context on any error, by design — a lookup failure
here must never block whatever else Largo or a dashboard was already doing.

Complementary reads exist for a whole ticker list (which names Night Hawk already picked),
a market-wide "what's hot" leaderboard, a market-regime backdrop (the same signal Night
Hawk's own scoring already reads internally), and a platform-track-record measurement of
whether instruments agreeing with each other actually correlates with a better hit rate
(read-only — a Stage 6 precursor, never feeds back into live scoring). All of the above are
wired into Largo as tools and into `/api/admin/bie-report` so the admin dashboard shows the
same signals structurally. **For the exact current tool names, descriptions, and field
list, read the generated `platform:bie-capabilities` knowledge chunk** — see the note at
the top of this doc for why that's generated rather than typed here.

## Platform self-awareness — Stages 2 through 6

Full rollout history and evidence: `docs/bie/FULL-SYSTEM-AWARENESS.md`. In short: Stage 2
(logs, errors, cron/worker health, duplicate/missed-alert detection) and Stage 3 (Railway,
Postgres, Redis, Clerk-auth infra access) are both fully shipped, using zero or
newly-provisioned credentials respectively. Stage 4 (one unified audit-trail schema every
alert type writes to) is shipped end to end across all three write-paths. Stage 5 step 1
(dry-run, read-only proposals) is shipped; Stage 5's actual end state and Stage 6 entirely
are explicitly not — see the authorization boundary above. All of it is surfaced live in one
place: `GET /api/admin/bie-report` (admin-only) computes every Layer-5 report on demand
plus every Stage 2-5 probe, so "what is BIE seeing right now" is one authenticated request,
never a wait for a cron.

## Phase 1 (router/verifier/ledger — foundation the rest of this doc builds on)

1. **Router** — `classifyBieIntent` (pure, conservative: unsure → Claude) routes a small
   set of high-confidence intents. Composers assemble markdown from the same readers the
   dashboards use. Wired into BOTH `runLargoQuery` and `runLargoQueryStream` ahead of any
   Anthropic call; any router error falls through — Claude is never blocked. Answers carry
   `source: "blackout-intelligence"`, static follow-ups (no Haiku call), and persist into
   the session like any turn.
2. **Verifier** — captures every tool result Claude sees during a turn, extracts the
   answer's numeric claims (skipping years/counts), matches with 0.5% tolerance plus
   desk-taught derivations (2×/half for the +100%/−50% rules, %↔fraction), appends a
   caution when ≥4 claims and <50% traceable.
3. **Ledger** — `bie_interactions`: question, intent, answer_source (`bie-router` |
   `claude`), claim counts, latency. Router coverage %, verification rate, and cost
   avoided are queryable from day one.

## Metrics that define success (queryable, not vibes)

- Router coverage: % of Largo turns answered internally (grow over time; NEVER at the cost
  of a wrong route — a missed route costs one Claude call, a wrong route costs trust).
- Verification rate: % of Claude-answer figures traceable to turn data.
- Cost avoided: routed turns × avg Claude turn cost.
- Play calibration: 0DTE ledger hit-rate by score band / aggression / time-of-day →
  gate adjustments with evidence.

## Purchases / external dependencies (honest list)

| Item | Needed for | Cost ballpark | When |
|---|---|---|---|
| Embeddings API key (Voyage AI `voyage-3`) | Phase 2 retrieval | ~$0.06 / M tokens — trivial (est. <$1/mo at our corpus size) | **PROVISIONED 2026-07-03** |
| ~~pgvector extension~~ | ~~Phase 2 store~~ | not needed — shipped with portable JSONB embeddings + cosine in Node (corpus is thousands of chunks, not millions) | — |
| Open-weight inference host (Together/Fireworks per-token, or GPU rental) | Phase 4 distillation ONLY | $0 until used | Deferred — decide with data |
| New market-data APIs | — | none needed — existing providers cover the domain | — |

Claude (existing) remains the paid general-reasoning fallback; its usage shrinks as
router coverage grows — that is the dependency-reduction curve, delivered safely.
