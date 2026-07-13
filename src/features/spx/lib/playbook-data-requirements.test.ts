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

test("playbookDataRequirements: PB-01 requires volume-weighted VWAP", () => {
  const req = playbookDataRequirements("PB-01");
  assert.equal(req.volumeWeightedVwap, true);
  assert.equal(playbookDataRequirements("PB-03").volumeWeightedVwap, false);
});

test("evaluatePlaybookDataSatisfaction: non-volume VWAP blocks PB-01 not PB-03", () => {
  const flags = { halt_channel_stale: false, desk_stale: false, gex_missing: false };
  const desk = { vwap_volume_weighted: false, vix: 16 } as Pick<
    SpxDeskPayload,
    "vwap_volume_weighted" | "vix"
  >;
  const pb01 = evaluatePlaybookDataSatisfaction("PB-01", flags, desk);
  assert.equal(pb01.satisfied, false);
  assert.ok(pb01.violations.some((v) => v.capability === "volumeWeightedVwap"));
  assert.equal(evaluatePlaybookDataSatisfaction("PB-03", flags, desk).satisfied, true);
});

test("evaluatePlaybookDataSatisfaction: gex missing blocks PB-04 only among VWAP set", () => {
  const flags = { halt_channel_stale: false, desk_stale: false, gex_missing: true };
  assert.equal(evaluatePlaybookDataSatisfaction("PB-01", flags).satisfied, true);
  assert.equal(evaluatePlaybookDataSatisfaction("PB-04", flags).satisfied, false);
});
