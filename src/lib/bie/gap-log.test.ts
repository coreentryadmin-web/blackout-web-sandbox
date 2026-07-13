import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { recordBieGap, fetchBieGaps } from "@/lib/bie/gap-log";
import { noLiveVectorStateMessage } from "@/lib/bie/vector-read-fallback";

describe("gap-log", () => {
  test("recordBieGap then fetchBieGaps surfaces the gap newest-first (memory fallback)", async () => {
    const marker = `unit-probe-${Date.now()}`;
    await recordBieGap({ question: `what is ${marker}`, intent: "concept_read", reason: "no_definition" });
    const gaps = await fetchBieGaps(50);
    const hit = gaps.find((g) => g.question.includes(marker));
    assert.ok(hit, "recorded gap should be retrievable");
    assert.equal(hit!.intent, "concept_read");
    assert.equal(hit!.reason, "no_definition");
    assert.ok(hit!.at, "carries an ISO timestamp");
  });

  test("newest gap is first", async () => {
    const a = `probe-a-${Date.now()}`;
    const b = `probe-b-${Date.now()}`;
    await recordBieGap({ question: a, intent: "vector_read", reason: "no_live_state" });
    await recordBieGap({ question: b, intent: "vector_read", reason: "no_live_state" });
    const gaps = await fetchBieGaps(50);
    const ia = gaps.findIndex((g) => g.question === a);
    const ib = gaps.findIndex((g) => g.question === b);
    assert.ok(ib >= 0 && ia >= 0);
    assert.ok(ib < ia, "b (recorded later) should sort ahead of a");
  });

  test("question is truncated to a bounded length", async () => {
    const long = "x".repeat(1000);
    await recordBieGap({ question: long, intent: "concept_read", reason: "no_definition" });
    const gaps = await fetchBieGaps(50);
    const hit = gaps.find((g) => g.question.startsWith("x"));
    assert.ok(hit);
    assert.ok(hit!.question.length <= 300, "question is bounded");
  });
});

describe("noLiveVectorStateMessage (BUG 1 — honest no-data, never a crash/dump)", () => {
  test("returns an honest, ticker-named message", () => {
    const msg = noLiveVectorStateMessage("spy");
    assert.match(msg, /SPY/);
    assert.match(msg, /don't have live Vector data/i);
    // Never a desk dump, never empty.
    assert.ok(msg.length > 40);
  });

  test("degrades gracefully on an empty ticker", () => {
    const msg = noLiveVectorStateMessage("");
    assert.match(msg, /that ticker/);
  });
});
