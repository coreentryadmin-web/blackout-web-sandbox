# BIE Evaluation Harness

A committed, repeatable regression gate for **BIE answer quality** — the formalized successor to the
ad-hoc scratchpad probes (`largo-battery-v2.mjs`, `platform-probe.mjs`, `compound-probe.mjs`). It
proves the product is strong and catches regressions as synthesis lands, per **BIE-MASTER-SPEC §7**
("tested against adversarial and ambiguous queries", "observable").

## What it does

1. Signs into **staging** with a fresh Cognito temp admin+premium user (always deleted in a `finally`).
2. Captures **live ground truth** from the clean Vector JSON APIs (`/api/market/vector/walls`,
   `/max-pain`, `/expected-move`) for a set of ticker×horizon combos.
3. Fires the whole **categorized question bank** at Largo (`POST /api/market/largo/query`) over the
   authenticated cookies.
4. **Scores each answer honestly** and writes a JSON scorecard + prints a per-category + honesty
   summary. Exits non-zero on any **hard** failure so CI can gate on it.

## Categories (`question-bank.mjs`)

| Category | What it checks |
|---|---|
| `concept` | definitions (GEX, gamma flip, King node, Night Hawk, …) |
| `numeric` | live values vs captured ground truth (flip / call wall / max pain), within tolerance |
| `routing` | answer **must** be BIE-sourced (`source === "blackout-intelligence"`) |
| `compound` | many-in-one (15 numbered / run-on / terse barrage) → ≥70% of the parts answered |
| `diagnostic` | "why isn't X forming" → explains a real mechanic |
| `synthesis` | verdicts ("is SPX 7500 0DTE good today", "hold NVDA into earnings") reason from real factors |
| `adversarial` | one-word (`GEX?`), vague (`what's going on`), malformed, contradictory → graceful, never fabricated |
| `honesty` | unavailable-not-hidden, **no fabricated numbers**, source attributed |

## Honest scoring (`lib/scoring.mjs`)

Three verdicts, so a correct answer a strict token check would miss is **not** counted as a regression:

- **PASS** — met the expectation (keyword/shape or number within tolerance) with no honesty flags.
- **SOFT** — answered & substantive (≥60 chars) but keyword-missed. **Eyeball it; NOT a regression.**
  Every scorecard row carries the full answer for human adjudication.
- **FAIL** (hard) — a genuine problem: unanswered / HTTP error, a leaked `{{grounding}}` marker, a
  **fabricated** number (a specific in-range value when there's no ground truth and no "unavailable"
  caveat), a **wrong** number (contradicts ground truth), cross-instrument **SPX bleed** on a
  non-SPX numeric ask, or a `routing` answer that didn't come from BIE.

Only hard fails set the non-zero exit code. Honesty aggregates in the summary: BIE-source rate,
`{{}}`-leak count, fabrication count, SPX-bleed, unanswered, misrouted.

The pure scorer is unit-tested with no network: `npm run eval:bie:score-test`.

## Run it

AWS creds **must be unset** so the shared `~/.aws/credentials` profile is used (same convention as
`vector-staging-e2e`):

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY npm run eval:bie
```

Env overrides:

- `STAGING_BASE_URL` (default `https://staging.blackouttrades.com`)
- `STAGING_SECRET_NAME` (default `blackout-staging/app/env`), `AWS_REGION`
- `OUTDIR` — scorecard output dir (default `bie-eval-out/`); scorecard → `bie-eval-out/bie-eval-scorecard.json`
- `ONLY=concept,numeric` — run only the named categories

## Files

- `run.mjs` — orchestrator (auth → ground truth → fire → score → scorecard + exit gate)
- `question-bank.mjs` — the categorized bank + the live-numeric builder
- `lib/scoring.mjs` — pure scoring primitives + per-answer classifier + aggregation
- `lib/scoring.test.mjs` — unit tests for the scorer (`node --test`)
- `lib/staging-auth.mjs` — Cognito temp-user + proxy-route + sign-in + JSON helpers (reused pattern)

## Off-hours note

When the market is closed the Vector APIs may return `null` flips/max-pain — that is expected. Those
numeric items then assert the **honest no-data** path (the answer must say it's unavailable), so the
harness is meaningful both in and out of RTH; it only hard-fails a fabricated value, never a missing one.
