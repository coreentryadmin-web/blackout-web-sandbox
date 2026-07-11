import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

mock.module("../../../lib/ws/uw-socket", {
  namedExports: {
    shouldBlockForTradingHalt: () => ({ block: false, reason: null }),
  },
});

mock.module("./spx-play-session-guards", {
  namedExports: {
    isPastNoEntryCutoff: () => false,
    isBeforeCashOpen: () => false,
    cashOpenLabel: () => "9:30 AM ET",
    noEntryCutoffLabel: () => "3:30 PM ET",
  },
});

mock.module("./spx-play-session-time", {
  namedExports: {
    etClock: (h: number, m: number) => h * 60 + m,
    etMinutes: () => 10 * 60 + 30,
    formatEtTime: (h: number, m: number) =>
      `${h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`,
  },
});

mock.module("./spx-play-config", {
  namedExports: {
    gradeRank: (grade: string) => ({ D: 0, C: 1, B: 2, A: 3, "A+": 4 })[grade] ?? 0,
    playBuyCooldownAplusBypass: () => true,
    playBuyCooldownSec: () => 600,
    playCooldownAfterStopMin: () => 15,
    playColdBuyMinScore: () => 72,
    playFullMinScore: () => 58,
    playGexStaleMaxSec: () => 90,
    playMinAgreeingFactors: () => 3,
    playMinGradeRank: () => 2,
    playMinRiskReward: () => 2,
    playOnlyFullEntry: () => false,
    playOpeningRangeMinutes: () => 20,
    playReentryLockSec: () => 1200,
    playSessionMaxEntries: () => 6,
    playSessionMaxLosses: () => 3,
    playStarterMinScore: () => 48,
    playWatchMinScore: () => 38,
    playWeightedConflictBlockMin: () => 2,
    playbookLiveGateEnabled: () => true,
    playbookStagingLabEnabled: () => true,
    playbookLiveAllowlist: () => new Set(["PB-01", "PB-02", "PB-03"]),
    isPlaybookLiveAllowlisted: (id: string | null | undefined) =>
      id != null && new Set(["PB-01", "PB-02", "PB-03"]).has(id),
  },
});

let evaluatePlayGates: typeof import("./spx-play-gates").evaluatePlayGates;

before(async () => {
  ({ evaluatePlayGates } = await import("./spx-play-gates"));
});

test("evaluatePlayGates: gate A17 blocks primary not in live allowlist", () => {
  const desk = {
    available: true,
    market_open: true,
    price: 6000,
    polled_at: new Date().toISOString(),
    gex_walls: [{ strike: 5990, net_gex: 1 }],
    gex_age_ms: 1000,
    flow_data_age_ms: 30_000,
    flow_cluster_live: true,
    macro_events: [],
    vix: 18,
  } as SpxDeskPayload;

  const confluence = {
    score: 55,
    grade: "A",
    bias: "bullish",
    direction: "long",
    confidence: 0.8,
    weighted_conflicts: 1,
    factors: [
      { label: "GEX", weight: 2, detail: "above flip" },
      { label: "Flow", weight: 1, detail: "calls" },
      { label: "VWAP", weight: 1, detail: "above" },
    ],
    levels: { stop: 5985, target: 6025 },
  } as SpxConfluence;

  const session = {
    last_buy_at: null,
    last_sell_at: null,
    last_sell_was_loss: false,
    last_direction: null,
    last_stop_at: null,
  };

  const confirmations = {
    passed: true,
    passed_count: 4,
    total: 4,
    checks: [{ label: "VWAP", required: true, passed: true, detail: "above" }],
  };

  const blocked = evaluatePlayGates(desk, confluence, session, confirmations, {
    entry_intent: "buy",
    playbook_primary_id: "PB-12",
    playbook_primary_direction: "long",
  });
  assert.match(blocked.blocks.join(" "), /not paper-executable/i);
  assert.match(blocked.blocks.join(" "), /PB-12/);

  const allowed = evaluatePlayGates(desk, confluence, session, confirmations, {
    entry_intent: "buy",
    playbook_primary_id: "PB-01",
    playbook_primary_direction: "long",
  });
  assert.equal(
    allowed.blocks.some((b) => b.includes("not paper-executable")),
    false
  );
});

