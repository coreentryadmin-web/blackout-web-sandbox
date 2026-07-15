// composeTickerCompare tests (PR-L1) — the compare answer must NAME BOTH tickers, state each
// side's flip distance, and DECLARE the closer-to-flip winner explicitly (live-battery defect:
// "Is SPX or NVDA closer to its gamma flip?" produced an answer naming only one side). Hermetic:
// the ecosystem-context seam is mocked with mock.module before the module under test loads —
// ticker-compare.ts imports it via a RELATIVE specifier for exactly this (cortex-read convention).

import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { EcosystemContext } from "./ecosystem-context";

// Minimal fixture — only the fields composeTickerCompare reads. Cast through unknown on purpose:
// EcosystemContext carries many arsenal fields irrelevant to the compare table.
function ctx(
  ticker: string,
  gex: { spot: number; flip: number | null; gamma_posture?: string } | null
): EcosystemContext {
  return {
    ticker,
    recent_flow: null,
    nighthawk_recent: null,
    zerodte_today: null,
    recent_anomalies: [],
    gex_positioning: gex
      ? { ticker, spot: gex.spot, flip: gex.flip, gamma_posture: gex.gamma_posture ?? "long_gamma" }
      : null,
  } as unknown as EcosystemContext;
}

const contexts = new Map<string, EcosystemContext>();

// Loaded in before() — the tsx test transform is CJS, so no top-level await.
let composeTickerCompare: typeof import("./ticker-compare").composeTickerCompare;

describe("composeTickerCompare — closer-to-flip verdict (PR-L1)", () => {
  before(async () => {
    mock.module("./ecosystem-context", {
      namedExports: {
        fetchEcosystemContext: async (ticker: string) => {
          const c = contexts.get(ticker);
          if (!c) throw new Error(`no fixture for ${ticker}`);
          return c;
        },
      },
    });
    ({ composeTickerCompare } = await import("./ticker-compare"));
  });
  test("names BOTH tickers, states both flip distances, and declares the winner explicitly", async () => {
    // SPX: 7,515 vs flip 7,512.66 → 0.03% away. NVDA: 180 vs flip 172 → 4.44% away.
    contexts.set("SPX", ctx("SPX", { spot: 7515.34, flip: 7512.66 }));
    contexts.set("NVDA", ctx("NVDA", { spot: 180, flip: 172 }));
    const { answer } = await composeTickerCompare("SPX", "NVDA");

    assert.match(answer, /SPX/, "must name the first ticker");
    assert.match(answer, /NVDA/, "must name the second ticker");
    assert.match(answer, /\*\*Closer to its gamma flip: SPX\*\*/, "must declare the winner in bold");
    assert.match(answer, /SPX is 0\.04% from its flip/, "must state SPX's flip distance");
    assert.match(answer, /NVDA is 4\.44% from its flip/, "must state NVDA's flip distance");
  });

  test("PERCENT not points: a nearer-in-points flip on a bigger underlying can still be farther in %", async () => {
    // QQQ flip 5 points away on spot 500 = 1.00%; SPY flip 4 points away on spot 650 ≈ 0.62%.
    // SPY wins even though 4 < 5 only in points too — but flip the sizes: NVDA 2 points on 180
    // (1.11%) vs SPX 60 points on 7,500 (0.80%) → SPX wins despite being 30× farther in points.
    contexts.set("SPX", ctx("SPX", { spot: 7500, flip: 7440 }));
    contexts.set("NVDA", ctx("NVDA", { spot: 180, flip: 178 }));
    const { answer } = await composeTickerCompare("SPX", "NVDA");
    assert.match(answer, /\*\*Closer to its gamma flip: SPX\*\*/);
  });

  test("HONESTY: one side missing its flip → says so, never invents a winner", async () => {
    contexts.set("SPX", ctx("SPX", { spot: 7500, flip: 7440 }));
    contexts.set("ASTS", ctx("ASTS", { spot: 30, flip: null }));
    const { answer } = await composeTickerCompare("SPX", "ASTS");
    assert.doesNotMatch(answer, /\*\*Closer to its gamma flip:/);
    assert.match(answer, /ASTS has no flip on record/);
    assert.match(answer, /SPX is 0\.80% from its flip/);
  });

  test("HONESTY: both sides missing → an explicit no-data line naming both", async () => {
    contexts.set("SPX", ctx("SPX", null));
    contexts.set("ASTS", ctx("ASTS", null));
    const { answer } = await composeTickerCompare("SPX", "ASTS");
    assert.match(answer, /no gamma-flip data on record for SPX or ASTS/);
  });

  test("the side-by-side table still renders both columns", async () => {
    contexts.set("SPY", ctx("SPY", { spot: 650, flip: 646 }));
    contexts.set("QQQ", ctx("QQQ", { spot: 500, flip: 495 }));
    const { answer } = await composeTickerCompare("SPY", "QQQ");
    assert.match(answer, /\| Signal \| SPY \| QQQ \|/);
    assert.match(answer, /Thermal GEX/);
  });
});
