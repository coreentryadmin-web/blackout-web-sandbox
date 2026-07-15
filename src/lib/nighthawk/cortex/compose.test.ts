// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/compose.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { composeCortexEvidence, cortexDecayFactor, ABSENT_AFTER_HALF_LIVES, SOURCE_SUPPORT_CAPS } from "./compose";
import { QQQ_SHORT_2026_07_13, SPY_LONG_2026_07_13 } from "./fixtures-2026-07-13";
import { baseInputs, TEST_NOW } from "./test-helpers";
import { CORTEX_SOURCES } from "./types";

const NOW_MS = Date.parse(TEST_NOW);

describe("compose: the 2026-07-13 design-doc fixtures", () => {
  test("QQQ short 10:20 ET — net-supportive, zero vetoes", () => {
    const v = composeCortexEvidence(QQQ_SHORT_2026_07_13);
    assert.equal(v.vetoes.length, 0, JSON.stringify(v.vetoes));
    assert.ok(v.score > 0, `score ${v.score}`);
    assert.ok(v.supports.length >= 5, `supports ${v.supports.map((s) => s.source)}`);
    // The flagship spoke: wall-trend fade + king migration, capped at its source cap.
    const wallTrend = v.supports.filter((s) => s.source === "wall-trend");
    assert.ok(wallTrend.length >= 2);
    const wallTrendSum = wallTrend.reduce((a, s) => a + s.weight, 0);
    assert.ok(
      wallTrendSum <= SOURCE_SUPPORT_CAPS["wall-trend"] + 1e-6,
      `wall-trend sum ${wallTrendSum} exceeds its cap`
    );
    // Rich, aligned, structurally supported => conviction A (and never above — C-1).
    assert.equal(v.conviction, "A");
    // Uncatalyzed flow is disclosed, not hidden.
    assert.ok(v.absent.some((a) => a.startsWith("catalyst-news:")));
    assert.ok(v.narrative.length >= 1 + v.supports.length + v.absent.length);
  });

  test("SPY long 9:55 ET on the down tape — VETOED", () => {
    const v = composeCortexEvidence(SPY_LONG_2026_07_13);
    assert.ok(v.vetoes.length >= 2, `vetoes: ${v.vetoes.map((x) => x.source)}`);
    assert.deepEqual(
      v.vetoes.map((x) => x.source).sort(),
      ["flow-quality", "gex-walls"]
    );
    assert.ok(v.score < 0, `score ${v.score}`);
    assert.equal(v.conviction, "C"); // a blocked play never wears a band
    // The building opposing wall + red breadth + opposing VEX + counter-character open all argue no.
    assert.deepEqual(
      [...new Set(v.opposes.map((o) => o.source))].sort(),
      ["opening-harvest", "sector-heat", "vex-charm", "wall-trend"]
    );
    assert.match(v.narrative[0], /BLOCKED by 2 vetoes/);
  });

  test("determinism: same snapshot => identical verdict", () => {
    assert.deepEqual(composeCortexEvidence(QQQ_SHORT_2026_07_13), composeCortexEvidence(QQQ_SHORT_2026_07_13));
  });
});

