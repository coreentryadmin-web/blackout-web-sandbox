import test from "node:test";
import assert from "node:assert/strict";
import { playbookShadowStateKey } from "./playbook-shadow-log";
import type { PlaybookShadowPanel } from "./playbook-shadow-panel";

import type { PlaybookPipelineAudit } from "@/features/spx/lib/playbook-pipeline-audit";
import { emptyPlaybookFamilyAudit, emptyPlaybookSubtypeAudit } from "@/features/spx/lib/playbook-pipeline-audit";

const EMPTY_AUDIT: PlaybookPipelineAudit = {
  eligible_long: 0,
  eligible_short: 0,
  armed_long: 0,
  armed_short: 0,
  triggered_long: 0,
  triggered_short: 0,
  blocked_long: 0,
  blocked_short: 0,
  opened_long: 0,
  opened_short: 0,
  family_audit: emptyPlaybookFamilyAudit(),
  subtype_audit: emptyPlaybookSubtypeAudit(),
};

test("playbookShadowStateKey: primary + fired set", () => {
  const panel: PlaybookShadowPanel = {
    mode: "shadow",
    primary_playbook_id: "PB-04",
    pipeline_audit: EMPTY_AUDIT,
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
    pipeline_audit: EMPTY_AUDIT,
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

test("playbookShadowStateKey: gate blocks fingerprint uses content not count", () => {
  const panel: PlaybookShadowPanel = {
    mode: "shadow",
    primary_playbook_id: "PB-04",
    pipeline_audit: EMPTY_AUDIT,
    verdicts: [
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
  const cooldown = ["Buy cooldown (10m after exit)"];
  const grade = ["Grade B below minimum"];
  assert.notEqual(
    playbookShadowStateKey(panel, cooldown),
    playbookShadowStateKey(panel, grade)
  );
  assert.equal(
    playbookShadowStateKey(panel, cooldown),
    "PB-04|PB-04:short|blocks:Buy cooldown (10m after exit)"
  );
});
