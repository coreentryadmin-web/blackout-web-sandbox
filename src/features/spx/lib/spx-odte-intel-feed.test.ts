import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendOdteIntelEvents,
  buildOdteIntelContext,
  diffHeatmapIntelEvents,
  diffNighthawkIntelEvents,
  diffOdteIntelEvents,
  heatmapToIntelSlice,
  odteIntelEventsToTerminalLines,
  type IntelHeatmapSlice,
  type OdteIntelEvent,
} from "./spx-odte-intel-feed";
import type { SpxDeskPayload } from "./spx-desk";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";

function desk(partial: Partial<SpxDeskPayload>): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-10T14:00:00.000Z",
    source: "test",
    price: 7540,
    spx_change_pct: 0.5,
    vix: 16,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7500,
    hod: 7560,
    vwap: 7520,
    pdh: null,
    pdl: null,
    prior_close: null,
    gap_pct: null,
    gap_source: null,
    ema20: null,
    ema50: null,
    ema200: null,
    sma50: null,
    sma200: null,
    tick: null,
    trin: null,
    add: null,
    gex_net: 10_000_000_000,
    gex_king: 7550,
    max_pain: 7475,
    gamma_flip: 7489,
    above_gamma_flip: true,
    gamma_regime: "mean_revert",
    gex_walls: [
      { strike: 7575, net_gex: 2_000_000_000, kind: "resistance", distance_pts: 35 },
      { strike: 7500, net_gex: -1_500_000_000, kind: "support", distance_pts: 40 },
    ],
    flow_0dte_call_premium: 1_000_000,
    flow_0dte_put_premium: 400_000,
    flow_0dte_net: 600_000,
    spx_flows: [],
    unified_tape: [],
    strike_stacks: [],
    levels: [],
    regime: "bullish",
    ...partial,
  } as SpxDeskPayload;
}

test("diffOdteIntelEvents: seed emits anchor + flip + walls + net gex + regime", () => {
  const events = diffOdteIntelEvents(null, desk({}), { seed: true });
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("anchor"));
  assert.ok(kinds.includes("flip"));
  assert.ok(kinds.includes("call_wall"));
  assert.ok(kinds.includes("put_wall"));
  assert.ok(kinds.includes("gex_net"));
  assert.ok(kinds.includes("regime"));
  assert.ok(kinds.includes("gamma_regime"));
  assert.ok(events.every((e) => e.line.text.length > 0));
});

test("diffOdteIntelEvents: anchor migration emits warn line", () => {
  const prev = desk({ gex_king: 7550 });
  const next = desk({ gex_king: 7560, as_of: "2026-07-10T14:01:00.000Z" });
  const events = diffOdteIntelEvents(prev, next);
  const anchor = events.find((e) => e.kind === "anchor");
  assert.ok(anchor);
  assert.match(anchor!.line.text, /ANCHOR migrated/);
  assert.match(anchor!.line.text, /7,?550/);
  assert.match(anchor!.line.text, /7,?560/);
});

test("diffOdteIntelEvents: spot cross above/below flip", () => {
  const prev = desk({ above_gamma_flip: false, price: 7480 });
  const next = desk({ above_gamma_flip: true, price: 7495, as_of: "2026-07-10T14:02:00.000Z" });
  const events = diffOdteIntelEvents(prev, next);
  const cross = events.find((e) => e.kind === "spot_cross");
  assert.ok(cross);
  assert.match(cross!.line.text, /ABOVE/);
});

test("diffOdteIntelEvents: wall reducing when magnitude melts", () => {
  const prev = desk({
    gex_walls: [
      { strike: 7575, net_gex: 2_000_000_000, kind: "resistance", distance_pts: 35 },
      { strike: 7500, net_gex: -1_500_000_000, kind: "support", distance_pts: 40 },
    ],
  });
  const next = desk({
    as_of: "2026-07-10T14:05:00.000Z",
    gex_walls: [
      { strike: 7575, net_gex: 1_000_000_000, kind: "resistance", distance_pts: 35 },
      { strike: 7500, net_gex: -500_000_000, kind: "support", distance_pts: 40 },
    ],
  });
  const events = diffOdteIntelEvents(prev, next);
  const call = events.find((e) => e.kind === "call_wall");
  const put = events.find((e) => e.kind === "put_wall");
  assert.ok(call);
  assert.match(call!.line.text, /reducing/);
  assert.ok(put);
  assert.match(put!.line.text, /reducing/);
});

