# BIE Stage 4 — unified per-alert audit-trail schema (design)

**Status:** design doc, not yet implemented. Scoping this properly per the
standing instruction ("real design work, not a same-night patch") before
writing any migration or write-path code.

## The ask

From `docs/bie/FULL-SYSTEM-AWARENESS.md` Stage 4: every alert (0DTE flag,
Night Hawk play) should carry a full, queryable audit trail — input data,
calculation logic, decision logic, confidence score, timestamp, source API,
rate-limit status at decision time, final output, why it fired, and whether
it was later correct. Today this exists in *pieces*, one schema per product,
with different column names and no shared query surface.

## What exists today (read directly from the schema, not guessed)

**0DTE (`zerodte_setup_log`, `src/lib/db.ts:535`)** — one row per
`(session_date, ticker)`, upserted as the tape evolves:
- Decision inputs/output already columnar: `score`/`score_max` (deterministic
  gate score), `dossier_score`, `conviction`, `gross_premium`, `spike`,
  `underlying_at_flag`/`underlying_latest`.
- `flags_json` (`zerodte/scan.ts:288`) — a free-form "why it fired" bag:
  `earnings`, `news_hot`, `halted`, `fib`, `dossier_agrees`. This is the
  closest existing thing to a decision trace, but it's assembled ad hoc at
  the call site, not a structured list of {check, passed, value, threshold}.
- `plan_json` — the contract plan (entry/exits) actually shown to members.
- Grading: `plan_outcome`, `plan_pnl_pct`, `direction_hit`, `graded_at` —
  the "was this later correct" half already exists, columnar.
