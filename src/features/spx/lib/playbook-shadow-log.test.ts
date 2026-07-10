import test from "node:test";
import assert from "node:assert/strict";
import { playbookShadowStateKey } from "./playbook-shadow-log";
import type { PlaybookShadowPanel } from "./playbook-shadow-panel";

test("playbookShadowStateKey: primary + fired set", () => {
  const panel: PlaybookShadowPanel = {
    mode: "shadow",
    primary_playbook_id: "PB-04",
    verdicts: [
      {
        playbook_id: "PB-01",
        name: "VWAP Reclaim",
        trigger_fired: false,
        precondition_match: false,
        session_window_open: false,
        regime_eligible: true,
        direction: "neutral",
        detail: "",
        primary: false,
      },
      {
        playbook_id: "PB-04",
        name: "Gamma Pin Fade",
        trigger_fired: true,
        precondition_match: true,
        session_window_open: true,
        regime_eligible: true,
        direction: "short",
        detail: "fade",
        primary: true,
      },
    ],
  };
  assert.equal(playbookShadowStateKey(panel), "PB-04|PB-04:short");
});

test("playbookShadowStateKey: none when idle", () => {
  const panel: PlaybookShadowPanel = {
    mode: "shadow",
    primary_playbook_id: null,
    verdicts: [
      {
        playbook_id: "PB-01",
        name: "VWAP Reclaim",
        trigger_fired: false,
        precondition_match: false,
        session_window_open: true,
        regime_eligible: true,
        direction: "neutral",
        detail: "",
        primary: false,
      },
    ],
  };
  assert.equal(playbookShadowStateKey(panel), "none|");
});