test("diffOdteIntelEvents: regime / OR break / gex stale / halt", () => {
  const prev = desk({
    price: 7550,
    hod: 7560,
    lod: 7500,
    regime: "bullish",
    gamma_regime: "mean_revert",
    gex_stale: false,
    feed_stalled: false,
    active_halts: [],
  });
  const next = desk({
    as_of: "2026-07-10T14:10:00.000Z",
    price: 7565,
    hod: 7560,
    lod: 7490,
    regime: "bearish",
    gamma_regime: "amplification",
    gex_stale: true,
    feed_stalled: true,
    active_halts: [{ symbol: "SPY", halt_type: "LULD", reason: "volatility" }],
  });
  const kinds = diffOdteIntelEvents(prev, next).map((e) => e.kind);
  assert.ok(kinds.includes("regime"));
  assert.ok(kinds.includes("gamma_regime"));
  assert.ok(kinds.includes("or_break"));
  assert.ok(kinds.includes("gex_stale"));
  assert.ok(kinds.includes("feed_stalled"));
  assert.ok(kinds.includes("halt"));
});

test("diffOdteIntelEvents: massive flow print only when new", () => {
  const prev = desk({ spx_flows: [] });
  const next = desk({
    as_of: "2026-07-10T14:03:00.000Z",
    spx_flows: [
      {
        ticker: "SPX",
        premium: 1_200_000,
        option_type: "call",
        strike: 7550,
        expiry: "2026-07-10",
        direction: "bullish",
        alerted_at: "2026-07-10T14:02:55.000Z",
        alert_rule: null,
        trade_count: 12,
        has_sweep: true,
      },
    ],
  });
  const events = diffOdteIntelEvents(prev, next);
  const flow = events.find((e) => e.kind === "flow_print");
  assert.ok(flow);
  assert.match(flow!.line.text, /MASSIVE CALL/);
  assert.match(flow!.line.text, /SWEEP/);

  const again = diffOdteIntelEvents(next, next);
  assert.equal(again.filter((e) => e.kind === "flow_print").length, 0);
});

test("diffOdteIntelEvents: ignores small flow prints", () => {
  const prev = desk({ spx_flows: [] });
  const next = desk({
    as_of: "2026-07-10T14:04:00.000Z",
    spx_flows: [
      {
        ticker: "SPX",
        premium: 50_000,
        option_type: "put",
        strike: 7500,
        expiry: "2026-07-10",
        direction: "bearish",
        alerted_at: "2026-07-10T14:03:55.000Z",
        alert_rule: null,
        trade_count: 2,
        has_sweep: false,
      },
    ],
  });
  const events = diffOdteIntelEvents(prev, next);
  assert.equal(events.filter((e) => e.kind === "flow_print").length, 0);
});

test("diffHeatmapIntelEvents: seed emits VEX/DEX/CHARM posture", () => {
  const next: IntelHeatmapSlice = {
    asof: "2026-07-10T14:00:00.000Z",
    vex: {
      flip: 7540,
      total: 1e6,
      regime: { posture: "positive" },
      strike_totals: { "7550": 5e5, "7525": -2e5 },
    },
    dex: { zero_level: 7530, total: 1e5, regime: { posture: "long" } },
    charm: { zero_level: 7545, total: 1e4, regime: { posture: "positive" } },
  };
  const events = diffHeatmapIntelEvents(null, next, { seed: true });
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("vex"));
  assert.ok(kinds.includes("dex"));
  assert.ok(kinds.includes("charm"));
  assert.ok(events.some((e) => /VEX ANCHOR/.test(e.line.text)));
});

