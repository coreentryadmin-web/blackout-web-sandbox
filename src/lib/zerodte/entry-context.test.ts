import { test, mock } from "node:test";
import assert from "node:assert/strict";

// buildZeroDteEntryContext/formatEtStamp are pure; fetchZeroDteSessionContext's only
// side effects are fetchAggBars (mocked below) + withServerCache (real, in-memory —
// redis layer no-ops without REDIS_URL). Mock BEFORE importing the module under test.
const state = {
  aggCalls: [] as Array<{ symbol: string; timespan: string }>,
  vixBars: [] as Array<Record<string, number>>,
  spyBars: [] as Array<Record<string, number>>,
};

mock.module("../providers/polygon-largo", {
  namedExports: {
    fetchAggBars: async (symbol: string, _mult: number, timespan: string) => {
      state.aggCalls.push({ symbol, timespan });
      if (symbol === "I:VIX") return state.vixBars;
      if (symbol === "SPY") return state.spyBars;
      return [];
    },
  },
});

// tsx transpiles tests to CJS (no top-level await) — dynamic-import the module
// under test inside each test, same idiom as rejections.test.ts's `mod()`.
const mod = () => import("./entry-context");

// 2026-07-13T13:55Z = 09:55 ET (EDT) — the real SPY flag time from the 7/13 ledger.
const FLAG_MS = Date.parse("2026-07-13T13:55:00Z");

test("formatEtStamp renders the desk (ET) wall clock", async () => {
  const { formatEtStamp } = await mod();
  assert.equal(formatEtStamp(FLAG_MS), "2026-07-13 09:55 ET");
  // Winter instant (EST, UTC-5) — the formatter must follow the zone, not a fixed offset.
  assert.equal(formatEtStamp(Date.parse("2026-01-15T14:55:00Z")), "2026-01-15 09:55 ET");
});

test("buildZeroDteEntryContext: rounds at the data layer, passes per-name fields through", async () => {
  const { buildZeroDteEntryContext } = await mod();
  const { tier, ...rest } = buildZeroDteEntryContext(
    { score: 68.4, gamma_regime: "positive" },
    { vix_open: 17.230000000000004, spy_bias: "down" },
    FLAG_MS
  );
  assert.deepEqual(rest, {
    vix_open: 17.23,
    spy_bias: "down",
    gamma_regime: "positive",
    score: 68,
    committed_at_et: "2026-07-13 09:55 ET",
    cortex: null, // pre-wire-in call shape (no cortex arg) → null, never a fabricated blob
  });
  // PR-F: the merit tier is pinned alongside, computed from the SAME values just
  // pinned above (score 68 mid-band +1, VIX 17.23 elevated −2, no Cortex → A capped
  // out, 09:55 ET early window −1 → net −2 → C).
  assert.ok(tier);
  assert.equal(tier!.tier, "C");
  assert.deepEqual(
    tier!.factors.map((f) => [f.label, f.direction]),
    [
      ["Mid score band", "up"],
      ["VIX elevated", "down"],
      ["Cortex evidence missing", "down"],
      ["Early window", "down"],
    ]
  );
});

test("buildZeroDteEntryContext: pins the commit-time merit tier — strong pinned evidence grades A from the same blob (PR-F)", async () => {
  const { buildZeroDteEntryContext } = await mod();
  // 13:05 ET (17:05Z, EDT): outside the F-4 early window. Prime-band score (+2),
  // calm VIX 16.1 (+2), clean multi-source Cortex support (+2) → 6 points, no caps → A.
  const ctx = buildZeroDteEntryContext(
    {
      score: 78,
      gamma_regime: null,
      cortex: {
        abstained: false as const,
        decision: "PASS" as const,
        as_of: "2026-07-13T17:05:00.000Z",
        score: 2.1,
        conviction: "A" as const,
        vetoes: [],
        supports: [
          { source: "gex-walls" as const, stance: "supports" as const, weight: 1.0, halfLifeSec: 900, asOf: "2026-07-13T17:04:00.000Z", detail: "path clear" },
          { source: "wall-trend" as const, stance: "supports" as const, weight: 1.1, halfLifeSec: 900, asOf: "2026-07-13T17:04:00.000Z", detail: "wall growing" },
        ],
        opposes: [],
        absent: [],
        narrative: [],
      },
    },
    { vix_open: 16.1, spy_bias: "up" },
    Date.parse("2026-07-13T17:05:00Z")
  );
  assert.ok(ctx.tier);
  assert.equal(ctx.tier!.tier, "A");
  assert.deepEqual(
    ctx.tier!.factors.map((f) => [f.label, f.direction]),
    [
      ["Prime score band", "up"],
      ["VIX calm band", "up"],
      ["Clean Cortex support", "up"],
    ]
  );
  // Parity guarantee: the pinned tier IS tierFromEntryContext over the pinned blob —
  // a retroactive re-derivation of this exact row can never disagree with the chip.
  const { tierFromEntryContext } = await import("./tiers");
  assert.deepEqual(tierFromEntryContext(ctx as unknown as Record<string, unknown>), ctx.tier);
});

