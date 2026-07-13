import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  evaluateDiagnostic,
  parseDiagSurface,
  renderDiagnosis,
  type DiagInputs,
} from "@/lib/bie/diagnostic-core";

function inputs(over: Partial<DiagInputs> = {}): DiagInputs {
  return {
    providersConfigured: true,
    bothProvidersDown: false,
    inUniverse: true,
    isRth: true,
    cron: { found: true, failed: false, marketHoursStale: false, message: null, rows: 21, ageMin: 2 },
    railLen: 40,
    circuitOpen: false,
    circuitDetail: null,
    spot: 150,
    wallsEmpty: false,
    errorCount: 0,
    errorSpike: false,
    incidents: 0,
    missedFlow: false,
    ...over,
  };
}

describe("parseDiagSurface", () => {
  test("detects surface from wording", () => {
    assert.equal(parseDiagSurface("why aren't MSFT beads forming"), "beads");
    assert.equal(parseDiagSurface("why isn't NVDA's call wall showing"), "walls");
    assert.equal(parseDiagSurface("is the flow tape healthy"), "flow");
    assert.equal(parseDiagSurface("why isn't NVDA GEX updating"), "gex");
  });
});

describe("evaluateDiagnostic — decisive causes (ordered, grounded, honest)", () => {
  test("both providers down → config conclusion", () => {
    const r = evaluateDiagnostic("NVDA", "gex", inputs({ providersConfigured: false, bothProvidersDown: true }));
    assert.match(r.conclusion, /Neither data provider/i);
    assert.equal(r.confidence, "high");
  });

  test("off-hours beads → expected idle, not a fault", () => {
    const r = evaluateDiagnostic("MSFT", "beads", inputs({ isRth: false }));
    assert.match(r.conclusion, /outside regular trading hours|idle by design/i);
  });

  test("non-universe ticker beads → on-demand only, expected", () => {
    const r = evaluateDiagnostic("ZM", "beads", inputs({ inUniverse: false }));
    assert.match(r.conclusion, /not in the .* recorded universe|no server-persisted bead rail/i);
  });

  test("recorder cron failed → real pipeline failure", () => {
    const r = evaluateDiagnostic("SPX", "beads", inputs({
      cron: { found: true, failed: true, marketHoursStale: false, message: "redis timeout", rows: null, ageMin: 30 },
    }));
    assert.match(r.conclusion, /recorder cron .* failing/i);
    assert.match(r.conclusion, /redis timeout/);
  });

  test("cron running but rail empty → write-path issue", () => {
    const r = evaluateDiagnostic("SPX", "beads", inputs({ railLen: 0, cron: { found: true, failed: false, marketHoursStale: false, message: null, rows: 21, ageMin: 2 } }));
    assert.match(r.conclusion, /write-path issue/i);
  });

  test("circuit open → fetches short-circuited", () => {
    const r = evaluateDiagnostic("NVDA", "gex", inputs({ circuitOpen: true, circuitDetail: "UW breaker open" }));
    assert.match(r.conclusion, /circuit is open|short-circuited/i);
  });

  test("thin chain (walls empty) → chain too thin, expected", () => {
    const r = evaluateDiagnostic("ZM", "gex", inputs({ inUniverse: false, wallsEmpty: true, spot: 60 }));
    // Non-universe fires first for beads only; for gex the chain-thin conclusion wins.
    assert.match(r.conclusion, /chain is too thin|too thin/i);
  });

  test("open incident scoped → confirmed incident", () => {
    const r = evaluateDiagnostic("SPX", "flow", inputs({ incidents: 1 }));
    assert.match(r.conclusion, /open incident/i);
    assert.equal(r.confidence, "high");
  });

  test("all green → forming normally", () => {
    const r = evaluateDiagnostic("SPX", "gex", inputs());
    assert.match(r.conclusion, /forming normally|checks out/i);
    // Every node reported for transparency.
    assert.ok(r.nodes.length >= 8);
    assert.ok(r.nodes.every((n) => ["ok", "issue", "expected", "unknown"].includes(n.status)));
  });

  test("nothing decisive AND signals unavailable → honest can't-determine (never a guess)", () => {
    const r = evaluateDiagnostic("SPX", "gex", inputs({
      cron: null, railLen: null, spot: null, wallsEmpty: null, providersConfigured: true,
    }));
    assert.match(r.conclusion, /can't pin a single root cause|won't guess/i);
    assert.equal(r.confidence, "insufficient");
  });

  test("renderDiagnosis includes the checklist + honesty footer", () => {
    const md = renderDiagnosis(evaluateDiagnostic("SPX", "gex", inputs()));
    assert.match(md, /\*\*Checks:\*\*/);
    assert.match(md, /no guessed cause/i);
  });
});
