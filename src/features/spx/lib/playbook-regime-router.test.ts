import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import {
  classifyPlaybookRegime,
  eligiblePlaybookIds,
} from "./playbook-regime-router";

function desk(regime: string): SpxDeskPayload {
  return { regime } as SpxDeskPayload;
}

const MID_MORNING = Date.parse("2026-07-09T15:00:00.000Z"); // 11:00 ET
const OPENING = Date.parse("2026-07-09T14:00:00.000Z"); // 10:00 ET

test("classifyPlaybookRegime: opening drive overrides desk.regime", () => {
  assert.equal(classifyPlaybookRegime(desk("bearish"), OPENING), "opening_drive");
});

test("classifyPlaybookRegime: maps EMA regime labels", () => {
  assert.equal(classifyPlaybookRegime(desk("bullish"), MID_MORNING), "trend_bull");
  assert.equal(classifyPlaybookRegime(desk("weak"), MID_MORNING), "weak");
  assert.equal(classifyPlaybookRegime(desk("recovering"), MID_MORNING), "recovery");
});

test("eligiblePlaybookIds: PB-02 excluded in bullish mid-session", () => {
  const ids = eligiblePlaybookIds(desk("bullish"), MID_MORNING);
  assert.deepEqual(ids, ["PB-01", "PB-03", "PB-04", "PB-08"]);
});

test("eligiblePlaybookIds: PB-02 included in weak mid-session", () => {
  const ids = eligiblePlaybookIds(desk("weak"), MID_MORNING);
  assert.ok(ids.includes("PB-02"));
  assert.ok(!ids.includes("PB-01"));
});

test("eligiblePlaybookIds: opening drive excludes PB-02/PB-04/PB-08", () => {
  const ids = eligiblePlaybookIds(desk("bullish"), OPENING);
  assert.deepEqual(ids, ["PB-01", "PB-03"]);
});
