import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayTerminalLines, buildPlaybookTerminalLines } from "./spx-play-terminal-lines";
import type { SpxPlayPayload } from "./spx-play-engine";

test("buildPlayTerminalLines: structure HOLD includes VWAP and WHY HOLD", () => {
  const play = {
    action: "HOLD",
    direction: "short",
    headline: "HOLD — defending put wall",
    thesis: "Dealers pressing below flip.",
    factors: [{ label: "Gamma", weight: -2, detail: "Below flip — sell dips" }],
    levels: { entry: 7450, stop: 7465, target: 7420, invalidation: "Reclaim flip" },
    confirmations: null,
    open_play: {
      id: 1,
      direction: "short",
      entry_price: 7450,
      stop: 7465,
      target: 7420,
      grade: "A",
      opened_at: "2026-07-10T14:00:00.000Z",
      mfe_pts: 6,
      trim_done: false,
      option_label: "7450P",
    },
  } as SpxPlayPayload;

  const lines = buildPlayTerminalLines({
    selected: {
      id: "structure-open",
      chip: { id: "structure-open", column: "open", kind: "structure", label: "7450 P", prefix: "STR", tone: "put" },
      stages: ["hold", "trim", "sell"],
      activeStage: "hold",
      trimDone: false,
    },
    play,
    lotto: null,
    powerHour: null,
    desk: {
      price: 7442,
      vwap: 7454,
      above_vwap: false,
      flow_0dte_net: -120_000,
    } as never,
    confirmationLayer: null,
  });

  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /WHY HOLD/);
  assert.match(text, /Below VWAP/);
  assert.match(text, /0DTE flow/);
  assert.match(text, /Gamma/);
});

test("buildPlaybookTerminalLines: empty panel shows awaiting copy when session live", () => {
  const lines = buildPlaybookTerminalLines(null, true);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /PLAYBOOK · SHADOW \(live\)/);
  assert.match(text, /All 14 PB rules/);
});

test("buildPlaybookTerminalLines: empty AH shows honest copy + catalog", () => {
  const lines = buildPlaybookTerminalLines(null, false);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /session closed/i);
  assert.match(text, /no live playbook state/i);
  assert.match(text, /PB-01 VWAP Reclaim/);
  assert.match(text, /PB-02 VWAP Reject/);
  assert.match(text, /PB-03 Opening Range Breakout/);
  assert.doesNotMatch(text, /last session shadow state/i);
});

test("buildPlaybookTerminalLines: verdicts render named status + arming hints", () => {
  const lines = buildPlaybookTerminalLines(
    {
      mode: "shadow",
      primary_playbook_id: "PB-01",
      verdicts: [
        {
          playbook_id: "PB-01",
          name: "VWAP Reclaim",
          trigger_fired: true,
          precondition_match: true,
          session_window_open: true,
          regime_eligible: true,
          direction: "long",
          detail: "Gap-and-go above VWAP",
          primary: true,
        },
        {
          playbook_id: "PB-02",
          name: "VWAP Reject",
          trigger_fired: false,
          precondition_match: true,
          session_window_open: true,
          regime_eligible: true,
          direction: "short",
          detail: "",
          primary: false,
        },
        {
          playbook_id: "PB-03",
          name: "Opening Range Breakout",
          trigger_fired: false,
          precondition_match: false,
          session_window_open: false,
          regime_eligible: true,
          direction: "neutral",
          detail: "",
          primary: false,
        },
      ],
    },
    true
  );
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /Primary ★ PB-01 VWAP Reclaim · FIRED · LONG/);
  assert.match(text, /PB-01 ★ FIRED · VWAP Reclaim · LONG/);
  assert.match(text, /Gap-and-go above VWAP/);
  assert.match(text, /PB-02 ARMED · VWAP Reject/);
  assert.match(text, /Trigger:/);
  assert.match(text, /PB-03 IDLE · Opening Range Breakout/);
  assert.match(text, /Window closed/);
  assert.match(text, /does not gate/);
});