test("diffHeatmapIntelEvents: events + wall melt + greek posture flips", () => {
  const prev: IntelHeatmapSlice = {
    asof: "2026-07-10T14:00:00.000Z",
    events: [],
    shift: { available: false },
    vex: {
      flip: 7540,
      regime: { posture: "positive" },
      strike_totals: { "7550": 5e5 },
    },
    dex: { regime: { posture: "long" } },
    charm: { regime: { posture: "positive" } },
  };
  const next: IntelHeatmapSlice = {
    asof: "2026-07-10T14:08:00.000Z",
    events: [
      {
        type: "flip_crossed",
        severity: "warn",
        message: "Spot crossed γ flip 7540 → long gamma",
        at: "2026-07-10T14:08:00.000Z",
      },
      {
        type: "regime_flipped",
        severity: "info",
        message: "GEX regime long → short",
        at: "2026-07-10T14:08:00.000Z",
      },
    ],
    shift: {
      available: true,
      wall_changes: {
        call_wall: { from: 7575, to: 7575, moved_pts: 0, grew_pct: -0.4 },
        put_wall: { from: 7500, to: 7485, moved_pts: -15, grew_pct: null },
      },
    },
    vex_shift: {
      available: true,
      wall_changes: {
        call_wall: { from: 7600, to: 7610, moved_pts: 10, grew_pct: null },
        put_wall: { from: 7480, to: 7480, moved_pts: 0, grew_pct: 0.1 },
      },
    },
    vex: {
      flip: 7555,
      regime: { posture: "negative" },
      strike_totals: { "7560": 6e5 },
    },
    dex: { regime: { posture: "short" } },
    charm: { regime: { posture: "negative" } },
  };
  const events = diffHeatmapIntelEvents(prev, next);
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("heatmap_event"));
  assert.ok(kinds.includes("call_wall"));
  assert.ok(kinds.includes("put_wall"));
  assert.ok(kinds.includes("vex"));
  assert.ok(kinds.includes("dex"));
  assert.ok(kinds.includes("charm"));
  assert.ok(events.some((e) => /reducing/.test(e.line.text)));
  assert.ok(events.some((e) => /PUT WALL moved/.test(e.line.text)));
  assert.ok(events.some((e) => /VEX POS WALL moved/.test(e.line.text)));
  assert.ok(events.some((e) => /VEX POSTURE/.test(e.line.text)));
  assert.ok(events.some((e) => /DEX POSTURE/.test(e.line.text)));
  assert.ok(events.some((e) => /CHARM POSTURE/.test(e.line.text)));
});

