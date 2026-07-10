import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayKanbanChips } from "./spx-play-kanban-chips";
import type { SpxPlayPayload } from "./spx-play-engine";

const basePlay = {
  available: true,
  phase: "OPEN",
  action: "BUY",
  direction: "long",
  grade: "A",
  score: 12,
  confidence: 80,
  headline: "Test",
  thesis: "Test thesis",
  levels: { entry: 7550, stop: 7540, target: 7565, invalidation: "" },
  option_ticket: { contract_label: "7550C", premium_range: "4-6", delta: 0.35 },
} as SpxPlayPayload;

test("buildPlayKanbanChips: structure open uses contract label in open column", () => {
  const cols = buildPlayKanbanChips({
    play: basePlay,
    lotto: null,
    powerHour: null,
    history: [],
    filter: "all",
    structureOpen: true,
    structureWatch: false,
  });
  assert.equal(cols.open.length, 1);
  assert.equal(cols.open[0]?.label, "7550C");
  assert.equal(cols.open[0]?.kind, "structure");
});

test("buildPlayKanbanChips: watch column when structure armed", () => {
  const cols = buildPlayKanbanChips({
    play: { ...basePlay, action: "WATCHING", phase: "WATCHING", watch: { active: true, promote_ready: false, reason: "x", since: null } },
    lotto: null,
    powerHour: null,
    history: [],
    filter: "all",
    structureOpen: false,
    structureWatch: true,
  });
  assert.equal(cols.watch.length, 1);
  assert.match(cols.watch[0]?.label ?? "", /7550C|W7550/);
});

test("buildPlayKanbanChips: off-hours structure lands in closed column", () => {
  const cols = buildPlayKanbanChips({
    play: basePlay,
    lotto: null,
    powerHour: null,
    history: [],
    filter: "all",
    structureOpen: false,
    structureWatch: false,
    sessionLive: false,
  });
  assert.equal(cols.open.length, 0);
  assert.equal(cols.closed.length, 1);
  assert.equal(cols.closed[0]?.label, "7550C");
  assert.equal(cols.closed[0]?.id, "structure-session");
});

test("buildPlayKanbanChips: off-hours lotto HOLD lands in closed column", () => {
  const cols = buildPlayKanbanChips({
    play: null,
    lotto: {
      phase: "HOLD",
      status_label: "Position open",
      direction: "long",
      strike: 7560,
      contract_label: "7560C",
      premium_estimate: "0.15",
      entry_zone: 7550,
      entry_trigger: "8pt confirm",
      target_price: 7585,
      target_pts: 25,
      invalidation: "stop",
      catalyst_summary: "gap",
      catalysts: [],
      confidence: 70,
      headline: "CALL Breakout · 7560",
      thesis: "Test",
      status_message: "open",
      status: "ready",
      drivers: [],
      footnote: null,
      flow_summary: null,
      sizing_note: "",
      spread_pct: null,
      open_anchor_price: null,
    },
    powerHour: null,
    history: [],
    filter: "all",
    structureOpen: false,
    structureWatch: false,
    sessionLive: false,
  });
  assert.equal(cols.open.length, 0);
  assert.equal(cols.closed.length, 1);
  assert.equal(cols.closed[0]?.id, "lotto-session");
  assert.equal(cols.closed[0]?.label, "7560C");
});
