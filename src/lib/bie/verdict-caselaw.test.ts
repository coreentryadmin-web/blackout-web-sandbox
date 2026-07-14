import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildCaseRecord,
  buildNoCaseRecordEnvelope,
  buildRecallEnvelope,
  pinVerdictCase,
  recallVerdictCase,
  type VerdictCaseRecord,
} from "@/lib/bie/verdict-caselaw";
import { deriveFalsifiers, type FalsifierSnapshot } from "@/lib/bie/verdict-falsifiers";
import { makeEnvelope, type BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

const snapshot: FalsifierSnapshot = { spot: 7515, flip: 7480, call_wall: 7550, put_wall: 7400, max_pain: 7500 };

function sampleEnvelope(): BieAnswerEnvelope {
  return makeEnvelope({
    headline: "SPX verdict 7,515: long-γ range, bullish — moderate confidence",
    bias: "bullish",
    intent: "verdict",
    sections: [{ title: "Dealer positioning", body: "Spot 7,515 · γflip 7,480" }],
    evidence: [],
    confidence: { level: "moderate", why: "test" },
    falsifiers: deriveFalsifiers({ ...snapshot, regime: "long" }, "bullish"),
  });
}

describe("verdict-caselaw: buildCaseRecord", () => {
  test("captures headline, bias, snapshot, falsifiers — fully serializable", () => {
    const env = sampleEnvelope();
    const rec = buildCaseRecord("spx", "is SPX 7500 a good 0DTE play", env, snapshot, "long");
    assert.equal(rec.ticker, "SPX");
    assert.equal(rec.bias, "bullish");
    assert.equal(rec.confidence, "moderate");
    assert.deepEqual(rec.snapshot, snapshot);
    assert.ok(rec.falsifiers.length > 0);
    // Round-trips through JSON (the KV store serializes it).
    assert.deepEqual(JSON.parse(JSON.stringify(rec)), rec);
  });
});

describe("verdict-caselaw: buildNoCaseRecordEnvelope (honest no-record)", () => {
  test("states plainly that nothing is pinned — never reconstructs a verdict", () => {
    const env = buildNoCaseRecordEnvelope("SPX");
    assert.match(env.headline, /No verdict on record for SPX/);
    assert.match(env.markdown, /won't reconstruct/i);
    assert.equal(env.confidence.level, "high"); // an empty store is itself the honest answer
  });
});

describe("verdict-caselaw: buildRecallEnvelope (re-check against a live snapshot)", () => {
  const rec: VerdictCaseRecord = buildCaseRecord(
    "SPX",
    "is SPX 7500 a good 0DTE play",
    sampleEnvelope(),
    snapshot,
    "long"
  );

  test("unchanged live read → STILL HOLDS", () => {
    const env = buildRecallEnvelope(rec, snapshot);
    assert.match(env.headline, /STILL HOLDS/);
    const still = env.sections.find((s) => /Still valid/.test(s.title))!;
    assert.match(still.body, /still stands/i);
  });

  test("spot lost the flip → INVALIDATED, citing the tripped falsifier", () => {
    const env = buildRecallEnvelope(rec, { ...snapshot, spot: 7460 });
    assert.match(env.headline, /is INVALIDATED/);
    const still = env.sections.find((s) => /Still valid/.test(s.title))!;
    assert.match(still.body, /TRIPPED \(invalidates\)/);
  });

  test("no live snapshot → recalled honestly, falsifiers left un-checked (not guessed)", () => {
    const env = buildRecallEnvelope(rec, null);
    assert.match(env.headline, /no live read to re-check/);
    const still = env.sections.find((s) => /Still valid/.test(s.title))!;
    assert.equal(still.unavailable?.reason, "no live snapshot to re-evaluate");
  });

  test("recall envelope pins the ORIGINAL time, not now", () => {
    const env = buildRecallEnvelope(rec, snapshot);
    assert.equal(env.asOf, rec.asOf);
  });
});

describe("verdict-caselaw: persistence round-trip (in-memory fallback, no REDIS_URL)", () => {
  test("pin then recall returns the same record; unknown ticker → null", async () => {
    const rec = buildCaseRecord("NVDA", "hold NVDA into earnings", sampleEnvelope(), snapshot, "long");
    await pinVerdictCase(rec);
    const got = await recallVerdictCase("nvda");
    assert.ok(got, "recalled a record");
    assert.equal(got!.ticker, "NVDA");
    assert.equal(got!.question, "hold NVDA into earnings");
    assert.equal(await recallVerdictCase("ZZZZ_NONE"), null);
  });
});