test("evaluatePlayGates: unknown regime blocks live playbook BUY", () => {
  const desk = {
    available: true,
    market_open: true,
    price: 6000,
    polled_at: new Date().toISOString(),
    gex_walls: [{ strike: 5990, net_gex: 1 }],
    regime: "unknown",
    gex_age_ms: 1000,
    flow_data_age_ms: 30_000,
    flow_cluster_live: true,
    macro_events: [],
    vix: 18,
  } as SpxDeskPayload;

  const confluence = {
    score: 55,
    grade: "A",
    bias: "bullish",
    direction: "long",
    confidence: 0.8,
    weighted_conflicts: 1,
    factors: [
      { label: "GEX", weight: 2, detail: "above flip" },
      { label: "Flow", weight: 1, detail: "calls" },
      { label: "VWAP", weight: 1, detail: "above" },
    ],
    levels: { stop: 5985, target: 6025 },
  } as SpxConfluence;

  const session = {
    last_buy_at: null,
    last_sell_at: null,
    last_sell_was_loss: false,
    last_direction: null,
    last_stop_at: null,
  };

  const confirmations = {
    passed: true,
    passed_count: 4,
    total: 4,
    checks: [{ label: "VWAP", required: true, passed: true, detail: "above" }],
  };

  const result = evaluatePlayGates(desk, confluence, session, confirmations, {
    entry_intent: "buy",
    playbook_primary_id: "PB-01",
    playbook_primary_direction: "long",
  });
  assert.match(result.blocks.join(" "), /Unknown EMA regime/i);
});

test("evaluatePlayGates: degraded feed blocks event playbook on live gate", () => {
  const desk = {
    available: true,
    market_open: true,
    price: 6000,
    polled_at: new Date().toISOString(),
    gex_walls: [{ strike: 5990, net_gex: 1 }],
    regime: "bullish",
    halt_channel_stale: true,
    gex_age_ms: 1000,
    flow_data_age_ms: 30_000,
    flow_cluster_live: true,
    macro_events: [],
    vix: 18,
  } as SpxDeskPayload;

  const confluence = {
    score: 55,
    grade: "A",
    bias: "bullish",
    direction: "long",
    confidence: 0.8,
    weighted_conflicts: 1,
    factors: [
      { label: "GEX", weight: 2, detail: "above flip" },
      { label: "Flow", weight: 1, detail: "calls" },
      { label: "VWAP", weight: 1, detail: "above" },
    ],
    levels: { stop: 5985, target: 6025 },
  } as SpxConfluence;

  const session = {
    last_buy_at: null,
    last_sell_at: null,
    last_sell_was_loss: false,
    last_direction: null,
    last_stop_at: null,
  };

  const confirmations = {
    passed: true,
    passed_count: 4,
    total: 4,
    checks: [{ label: "VWAP", required: true, passed: true, detail: "above" }],
  };

  const orb = evaluatePlayGates(desk, confluence, session, confirmations, {
    entry_intent: "buy",
    playbook_primary_id: "PB-03",
    playbook_primary_direction: "long",
  });
  assert.match(orb.blocks.join(" "), /halt feed|required data capabilities/i);

  const vwap = evaluatePlayGates(desk, confluence, session, confirmations, {
    entry_intent: "buy",
    playbook_primary_id: "PB-01",
    playbook_primary_direction: "long",
  });
  assert.equal(vwap.blocks.some((b) => b.includes("halt feed") || b.includes("degraded feed")), false);
});

test("evaluatePlayGates: returns blocks_by_category buckets", () => {
  const desk = {
    available: true,
    market_open: false,
    price: 6000,
    polled_at: new Date().toISOString(),
    gex_walls: [{ strike: 5990, net_gex: 1 }],
    regime: "bullish",
    gex_age_ms: 1000,
    flow_data_age_ms: 30_000,
    flow_cluster_live: true,
    macro_events: [],
    vix: 18,
  } as SpxDeskPayload;

  const confluence = {
    score: 55,
    grade: "A",
    bias: "bullish",
    direction: "long",
    confidence: 0.8,
    weighted_conflicts: 1,
    factors: [],
    levels: { stop: 5985, target: 6025 },
  } as SpxConfluence;

  const result = evaluatePlayGates(
    desk,
    confluence,
    {
      last_buy_at: null,
      last_sell_at: null,
      last_sell_was_loss: false,
      last_direction: null,
      last_stop_at: null,
    },
    {
      passed: true,
      passed_count: 4,
      total: 4,
      checks: [],
    },
    { entry_intent: "buy", playbook_primary_id: "PB-04", playbook_primary_direction: "long" }
  );
  assert.ok(result.blocks_by_category.operational.length > 0);
});
