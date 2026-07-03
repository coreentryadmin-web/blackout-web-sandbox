# BLACKOUT Intelligence Engine (BIE)

**Mission:** the institutional brain of BLACKOUT — a continuously improving intelligence
system where every number is deterministic and traceable, most questions are answered
without any LLM, and external models (Claude) are the general-reasoning *fallback*, not
the foundation. Not a chatbot. An intelligent operating system.

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

## The five layers

| Layer | What | Status |
|---|---|---|
| **L1 Deterministic** | Every number from verified calculation engines — greeks/GEX (Polygon chains), scorers, plan math, grading. No LLM ever computes a figure. | LIVE (platform law since the audits; 0DTE stack fully deterministic) |
| **L2 Knowledge** | Structured, searchable domain + platform knowledge (portable JSONB embeddings, cosine in Node; Voyage `voyage-3`). Docs, FINDINGS, editions, platform map, self-evals. | **LIVE** (VOYAGE_API_KEY provisioned 2026-07-03; cold chunks backfill automatically, #295) |
| **L3 Reasoning/Router** | Deterministic answer router: questions that map onto platform truth are answered instantly from source-of-truth readers — no LLM, no cost, zero hallucination. Ambiguous/reasoning questions → Claude with retrieved grounding. | **Phase 1 — SHIPPED** (`src/lib/bie/router.ts`, `composers.ts`) |
| **L4 Self-evaluation** | Numeric-claim verifier: every figure in an LLM answer is matched against the data actually served that turn; unverified-heavy answers carry an explicit caution. Same philosophy as Night Hawk's grounding gates. | **Phase 1 — SHIPPED** (`src/lib/bie/verifier.ts`) |
| **L5 Learning** | Outcome-graded feedback: daily self-eval report (coverage/verification/cost avoided), 14-day calibration harness (score-band/ToD/spike buckets → evidence-cited gate recommendations, report-first, never tunes on noise), telemetry discovery report (slow/failing/expensive call patterns, application errors, cron/worker health) — all persisted into the knowledge store on the daily cron tick. | **SHIPPED**, expanding — see `docs/bie/FULL-SYSTEM-AWARENESS.md` |

## Phase 1 (shipped in this PR)

1. **Router** — `classifyBieIntent` (pure, conservative: unsure → Claude) routes:
   today's-plays, ledger-ticker play state, SPX structure, market context. Composers
   assemble markdown from the same readers the dashboards use. Wired into BOTH
   `runLargoQuery` and `runLargoQueryStream` ahead of any Anthropic call; any router
   error falls through — Claude is never blocked. Answers carry
   `source: "blackout-intelligence"`, static follow-ups (no Haiku call), and persist
   into the session like any turn.
2. **Verifier** — captures every tool result Claude sees during a turn, extracts the
   answer's numeric claims (skipping years/counts), matches with 0.5% tolerance plus
   desk-taught derivations (2×/half for the +100%/−50% rules, %↔fraction), appends a
   caution when ≥4 claims and <50% traceable.
3. **Ledger** — `bie_interactions`: question, intent, answer_source (`bie-router` |
   `claude`), claim counts, latency. Router coverage %, verification rate, and cost
   avoided are queryable from day one.

## Metrics that define success (queryable, not vibes)

- Router coverage: % of Largo turns answered internally (target: grow 0 → 50 → 80%+ as
  intents are added; NEVER at the cost of a wrong route — a missed route costs one
  Claude call, a wrong route costs trust).
- Verification rate: % of Claude-answer figures traceable to turn data.
- Cost avoided: routed turns × avg Claude turn cost.
- Play calibration: 0DTE ledger hit-rate by score band / aggression / time-of-day →
  gate adjustments with evidence.

## Phase plan

- **Phase 2 — Knowledge: SHIPPED + ACTIVE** (VOYAGE_API_KEY provisioned
  2026-07-03). Ingestion (docs/, FINDINGS, AGENTS/CLAUDE, latest NH edition,
  generated platform map) runs daily, hash-deduped BEFORE embedding so unchanged
  content is free — and chunks stored cold before the key existed are backfilled
  (#295); retrieval grounds the Claude fallback.
- **Phase 3 — Learning loops: SHIPPED.** Daily self-eval (router coverage, Claude
  calls avoided, verification rate, session W/L) + 14-day calibration harness
  (evidence-cited gate recommendations at n≥10 per bucket; report-first) + the router
  eval set living in CI (`bie.test.ts` — no route change ships without it passing).
- **Phase 4 — Platform intelligence + distillation:** platform-map ingestion and the
  daily telemetry discovery report (slowest/most-failing/most-expensive call
  patterns) are SHIPPED. Remaining Phase-4 items are DATA-GATED by design: knowledge
  Q&A router intents (needs the embeddings key + corpus), and optional small-model
  distillation (needs months of graded interactions + a buy decision).

## Purchases / external dependencies (honest list)

| Item | Needed for | Cost ballpark | When |
|---|---|---|---|
| Embeddings API key (Voyage AI `voyage-3`) | Phase 2 retrieval | ~$0.06 / M tokens — trivial (est. <$1/mo at our corpus size) | **PROVISIONED 2026-07-03** (`VOYAGE_API_KEY` on Railway) |
| ~~pgvector extension~~ | ~~Phase 2 store~~ | not needed — shipped with portable JSONB embeddings + cosine in Node (corpus is thousands of chunks, not millions) | — |
| Open-weight inference host (Together/Fireworks per-token, or GPU rental) | Phase 4 distillation ONLY | $0 until used | Deferred — decide with data |
| New market-data APIs | — | none needed: Polygon + UW + Benzinga cover the domain | — |

Claude (existing) remains the paid general-reasoning fallback; its usage shrinks as
router coverage grows — that is the dependency-reduction curve, delivered safely.
