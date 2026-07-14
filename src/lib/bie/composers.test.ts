import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stripGroundingTokens } from "@/lib/bie/grounding-markers";
// From the composers-shared LEAF, not composers.ts — same reason this file tests
// grounding-markers directly: composers.ts's full intent graph can't load here.
import { tierLine } from "@/lib/bie/composers-shared";

describe("stripGroundingTokens (SPX + Vector desk answer rendering)", () => {
  test("renders {{value}} markers down to their values — nothing leaks", () => {
    // The exact leak the live audit caught on the SPX desk read.
    const raw = "LONG {{7,575}} {{0.00}}% below VWAP · MECHANIC above γflip {{7,496}} · grade {{A}} · RSI {{70}}";
    const out = stripGroundingTokens(raw);
    assert.ok(!out.includes("{{"), "no opening marker survives");
    assert.ok(!out.includes("}}"), "no closing marker survives");
    // The values themselves are preserved.
    for (const v of ["7,575", "0.00", "7,496", "A", "70"]) {
      assert.ok(out.includes(v), `value ${v} should survive`);
    }
  });

  test("is a no-op on text with no markers", () => {
    assert.equal(stripGroundingTokens("plain desk read, no markers"), "plain desk read, no markers");
  });

  test("handles the em-dash '{{—}}' placeholder", () => {
    assert.equal(stripGroundingTokens("flip {{—}}"), "flip —");
  });
});

// ── PR-F: pinned merit-tier citation line under each 0DTE play ─────────────────────

describe("tierLine (0DTE play merit-tier citation)", () => {
  test("renders the pinned letter with factor labels, indented under the play (PR-H citation style)", () => {
    const line = tierLine({
      tier: "B",
      factors: [
        { label: "Mid score band", direction: "up", detail: "…" },
        { label: "Early window", direction: "down", detail: "…" },
      ],
    });
    assert.equal(line, "\n  Merit tier **B** at commit — Mid score band · Early window");
  });

  test("factor-less blob still cites the letter; malformed/absent blobs render NOTHING (never an invented grade)", () => {
    assert.equal(tierLine({ tier: "A", factors: [] }), "\n  Merit tier **A** at commit");
    assert.equal(tierLine(null), "");
    assert.equal(tierLine(undefined), "");
    assert.equal(tierLine({}), "");
    assert.equal(tierLine({ tier: 2 as unknown as string, factors: [] }), "");
    // Garbled factor entries degrade to the labels that parse — never a crash.
    assert.equal(
      tierLine({ tier: "C", factors: [null, { label: 7 }, { label: "VIX elevated" }] }),
      "\n  Merit tier **C** at commit — VIX elevated"
    );
  });
});