test("diffNighthawkIntelEvents: first snapshot emits publish", () => {
  const next: NightHawkEdition = {
    available: true,
    edition_for: "2026-07-10",
    published_at: "2026-07-10T08:05:00.000Z",
    recap_headline: null,
    recap_summary: null,
    plays: [
      {
        rank: 1,
        ticker: "SPX",
        direction: "long",
        conviction: "A",
        play_type: "index",
        thesis: "Gap fill",
        key_signal: "put wall hold",
        entry_range: "7530-7540",
        target: "7580",
        stop: "7510",
        options_play: "7550C",
      },
    ],
  };
  const events = diffNighthawkIntelEvents(null, next);
  assert.ok(events.some((e) => e.kind === "nighthawk"));
  assert.ok(events.some((e) => /NIGHT HAWK PUBLISHED/.test(e.line.text)));
  assert.ok(events.some((e) => /NH #1 SPX LONG/.test(e.line.text)));
});

test("diffNighthawkIntelEvents: same edition is silent", () => {
  const edition: NightHawkEdition = {
    available: true,
    edition_for: "2026-07-10",
    published_at: "2026-07-10T08:05:00.000Z",
    recap_headline: null,
    recap_summary: null,
    plays: [],
  };
  assert.deepEqual(diffNighthawkIntelEvents(edition, edition), []);
});

test("appendOdteIntelEvents: dedupes and caps", () => {
  const a: OdteIntelEvent = {
    id: "a",
    at: "t1",
    kind: "anchor",
    line: { icon: "gamma", tone: "accent", text: "A" },
  };
  const b: OdteIntelEvent = {
    id: "b",
    at: "t2",
    kind: "flip",
    line: { icon: "level", tone: "warn", text: "B" },
  };
  const merged = appendOdteIntelEvents([a], [a, b], 2);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
});

test("odteIntelEventsToTerminalLines: empty → listening copy", () => {
  const lines = odteIntelEventsToTerminalLines([]);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /Listening/);
});

test("buildOdteIntelContext: merges desk + heatmap + NH into plain lines", () => {
  const prev = desk({
    gex_walls: [
      { strike: 7575, net_gex: 2_000_000_000, kind: "resistance", distance_pts: 35 },
      { strike: 7500, net_gex: -1_500_000_000, kind: "support", distance_pts: 40 },
    ],
    regime: "bullish",
  });
  const next = desk({
    as_of: "2026-07-10T14:12:00.000Z",
    gex_walls: [
      { strike: 7575, net_gex: 800_000_000, kind: "resistance", distance_pts: 35 },
      { strike: 7500, net_gex: -1_500_000_000, kind: "support", distance_pts: 40 },
    ],
    regime: "bearish",
  });
  const hmPrev: IntelHeatmapSlice = {
    asof: "2026-07-10T14:00:00.000Z",
    vex: { regime: { posture: "positive" }, strike_totals: { "7550": 1 } },
    dex: { regime: { posture: "long" } },
    charm: { regime: { posture: "positive" } },
  };
  const hmNext: IntelHeatmapSlice = {
    asof: "2026-07-10T14:12:00.000Z",
    vex: { regime: { posture: "negative" }, strike_totals: { "7560": 1 } },
    dex: { regime: { posture: "short" } },
    charm: { regime: { posture: "negative" } },
  };
  const nh: NightHawkEdition = {
    available: true,
    edition_for: "2026-07-10",
    published_at: "2026-07-10T08:05:00.000Z",
    recap_headline: null,
    recap_summary: null,
    plays: [
      {
        rank: 1,
        ticker: "SPX",
        direction: "short",
        conviction: "A",
        play_type: "index",
        thesis: "Fade",
        key_signal: "neg gamma",
        entry_range: "7540",
        target: "7500",
        stop: "7565",
        options_play: "7525P",
      },
    ],
  };
  const ctx = buildOdteIntelContext({
    prevDesk: prev,
    desk: next,
    prevHeatmap: hmPrev,
    heatmap: hmNext,
    prevNighthawk: null,
    nighthawk: nh,
  });
  assert.ok(ctx.lines.some((l) => /reducing/.test(l)));
  assert.ok(ctx.lines.some((l) => /REGIME/.test(l)));
  assert.ok(ctx.lines.some((l) => /VEX POSTURE/.test(l)));
  assert.ok(ctx.lines.some((l) => /DEX POSTURE/.test(l)));
  assert.ok(ctx.lines.some((l) => /CHARM POSTURE/.test(l)));
  assert.ok(ctx.lines.some((l) => /NIGHT HAWK PUBLISHED/.test(l)));
  assert.equal(ctx.events.length, ctx.lines.length);
});

test("heatmapToIntelSlice: drops unavailable payloads", () => {
  assert.equal(heatmapToIntelSlice(null), null);
  assert.equal(heatmapToIntelSlice({ available: false }), null);
  const slice = heatmapToIntelSlice({
    available: true,
    asof: "2026-07-10T14:00:00.000Z",
    vex: { flip: 7500, regime: { posture: "positive" } },
  });
  assert.ok(slice);
  assert.equal(slice!.asof, "2026-07-10T14:00:00.000Z");
  assert.equal(slice!.vex?.flip, 7500);
});