- No input-data snapshot (what UW/Polygon values were read at flag time
  beyond what's implicitly baked into the score), no source-API/rate-limit
  attribution.

**Night Hawk (`nighthawk_editions` + `nighthawk_play_outcomes`,
`src/lib/db.ts:420,438`)** — edition-level `plays` JSONB (published payload,
one array per day) plus a separate per-ticker outcomes table:
- `nighthawk_play_outcomes`: `score`, `conviction`, `direction`, entry/target/
  stop, and the full grading half (`hit_target`, `hit_stop`, `outcome`
  CHECK-constrained to `target|stop|open|ambiguous|pending|unfilled`).
- The dossier build (`nighthawk/dossier.ts`) computes a deterministic score
  server-side (`pinnedScore`, per `fix/nh-publish-gates`) before any model
  self-grade can touch it — real decision logic, but the intermediate
  factor-by-factor breakdown (news/institutional/dark-pool/OI/congress
  weights) is discarded after scoring, not persisted.
- Publish-time geometry validation (`validatePlayGeometry()`) already acts
  as a hard decision gate (drop on bad entry/target/stop) but the gate
  *result* (why a candidate was dropped) isn't logged anywhere queryable —
  only survivors reach the tables above.

**Both products already log the two hardest fields for free** (deterministic
confidence score, later-correct outcome) — the gap is everything in between:
a structured decision trace, an input snapshot, and source-API attribution.

## Proposed schema

One new **additive** table, `alert_audit_log` — does not replace
`zerodte_setup_log` or `nighthawk_play_outcomes`, which stay the system of
record for their own UI/grading logic (near-zero blast radius: no existing
reader changes). This table is BIE's/admin's unified cross-product query
surface, written alongside the existing per-product writes.

```sql
CREATE TABLE alert_audit_log (
  id BIGSERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,        -- 'zerodte' | 'nighthawk'
  source_table TEXT NOT NULL,      -- 'zerodte_setup_log' | 'nighthawk_play_outcomes'
  source_key JSONB NOT NULL,       -- {"session_date":"2026-07-06","ticker":"AAPL"} — the source PK, so a row is always traceable back
  ticker TEXT NOT NULL,
  direction TEXT,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- decision
  confidence_score NUMERIC,        -- the DETERMINISTIC score (score/score_max or pinnedScore) — never a model self-grade
  confidence_label TEXT,           -- conviction letter/tier, human-facing
  trigger_reason TEXT,             -- short human summary ("earnings + dossier agrees + spike")
  decision_trace JSONB,            -- ordered [{check, passed, value, threshold}], gate-by-gate

  -- evidence
  input_snapshot JSONB,            -- the specific values read at decision time (flow prints, greeks, price) — not the whole tool payload
  source_apis JSONB,               -- [{provider, endpoint, rate_limited, ok}] — see attribution strategy below
  final_output JSONB,              -- the actual member-visible payload (plan_json / play entry)

  -- outcome (materialized copy — source of truth stays the per-product grading columns)
  outcome TEXT,                    -- mirrors plan_outcome / nighthawk outcome
  outcome_graded_at TIMESTAMPTZ,
  later_correct BOOLEAN,           -- derived, nullable until graded

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alert_audit_log_fired ON alert_audit_log(fired_at DESC);
CREATE INDEX idx_alert_audit_log_ticker ON alert_audit_log(ticker, fired_at DESC);
CREATE INDEX idx_alert_audit_log_type ON alert_audit_log(alert_type, fired_at DESC);
```

Every field maps 1:1 to an item in the original ask (input data →
`input_snapshot`, calculation/decision logic → `decision_trace`, confidence
score → `confidence_score`/`confidence_label`, timestamp → `fired_at`,
source API/rate-limit → `source_apis`, final output → `final_output`,
trigger reason → `trigger_reason`, later-correct → `later_correct`).

## The one genuinely hard part: `source_apis` attribution

`api_telemetry_events` (`db.ts:642`) already records every provider call
with `rate_limited`/`ok`/`correlation_id` — but `correlation_id` today is
generated **per HTTP call** (`api-tracked-fetch.ts:69`,
`` `corr-${Date.now()}-${random}` ``), not per alert-decision. Two options,
explicitly not both needed at once:

- **4a (zero call-site changes, ship first):** best-effort time-window join
  — query `api_telemetry_events` for the alert's `ticker` appearing in
  `request_url` within a short window before `fired_at`. Approximate
  (misses calls whose URL doesn't embed the ticker, e.g. a batched
  market-tide pull), but costs nothing to build and is honest about being
  approximate (`source_apis` would carry a `best_effort: true` flag).
- **4b (exact attribution, real blast radius):** thread a shared
  `correlationId` through every UW/Polygon/Benzinga call made during one
  alert's data-gathering phase (`trackedFetch(..., {correlationId})` — the
  option already exists on the fetch wrapper, just unused by callers today).
  Touches every provider call site inside `zerodte/scan.ts` and
  `nighthawk/dossier.ts`. Exact, but a much larger diff to review safely.

Recommendation: ship 4a with the table (cheap, honest about its own
approximation), leave 4b as a named follow-up if 4a's approximate join
proves too lossy in practice — don't guess which one is needed before
seeing real data.

## Rollout (one issue per PR, per the standing policy)

1. **This PR:** design doc only (no code).
2. **Schema PR:** `CREATE TABLE alert_audit_log` + indexes in `db.ts`'s
   existing advisory-locked migration block. Zero consumers yet — purely
   additive, cannot regress anything by construction.
3. **0DTE write-path PR:** `persistZeroDteScan` writes one `alert_audit_log`
   row alongside its existing `zerodte_setup_log` upsert, populating
   `decision_trace` from the same gate checks the scanner already computes
   (`SETUP_MIN_AGGR_SHARE` etc.) instead of only their pass/fail residue in
   `flags_json`.
4. **Night Hawk write-path PR:** dossier build writes one row per published
   play (survivors) AND one per `validatePlayGeometry()` rejection (so
   "why didn't X publish" becomes queryable, not just "why did Y publish").
5. **Query surface PR:** extend `/api/admin/bie-report` with an
   `audit_trail` block (recent rows, source-API attribution coverage %) —
   only after there's real data to show.

Explicitly out of scope for Stage 4: **missed-alert detection** (needs a
ground-truth "should have fired" definition first — logging more about
alerts that DID fire doesn't help find ones that should have but didn't)
and **duplicate-alert detection** (a distinct dedup-key design problem).
Both stay `NOT YET` in `FULL-SYSTEM-AWARENESS.md`.
