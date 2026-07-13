import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

let mockHaltBlock = { block: false as boolean, reason: null as string | null };
let mockBeforeCashOpen = false;
let mockPastNoEntry = false;
/** Default 10:30 ET — past opening range, before no-entry cutoff. */
let mockEtMinutes = 10 * 60 + 30;

mock.module("../../../lib/ws/uw-socket", {
  namedExports: {
    shouldBlockForTradingHalt: () => mockHaltBlock,
  },
});

mock.module("./spx-play-session-guards", {
  namedExports: {
    isPastNoEntryCutoff: () => mockPastNoEntry,
    isBeforeCashOpen: () => mockBeforeCashOpen,
    cashOpenLabel: () => "9:30 AM ET",
    noEntryCutoffLabel: () => "3:30 PM ET",
  },
});

mock.module("./spx-play-session-time", {
  namedExports: {
    etClock: (h: number, m: number) => h * 60 + m,
    etMinutes: () => mockEtMinutes,
    formatEtTime: (h: number, m: number) =>
      `${h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`,
  },
});

let evaluatePlayGates: typeof import("./spx-play-gates").evaluatePlayGates;

before(async () => {
  ({ evaluatePlayGates } = await import("./spx-play-gates"));
});

function baseDesk(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
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
    ...overrides,
  } as SpxDeskPayload;
}

function baseConfluence(overrides: Partial<SpxConfluence> = {}): SpxConfluence {
  return {
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
    ...overrides,
  } as SpxConfluence;
}

const emptySession = {
  last_buy_at: null,
  last_sell_at: null,
  last_sell_was_loss: false,
  last_direction: null,
  last_stop_at: null,
};

const passingConfirmations = {
  passed: true,
  passed_count: 4,
  total: 4,
  checks: [{ label: "VWAP", required: true, passed: true, detail: "above" }],
};

test("evaluatePlayGates: stale halt channel restricts playbook event entries", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk({ halt_channel_stale: true }),
    baseConfluence(),
    emptySession,
    passingConfirmations,
    { entry_intent: "buy", playbook_primary_id: "PB-03", playbook_primary_direction: "long" }
  );
  assert.match(result.blocks.join(" "), /halt feed/i);
});

test("evaluatePlayGates: stale halt channel warns for restricted low-velocity PB-01", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk({ halt_channel_stale: true }),
    baseConfluence(),
    emptySession,
    passingConfirmations,
    { entry_intent: "buy", playbook_primary_id: "PB-01", playbook_primary_direction: "long" }
  );
  assert.equal(result.blocks.some((b) => b.includes("halt feed")), false);
  assert.match(result.warnings.join(" "), /restricted mode/i);
});

test("evaluatePlayGates: confirmed trading halt blocks entry", () => {
  mockHaltBlock = { block: true, reason: "TRADING HALT active on SPX" };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence(),
    emptySession,
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /TRADING HALT/i);
  assert.equal(result.passed, false);
});

test("evaluatePlayGates: missing GEX walls blocks entry", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk({ gex_walls: [] }),
    baseConfluence(),
    emptySession,
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /GEX walls required/i);
  assert.equal(result.passed, false);
});

test("evaluatePlayGates: stale desk blocks entry", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk({
      polled_at: new Date(Date.now() - 120_000).toISOString(),
      gex_age_ms: 120_000,
    }),
    baseConfluence(),
    emptySession,
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /Desk data stale/i);
});

test("evaluatePlayGates: mixed tape hard-blocks BUY", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence({ grade: "B", weighted_conflicts: 99 }),
    emptySession,
    passingConfirmations,
    { entry_intent: "buy" }
  );
  assert.match(result.blocks.join(" "), /Tape's mixed/i);
});

test("evaluatePlayGates: mixed tape warns on WATCH intent", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence({ grade: "B", weighted_conflicts: 99 }),
    emptySession,
    passingConfirmations,
    { entry_intent: "watch" }
  );
  assert.equal(result.blocks.some((b) => b.includes("Tape's mixed")), false);
  assert.match(result.warnings.join(" "), /Tape's mixed/i);
});

