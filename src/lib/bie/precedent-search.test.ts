import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeAuditRow } from "./precedent-search";
import type { AlertAuditTrailRow } from "@/lib/db";

const base: AlertAuditTrailRow = {
  id: 1,
  alert_type: "zerodte",
  ticker: "NVDA",
  direction: "long",
  fired_at: "2026-07-01T14:30:00.000Z",
  confidence_score: 82,
  confidence_label: "high",
  trigger_reason: "aggression spike",
  outcome: "target",
};

test("describeAuditRow: cites every real field, fabricates nothing", () => {
  const d = describeAuditRow(base);
  assert.match(d, /0DTE Command/);
  assert.match(d, /NVDA/);
  assert.match(d, /long/);
  assert.match(d, /high conviction/);
  assert.match(d, /score 82/);
  assert.match(d, /aggression spike/);
  assert.match(d, /Outcome: target\./);
});

test("describeAuditRow: null direction reads as 'no stated direction', not 'null'", () => {
  const d = describeAuditRow({ ...base, direction: null });
  assert.match(d, /no stated direction/);
  assert.doesNotMatch(d, /\bnull\b/i);
});

test("describeAuditRow: missing outcome reads as 'not yet graded'", () => {
  const d = describeAuditRow({ ...base, outcome: null });
  assert.match(d, /Outcome: not yet graded\./);
});

test("describeAuditRow: nighthawk_rejected alert_type gets its own label", () => {
  const d = describeAuditRow({ ...base, alert_type: "nighthawk_rejected" });
  assert.match(d, /Night Hawk \(rejected at the publish gate\)/);
});

test("describeAuditRow: unknown alert_type falls back to the raw value rather than throwing", () => {
  const d = describeAuditRow({ ...base, alert_type: "future_instrument" });
  assert.match(d, /future_instrument/);
});

test("describeAuditRow: no confidence_label or score omits those clauses cleanly", () => {
  const d = describeAuditRow({ ...base, confidence_label: null, confidence_score: null });
  assert.doesNotMatch(d, /conviction/);
  assert.doesNotMatch(d, /score/);
});

// Embedding-size guardrail (BIE/Largo integration sweep, "ecosystem-context
// spx_full_state" task): ecosystem-context.ts gained a spx_full_state field
// carrying SPX Slayer's ENTIRE play-engine payload (phase, confluence
// factors, gates, confirmations, technicals, telemetry, option ticket —
// several KB of JSON per SPX/SPXW lookup). This module's ingestion loop
// (ingestAlertPrecedents -> describeAuditRow) embeds one short deterministic
// sentence PER alert_audit_log row into the shared bie_knowledge corpus on
// every nightly ingest cycle; it must keep reading ONLY alert_audit_log
// columns, never fetchEcosystemContext()/spx_full_state, or every precedent
// chunk embedded from now on would balloon from one sentence to a multi-KB
// JSON blob for no retrieval benefit (precedent search answers "has a setup
// like this happened before," not "what is SPX Slayer's live state"— that
// question is what get_ecosystem_context/get_spx_play are for). Source-scan
// rather than a runtime assertion because there's no code path today that
// would even compile a call from here to ecosystem-context.ts — this locks
// in that someone doesn't "helpfully" wire it in later.
test("precedent-search.ts never references fetchEcosystemContext or spx_full_state (embedding-size guardrail)", () => {
  const src = readFileSync(new URL("./precedent-search.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /fetchEcosystemContext/, "precedent ingestion must not pull the (large, SPX-full-fidelity) ecosystem context into every embedded chunk");
  assert.doesNotMatch(src, /spx_full_state/, "precedent ingestion must not reference spx_full_state directly either");
  assert.doesNotMatch(src, /EcosystemContext/, "precedent ingestion must stay independent of the EcosystemContext type entirely");
});
