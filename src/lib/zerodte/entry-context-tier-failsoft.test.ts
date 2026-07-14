import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Fail-soft contract of the PR-F commit-time tier stamp: assignZeroDteTier (via
// tierFromEntryContext) is defensive on DATA by design, so the try/catch in
// buildZeroDteEntryContext guards programmer error only — and this file proves that
// even a hard throw inside the tier engine yields tier:null on an otherwise intact
// blob, never a failed commit. Lives in its own file (not entry-context.test.ts)
// because node:test mock.module registrations are process-wide: the sibling suite
// needs the REAL ./tiers for its genuine-tier assertions, and test files run in
// separate processes, so the throwing stand-in here can never leak into it.

mock.module("./tiers", {
  namedExports: {
    tierFromEntryContext: () => {
      throw new Error("hermetic: simulated tier-engine programmer error");
    },
  },
});

// Same provider stub the sibling suite uses — entry-context.ts imports the Polygon
// bar fetcher at module scope (only fetchZeroDteSessionContext uses it; unused here).
mock.module("../providers/polygon-largo", {
  namedExports: { fetchAggBars: async () => [] },
});

test("buildZeroDteEntryContext: a throwing tier engine degrades to tier:null — the commit blob survives intact (fail-soft)", async () => {
  const { buildZeroDteEntryContext } = await import("./entry-context");
  const warnings: unknown[][] = [];
  const warn = mock.method(console, "warn", (...args: unknown[]) => {
    warnings.push(args);
  });
  try {
    const ctx = buildZeroDteEntryContext(
      { score: 78, gamma_regime: "positive" },
      { vix_open: 16.1, spy_bias: "up" },
      Date.parse("2026-07-13T17:05:00Z")
    );
    // The tier is null — and ONLY the tier: every pinned field the ledger row and
    // the calibration loop depend on is untouched by the tier engine's failure.
    assert.deepEqual(ctx, {
      vix_open: 16.1,
      spy_bias: "up",
      gamma_regime: "positive",
      score: 78,
      committed_at_et: "2026-07-13 13:05 ET",
      cortex: null,
      tier: null,
    });
    // Log-only, never a throw: the failure is visible in the logs (one warn), and
    // nothing propagated to the caller — persistZeroDteScan's commit proceeds.
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]![0]), /tier assignment failed/);
  } finally {
    warn.mock.restore();
  }
});
