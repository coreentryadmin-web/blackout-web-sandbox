# BIE Master Spec — the core intelligence engine of BlackOut

> **Reframe (canonical):** BIE is not a chatbot, sidebar assistant, or decorative AI layer.
> It is the platform's central **decision-intelligence engine** — the analytical brain the
> chart, terminal, flow, key levels, analytics, alerts, journal, replay, and every future
> data source feed into. It converts raw platform data into precise, actionable, transparent
> intelligence. Every future build is measured against this document.

This spec is a *system* description, not a prompt. The model (where used at all) **coordinates**
these subsystems; it does not compute values itself. On **staging, Claude is fully OFF** — the
entire pipeline below is deterministic; an LLM planner is at most an optional prod-only tier.

---

## 1. The reasoning pipeline (every substantial query runs this)

A repeatable, evidence-driven process — not indicator summarization:

1. **Intent classification** — market status / directional bias / level analysis / setup
   validation / entry planning / position management / risk eval / options-flow interpretation /
   education / historical analysis / platform action / post-trade review.
2. **Entity extraction** — ticker, instrument, expiration, strike, direction, timeframe,
   session, requested indicators, user constraints, and **every individual sub-question**.
3. **Data collection** — retrieve from the *minimum relevant* internal services (don't call
   everything); widen when the question demands depth.
4. **Data-quality validation** — freshness, timestamp alignment, missing feeds, delayed values,
   conflicting sources, unsupported metrics, stale calcs. **Never present stale/unavailable data
   as live.**
5. **Analytical synthesis** — combine technical + derivatives + volatility + liquidity +
   market-context evidence; explain how signals *interact*, not a disconnected list.
6. **Scenario construction** — where apt: bull / base / bear, each with trigger, confirmation,
   invalidation, target zones, primary risks.
7. **Confidence calibration** — High / Moderate / Low / Insufficient-evidence, based on
   evidence quality + confluence (not arbitrary %). State what raises/lowers it.
8. **Response generation** — structured to the request, depth matched to merit, not a template.

## 2. The engine roster (BIE's deterministic "friends")

The coordinator fans out to these in **parallel** (`Promise.allSettled` + per-friend timeout,
request-scoped ledger, fail-open honest gather). Status is honest as of this writing.

