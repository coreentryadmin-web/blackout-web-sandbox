import test from "node:test";
import assert from "node:assert/strict";
import {
  allowsHaltStaleRestrictedEntry,
  evaluatePlaybookDataSatisfaction,
  haltStaleEntryBlocked,
  playbookDataRequirements,
} from "./playbook-data-requirements";
import { playbookDataQualityFlags } from "./playbook-data-quality";
import type { SpxDeskPayload } from "./spx-desk";

test("playbookDataRequirements: PB-01 does not require GEX or fresh halt", () => {
  const req = playbookDataRequirements("PB-01");
  assert.equal(req.gex, false);
  assert.equal(req.freshHaltFeed, false);
  assert.equal(req.freshDesk, true);
});

test("playbookDataRequirements: PB-03 requires halt + gex", () => {
  const req = playbookDataRequirements("PB-03");
  assert.equal(req.freshHaltFeed, true);
  assert.equal(req.gex, true);
});

test("haltStaleEntryBlocked: PB-03 blocked on stale halt", () => {
  const flags = { halt_channel_stale: true, desk_stale: false, gex_missing: false };
  const result = haltStaleEntryBlocked("PB-03", flags, { vix: 18 });
  assert.equal(result.blocked, true);
});

test("haltStaleEntryBlocked: PB-01 permitted under restricted mode", () => {
  const flags = { halt_channel_stale: true, desk_stale: false, gex_missing: false };
  assert.equal(allowsHaltStaleRestrictedEntry("PB-01"), true);
  const result = haltStaleEntryBlocked("PB-01", flags, { vix: 18 });
  assert.equal(result.blocked, false);
});

test("haltStaleEntryBlocked: elevated VIX blocks restricted entries", () => {
  const flags = { halt_channel_stale: true, desk_stale: false, gex_missing: false };
  const result = haltStaleEntryBlocked("PB-01", flags, { vix: 28 });
  assert.equal(result.blocked, true);
});

test("evaluatePlaybookDataSatisfaction: desk stale blocks all freshDesk playbooks", () => {
  const desk = {
    polled_at: new Date(Date.now() - 120_000).toISOString(),
    gex_walls: [{}],
  } as SpxDeskPayload;
  const flags = playbookDataQualityFlags(desk);
  const sat = evaluatePlaybookDataSatisfaction("PB-01", flags, desk);
  assert.equal(sat.satisfied, false);
  assert.ok(sat.violations.some((v) => v.capability === "freshDesk"));
});

test("evaluatePlaybookDataSatisfaction: gex missing blocks PB-04 only among VWAP set", () => {
  const flags = { halt_channel_stale: false, desk_stale: false, gex_missing: true };
  assert.equal(evaluatePlaybookDataSatisfaction("PB-01", flags).satisfied, true);
  assert.equal(evaluatePlaybookDataSatisfaction("PB-04", flags).satisfied, false);
});