test("buildZeroDteEntryContext: pins the Cortex evidence blob verbatim (commit) and the abstain record (outage)", async () => {
  const { buildZeroDteEntryContext } = await mod();
  // Full-vector shape as cortexEntryContextFor emits it for a committed find —
  // passed through UNCHANGED (the composer already rounded its own numbers).
  const cortexBlob = {
    abstained: false as const,
    decision: "PASS" as const,
    as_of: "2026-07-13T14:20:00.000Z",
    score: 3.1,
    conviction: "A" as const,
    vetoes: [],
    supports: [
      {
        source: "wall-trend" as const,
        stance: "supports" as const,
        weight: 0.75,
        halfLifeSec: 600,
        asOf: "2026-07-13T14:19:00.000Z",
        detail: "opposing put wall 606 faded 24% -> 13% over 44 min.",
      },
    ],
    opposes: [],
    absent: ["catalyst-news: no market catalyst"],
    narrative: ["CORTEX QQQ short: net score +3.1, conviction A."],
  };
  const committed = buildZeroDteEntryContext(
    { score: 65, gamma_regime: null, cortex: cortexBlob },
    { vix_open: 16.32, spy_bias: "down" },
    FLAG_MS
  );
  assert.deepEqual(committed.cortex, cortexBlob);

  // Cortex outage: the honest abstain record rides the row (fail-soft rule: a
  // Cortex outage must never silently halt the engine — but it must be VISIBLE
  // per play, so the calibration loop can price the blind commits).
  const abstained = buildZeroDteEntryContext(
    {
      score: 65,
      gamma_regime: null,
      cortex: {
        abstained: true,
        reason: "no Cortex source produced evidence (8 absent) — commit proceeds on the hard gates alone.",
      },
    },
    null,
    FLAG_MS
  );
  assert.deepEqual(abstained.cortex, {
    abstained: true,
    reason: "no Cortex source produced evidence (8 absent) — commit proceeds on the hard gates alone.",
  });
});

test("buildZeroDteEntryContext: null session context never blocks a commit blob", async () => {
  const { buildZeroDteEntryContext } = await mod();
  const { tier, ...rest } = buildZeroDteEntryContext({ score: null, gamma_regime: null }, null, FLAG_MS);
  assert.deepEqual(rest, {
    vix_open: null,
    spy_bias: null,
    gamma_regime: null,
    score: null,
    committed_at_et: "2026-07-13 09:55 ET",
    cortex: null,
  });
  // All-null evidence still tiers (rule 3: gaps degrade) — score missing caps at C.
  assert.equal(tier?.tier, "C");
});

test("fetchZeroDteSessionContext: VIX day-open from the daily bar, bias from SPY tape; cached", async () => {
  const { fetchZeroDteSessionContext } = await mod();
  state.aggCalls = [];
  // Day-open VIX 17.2 (the real 7/13 open regime the forensics flagged).
  state.vixBars = [{ o: 17.2, h: 19, l: 16.9, c: 18.1 }];
  // A selling-off SPY tape: 30 one-minute RTH bars with falling closes so the last
  // price sits below VWAP with a down 15-minute trend → marketBias "down".
  const open = Date.parse("2026-07-13T13:30:00Z");
  state.spyBars = Array.from({ length: 30 }, (_, i) => {
    const c = 100 - i * 0.1;
    return { t: open + i * 60_000, h: c + 0.05, l: c - 0.05, c, v: 1000 };
  });

  const ctx = await fetchZeroDteSessionContext();
  assert.ok(ctx);
  assert.equal(ctx.vix_open, 17.2);
  assert.equal(ctx.spy_bias, "down");
  assert.deepEqual(
    state.aggCalls.map((c) => c.symbol).sort(),
    ["I:VIX", "SPY"]
  );

  // Second call inside the TTL serves the cache — no new provider calls.
  const again = await fetchZeroDteSessionContext();
  assert.deepEqual(again, ctx);
  assert.equal(state.aggCalls.length, 2);
});
