import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyCortexMorningReveto } from "./morning-cortex-reveto";
import type { PlayStatus } from "./morning-confirm-verdict";
import type { CortexVerdict, EvidenceItem } from "@/lib/nighthawk/cortex/types";

function ps(overrides: Partial<PlayStatus> = {}): PlayStatus {
  return {
    rank: 1,
    ticker: "AMD",
    direction: "LONG",
    status: "CONFIRMED",
    reason: "All checks passed",
    ...overrides,
  };
}

function fakeVeto(source: string, detail: string): EvidenceItem {
  return {
    source: source as EvidenceItem["source"],
    stance: "veto",
    weight: 0,
    detail,
    halfLifeSec: 3600,
    asOf: new Date().toISOString(),
  };
}

function verdict(ticker: string, overrides: Partial<CortexVerdict> = {}): CortexVerdict {
  return {
    ticker,
    direction: "long",
    asOf: new Date().toISOString(),
    vetoes: [],
    score: 1.5,
    supports: [],
    opposes: [],
    absent: [],
    conviction: "B",
    narrative: [],
    ...overrides,
  };
}

describe("applyCortexMorningReveto", () => {
  test("no Cortex verdicts → all statuses pass through unchanged", () => {
    const statuses = [ps(), ps({ rank: 2, ticker: "TSLA" })];
    const { statuses: out, result } = applyCortexMorningReveto(statuses, new Map());
    assert.deepEqual(out, statuses);
    assert.equal(result.vetoed.length, 0);
    assert.equal(result.skipped.length, 2);
  });

  test("Cortex veto upgrades CONFIRMED → INVALIDATED", () => {
    const statuses = [ps({ ticker: "AMD" })];
    const verdicts = new Map([
      ["AMD", verdict("AMD", { vetoes: [fakeVeto("catalyst-news", "Earnings tomorrow (AMC)")] })],
    ]);
    const { statuses: out, result } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].status, "INVALIDATED");
    assert.ok(out[0].reason.includes("Cortex fresh-veto"));
    assert.ok(out[0].reason.includes("Earnings tomorrow"));
    assert.equal(result.vetoed.length, 1);
    assert.equal(result.vetoed[0].ticker, "AMD");
  });

  test("Cortex veto upgrades DEGRADED → INVALIDATED, preserving mechanical reason", () => {
    const statuses = [ps({ ticker: "AMD", status: "DEGRADED", reason: "Put wall drifted 15 pts" })];
    const verdicts = new Map([
      ["AMD", verdict("AMD", { vetoes: [fakeVeto("catalyst-news", "Earnings today (BMO)")] })],
    ]);
    const { statuses: out } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].status, "INVALIDATED");
    assert.ok(out[0].reason.includes("Put wall drifted"));
    assert.ok(out[0].reason.includes("Cortex fresh-veto"));
  });

  test("already INVALIDATED → skipped (no double processing)", () => {
    const statuses = [ps({ ticker: "AMD", status: "INVALIDATED", reason: "Gapped through stop" })];
    const verdicts = new Map([
      ["AMD", verdict("AMD", { vetoes: [fakeVeto("catalyst-news", "Earnings")] })],
    ]);
    const { statuses: out, result } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].status, "INVALIDATED");
    assert.equal(out[0].reason, "Gapped through stop");
    assert.equal(result.skipped.length, 1);
    assert.equal(result.vetoed.length, 0);
  });

  test("Cortex no vetoes → cleared, status unchanged", () => {
    const statuses = [ps({ ticker: "AMD" })];
    const verdicts = new Map([["AMD", verdict("AMD")]]);
    const { statuses: out, result } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].status, "CONFIRMED");
    assert.equal(result.cleared.length, 1);
    assert.equal(result.cleared[0], "AMD");
  });

  test("null verdict (Cortex errored) → skipped", () => {
    const statuses = [ps({ ticker: "AMD" })];
    const verdicts = new Map<string, CortexVerdict | null>([["AMD", null]]);
    const { statuses: out, result } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].status, "CONFIRMED");
    assert.equal(result.skipped.length, 1);
  });

  test("case-insensitive ticker matching", () => {
    const statuses = [ps({ ticker: "amd" })];
    const verdicts = new Map([
      ["AMD", verdict("AMD", { vetoes: [fakeVeto("catalyst-news", "Earnings")] })],
    ]);
    const { statuses: out, result } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].status, "INVALIDATED");
    assert.equal(result.vetoed.length, 1);
  });

  test("mixed batch: one vetoed, one cleared, one already invalidated", () => {
    const statuses = [
      ps({ rank: 1, ticker: "AMD", status: "CONFIRMED" }),
      ps({ rank: 2, ticker: "TSLA", status: "DEGRADED", reason: "Regime choppy" }),
      ps({ rank: 3, ticker: "WFC", status: "INVALIDATED", reason: "Gapped through stop" }),
    ];
    const verdicts = new Map([
      ["AMD", verdict("AMD", { vetoes: [fakeVeto("catalyst-news", "FDA decision")] })],
      ["TSLA", verdict("TSLA")],
    ]);
    const { statuses: out, result } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].status, "INVALIDATED");
    assert.equal(out[1].status, "DEGRADED");
    assert.equal(out[2].status, "INVALIDATED");
    assert.equal(result.vetoed.length, 1);
    assert.equal(result.cleared.length, 1);
    assert.equal(result.skipped.length, 1);
  });

  test("CONFIRMED with 'All checks passed' reason → only Cortex veto reason (no vestigial text)", () => {
    const statuses = [ps({ ticker: "AMD", status: "CONFIRMED", reason: "All checks passed" })];
    const verdicts = new Map([
      ["AMD", verdict("AMD", { vetoes: [fakeVeto("catalyst-news", "M&A announced")] })],
    ]);
    const { statuses: out } = applyCortexMorningReveto(statuses, verdicts);
    assert.equal(out[0].reason, "Cortex fresh-veto: [catalyst-news] M&A announced");
    assert.ok(!out[0].reason.includes("All checks passed"));
  });

  test("does not mutate input arrays", () => {
    const original = [ps({ ticker: "AMD" })];
    const verdicts = new Map([
      ["AMD", verdict("AMD", { vetoes: [fakeVeto("catalyst-news", "Earnings")] })],
    ]);
    const { statuses: out } = applyCortexMorningReveto(original, verdicts);
    assert.equal(original[0].status, "CONFIRMED");
    assert.equal(out[0].status, "INVALIDATED");
    assert.notEqual(original[0], out[0]);
  });
});