test("evaluatePlayGates: grade below B blocks BUY", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence({ grade: "C" }),
    emptySession,
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /below minimum/i);
});

test("evaluatePlayGates: opening range blocks BUY before ~9:50", () => {
  mockHaltBlock = { block: false, reason: null };
  mockEtMinutes = 9 * 60 + 35;
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence(),
    emptySession,
    passingConfirmations,
    { entry_intent: "buy" }
  );
  assert.match(result.blocks.join(" "), /Opening range/i);
});

test("evaluatePlayGates: macro CPI window blocks during release", () => {
  mockHaltBlock = { block: false, reason: null };
  mockEtMinutes = 8 * 60 + 30;
  const result = evaluatePlayGates(
    baseDesk({
      macro_events: [{ event: "CPI", time: "08:30", country: "US" }],
    }),
    baseConfluence(),
    emptySession,
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /Macro hard block/i);
});

test("evaluatePlayGates: buy cooldown blocks re-entry after exit", () => {
  mockHaltBlock = { block: false, reason: null };
  mockEtMinutes = 10 * 60 + 30;
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence({ grade: "B" }),
    {
      ...emptySession,
      last_sell_at: Date.now() - 60_000,
    },
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /Buy cooldown/i);
});

test("evaluatePlayGates: post-STOP cooldown blocks BUY", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence({ grade: "B" }),
    {
      ...emptySession,
      last_stop_at: Date.now() - 60_000,
    },
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /Post-STOP cooldown/i);
});

test("evaluatePlayGates: same-direction re-entry lock after loss", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence({ direction: "long" }),
    {
      ...emptySession,
      last_sell_was_loss: true,
      last_sell_at: Date.now() - 60_000,
      last_direction: "long",
    },
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /Re-entry lock after loss/i);
});

test("evaluatePlayGates: VIX above 32 blocks new entries", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk({ vix: 33.5 }),
    baseConfluence(),
    emptySession,
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /governor blocks new 0DTE|VIX 33\.5/i);
});

test("evaluatePlayGates: pre-market BUY blocked before cash open", () => {
  mockHaltBlock = { block: false, reason: null };
  mockBeforeCashOpen = true;
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence(),
    emptySession,
    passingConfirmations,
    { entry_intent: "buy" }
  );
  assert.match(result.blocks.join(" "), /Pre-market/i);
  mockBeforeCashOpen = false;
});

test("evaluatePlayGates: after no-entry cutoff blocks BUY", () => {
  mockHaltBlock = { block: false, reason: null };
  mockPastNoEntry = true;
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence(),
    emptySession,
    passingConfirmations,
    { entry_intent: "buy" }
  );
  assert.match(result.blocks.join(" "), /no new 0DTE entries/i);
  mockPastNoEntry = false;
});

test("evaluatePlayGates: failed confirmations block entry", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence(),
    emptySession,
    {
      passed: false,
      passed_count: 1,
      total: 4,
      checks: [{ label: "3m MTF", required: true, passed: false, detail: "below level" }],
    }
  );
  assert.match(result.blocks.join(" "), /3m MTF/i);
  assert.equal(result.entry_mode, "none");
});

test("evaluatePlayGates: session loss cap blocks BUY", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence(),
    { ...emptySession, session_losses_today: 3 },
    passingConfirmations
  );
  assert.match(result.blocks.join(" "), /Session loss cap/i);
});

test("evaluatePlayGates: cold BUY path requires A-grade and min score", () => {
  mockHaltBlock = { block: false, reason: null };
  const result = evaluatePlayGates(
    baseDesk(),
    baseConfluence({ grade: "B", score: 70 }),
    emptySession,
    passingConfirmations,
    { entry_intent: "buy", cold_buy_path: true }
  );
  assert.match(result.blocks.join(" "), /grade A or better/i);
});