describe("compose: evidence decay (design §0 — alpha that expires)", () => {
  /** One aligned bearish sweep cluster whose newest print is `ageMin` old. */
  function flowInput(ageMin: number) {
    const at = new Date(NOW_MS - ageMin * 60_000).toISOString();
    return baseInputs({
      direction: "short",
      // Backdate the whole cluster together so it stays inside its own 15-min
      // window relative to the prints' own times... the cluster window is measured
      // from NOW, so an old cluster simply stops qualifying. To isolate DECAY from
      // the windowing, feed wall-trend instead: its window is 45 min and its
      // half-life 10 min.
      flow: null,
      wallTrend: {
        asOf: at,
        samples: Array.from({ length: 10 }, (_, i) => ({
          time: (NOW_MS - ageMin * 60_000) / 1000 - (9 - i) * 120,
          callWalls: [{ strike: 105, pct: 30 }],
          putWalls: [{ strike: 95, pct: 30 - i * 2 }], // fading opposing put wall => short support
        })),
      },
    });
  }

  test("staler asOf => smaller effective contribution", () => {
    const fresh = composeCortexEvidence(flowInput(0));
    const older = composeCortexEvidence(flowInput(15));
    const freshW = fresh.supports.find((s) => s.source === "wall-trend")!.weight;
    const olderW = older.supports.find((s) => s.source === "wall-trend")!.weight;
    assert.ok(freshW > olderW, `${freshW} vs ${olderW}`);
    // ~15 min at a 10-min half-life => factor ~2^-1.5.
    assert.ok(Math.abs(olderW / freshW - 2 ** -1.5) < 0.02, `${olderW / freshW}`);
  });

  test(`beyond ${ABSENT_AFTER_HALF_LIVES} half-lives the source is demoted to absent`, () => {
    const v = composeCortexEvidence(flowInput(31)); // 31 min > 3 * 10-min half-life
    assert.equal(v.supports.some((s) => s.source === "wall-trend"), false);
    assert.ok(v.absent.some((a) => /wall-trend: evidence stale/.test(a)));
  });

  test("cortexDecayFactor: exact half-life math", () => {
    assert.equal(cortexDecayFactor(0, 600), 1);
    assert.equal(cortexDecayFactor(600, 600), 0.5);
    assert.equal(cortexDecayFactor(1200, 600), 0.25);
  });
});

describe("compose: absent-source visibility", () => {
  test("an all-null snapshot reports EVERY source absent, score 0, conviction C", () => {
    const v = composeCortexEvidence(baseInputs());
    assert.equal(v.score, 0);
    assert.equal(v.vetoes.length, 0);
    assert.equal(v.conviction, "C");
    for (const source of CORTEX_SOURCES) {
      assert.ok(v.absent.some((a) => a.startsWith(`${source}:`)), `missing absent entry for ${source}`);
    }
  });

  test("reader error classes surface in the absent reasons", () => {
    const v = composeCortexEvidence(baseInputs({ errors: { "gex-walls": "CortexSourceTimeout" } }));
    assert.ok(v.absent.some((a) => /gex-walls: reader failed \(CortexSourceTimeout\)/.test(a)));
  });
});

describe("compose: conviction banding", () => {
  test("catalyst-confirmed flow upgrades one band, capped at A, never on a vetoed play", () => {
    const catalyst = {
      asOf: TEST_NOW,
      items: [
        {
          headline: "FDA approval granted",
          channels: ["fda"],
          publishedAt: new Date(NOW_MS - 3600_000).toISOString(),
          tickers: ["TEST"],
        },
      ],
      earningsToday: null,
    };
    const cluster = [1, 2, 3].map((i) => ({
      premium: 300_000,
      direction: "bullish" as const,
      kind: "sweep" as const,
      at: new Date(NOW_MS - i * 60_000).toISOString(),
    }));

    // flow support (0.75 capped) + catalyst support (~0.72 decayed) => score < 2 (B
    // band on its own) but the catalyst upgrade lifts it to A.
    const upgraded = composeCortexEvidence(baseInputs({ direction: "long", news: catalyst, flow: { asOf: TEST_NOW, prints: cluster } }));
    assert.ok(upgraded.score < 2, `score ${upgraded.score}`);
    assert.equal(upgraded.conviction, "A");

    // Same input plus an opposing veto cluster: the upgrade must NOT apply.
    const vetoPrints = [
      ...cluster,
      { premium: 700_000, direction: "bearish" as const, kind: "sweep" as const, at: cluster[0].at },
      { premium: 600_000, direction: "bearish" as const, kind: "block" as const, at: cluster[1].at },
    ];
    const blocked = composeCortexEvidence(baseInputs({ direction: "long", news: catalyst, flow: { asOf: TEST_NOW, prints: vetoPrints } }));
    assert.ok(blocked.vetoes.length > 0);
    assert.equal(blocked.conviction, "C");
  });

  test("invalid now throws (never a silent Date.now rescue)", () => {
    assert.throws(() => composeCortexEvidence(baseInputs({ now: "not-a-clock" })), TypeError);
  });
});