| Engine | Role | Status |
|---|---|---|
| Intent router | classify → route | ✅ built (`bie/router.ts`) |
| Multi-question decomposer | split N sub-questions, fan out, synthesize | ✅ built (`bie/decompose.ts`, `composeCompound`) |
| Universal read-access | any governed internal API / UW / Polygon (read-only) | ✅ built (route-registry, `call_internal_api`, `get_uw`, `get_polygon`, `universal_lookup`) |
| Technical-analysis engine | VWAP/AVWAP/bands, VP/POC/VAH/VAL, OR, PDH/PDL/PDC, HOD/LOD, ONH/ONL, pivots, fibs, RSI, MACD, ATR, RVOL, structure, trend strength, S/R | ✅ core built (`vector-technicals`, server technicals); ⏳ AVWAP/VP/ATR/RVOL gaps |
| Options-flow engine | sweeps, premium velocity, OI, vol/OI, call/put walls, strike activity | ✅ built (Helix / UW flow) |
| Gamma engine | GEX, gamma flip, zero-gamma, dealer positioning, VEX/DEX/CHARM | ✅ built (`polygon-options-gex`, positioning) |
| Liquidity / dark-pool engine | dark-pool prints, liquidity clusters | ✅ built (`vector-dark-pool-levels`); ⏳ wire into shared ctx |
| Volatility engine | expected move, IV, IV rank, VIX/term structure | ✅ core built; ⏳ unify |
| Statistical engine | historical analogues, precedent win-rates, breadth | ⏳ partial (`precedent-search`, confluence outcomes) |
| Scenario engine | bull/base/bear + trigger/confirm/invalidation | ⏳ planned (#59) |
| Risk engine | position/expiry-aware risk, invalidation, sizing | ⏳ partial (play-constraints) |
| Cross-tool synthesis / verdict | "is 7500 0DTE good today" across ALL tools → graded verdict | 🔨 building (#59) |
| Self-diagnosis / ops-awareness | "why isn't NVDA GEX / MSFT beads forming" from real ops signals | 🔨 building (#56) |
| News / earnings | Benzinga-via-Polygon (LIVE under Polygon key), earnings, catalysts, ratings | ⏳ wire as friend (#60), ticker-filtered |
| Conversation memory | active ticker/timeframe/position/entry/stop/target/prior-analysis; bounded | ⏳ harden (session_id exists) |
| Response planner | depth-matching (one-word → deep dive), section structuring | ⏳ planned |
| Data-quality validator | freshness/staleness/missing-feed gating before conclusions | ⏳ planned (honesty spine) |
| Citation / provenance | source labels + timestamps; fact vs calc vs inference vs scenario | ⏳ partial (grounding); formalize |
| Evaluation framework | adversarial/ambiguous probe batteries, scored | ⏳ partial (battery/probe scripts) |
| Observability / tracing | per-request friend ledger + gap-log, diagnosable failures | ⏳ partial (gap-logger) |
| Platform command execution | navigate/open panels/add AVWAP/highlight levels (authorized writes only) | ⏳ planned (read-only today) |

## 3. Query-handling contract

Robust from a **single word / ticker / vague question** to a **direct trading question / chart
request / multi-part query / 20+ questions / long unstructured stream**. BIE must:

1. Understand true intent · 2. Detect **every** separate request · 3. Break into tasks ·
4. Prioritize · 5. Gather relevant data · 6. Analyze each part · 7. Connect findings ·
8. Flag contradictions/missing data · 9. One complete organized answer · 10. State uncertainty.

**Never** ignore later parts, answer only the first question, or give a generic answer when the
platform has relevant data. End a multi-part answer by verifying every question was addressed.

**Depth matches merit.** `SPX trend?` → fast: bias + key evidence + invalidation + major levels.
A ten-clause analytical request → full multi-stage analysis across every relevant source. Don't
overcomplicate simple, don't oversimplify complex.

## 4. Honesty & provenance (non-negotiable)

Distinguish: confirmed fact · calculated value · model inference · historical tendency ·
probabilistic scenario · missing data · user assumption. **Never fabricate** live prices, flow,
gamma, dark-pool, news, probabilities, historical stats, or indicator values. When a source is
unavailable, say what's missing and continue with the analysis still possible — **never silently
omit a failed source**. Decision support, not false certainty: prefer *"structure favors
continuation above X, thesis weakens below Y"* over *"it will rally."* Every directional
conclusion carries evidence + trigger + invalidation + alternative scenario.

## 5. Reasoning quality bar (the target)

Not a list of readings — an explanation of how signals interact. Example:

> *Price is above VWAP, but the move lacks confirmation: cumulative flow is weakening, the call
> wall sits directly overhead, and breadth isn't supporting continuation.*

## 6. Visual dominance (UI program — separate workstream)

BIE should feel like the central OS of BlackOut: large, fast, persistent, context-aware,
integrated with chart + terminal. Full-screen mode; expandable analysis cards; inline charts;
key-level tables; bull/base/bear scenario cards; evidence panels; confidence indicators; data
timestamps + source labels; follow-up suggestions; streaming responses; cancel/regenerate;
conversation history; saved + shareable analysis. It references/highlights chart levels and can
open relevant panels. **Not a small chat box.** *(Large frontend program; tracked separately.)*

## 7. Non-negotiable quality requirements

Answer every part · freshest data · never silently omit failed sources · never invent values ·
separate evidence from interpretation · preserve context across follow-ups · handle malformed/vague
prompts · scale one-word→deep-dive · fast for simple, deep for complex · explain conclusions ·
include invalidation · useful to beginners and pros · no boilerplate · tested against adversarial
+ ambiguous queries · observable so failures diagnose.

## 8. Phased roadmap (honest)

- **Phase 0 — foundation (DONE):** Claude→BIE swap, concept/glossary layer, universal read-access
  (APIs + UW + Polygon, governed), 24/7 platform feed, honesty fixes (no `{{}}` leaks, no 502s,
  gap-logger), **decomposition engine** (15-in-1).
- **Phase 1 — analytical brain (IN FLIGHT):** cross-tool **synthesis/verdict** engine (#59),
  **self-diagnosis** (#56), wire **all tools** into the shared ecosystem incl. live news (#60),
  **de-Claude** the last holdout — Night Hawk deterministic play generation (#61).
- **Phase 2 — pipeline hardening:** explicit **data-quality validator** + **provenance/citation**
  layer, **scenario** + **risk** engines, **response planner** (depth-matching), **conversation
  memory** hardening, **evaluation framework** + **observability/tracing**.
- **Phase 3 — completeness:** technical-engine gaps (AVWAP, volume profile, ATR, RVOL, breadth),
  statistical analogues, historical-comparison ("compare today vs last 5 trend days").
- **Phase 4 — visual dominance:** the UI program in §6.
- **Phase 5 — command execution:** authorized platform actions (add AVWAP, open panels, set alerts).

Each slice ships as a small verified PR and is proven against adversarial live probes
(`scripts`/scratchpad batteries) — never declared done prematurely. Numeric accuracy is confirmed
during RTH.
