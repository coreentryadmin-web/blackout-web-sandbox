import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMacroEventTime, macroBlockWindow } from "./spx-macro-window";

const TODAY = "2026-06-22";

test("parseMacroEventTime: HH:MM is precise", () => {
  assert.deepEqual(parseMacroEventTime("08:30", TODAY), { minutes: 8 * 60 + 30, precise: true });
  assert.deepEqual(parseMacroEventTime("10:00", TODAY), { minutes: 10 * 60, precise: true });
  assert.deepEqual(parseMacroEventTime("14:00", TODAY), { minutes: 14 * 60, precise: true });
});

test("parseMacroEventTime: today date-only is imprecise, anchored 8:30", () => {
  assert.deepEqual(parseMacroEventTime(TODAY, TODAY), { minutes: 8 * 60 + 30, precise: false });
});

test("parseMacroEventTime: non-today date and garbage are skipped", () => {
  assert.equal(parseMacroEventTime("2026-06-23", TODAY), null);
  assert.equal(parseMacroEventTime("", TODAY), null);
  assert.equal(parseMacroEventTime("soon", TODAY), null);
  assert.equal(parseMacroEventTime("99:99", TODAY), null);
});

test("macroBlockWindow: precise gets tight [t-5, t+60]", () => {
  const w = macroBlockWindow({ minutes: 8 * 60 + 30, precise: true });
  assert.deepEqual(w, { start: 8 * 60 + 25, end: 9 * 60 + 30 });
});

test("macroBlockWindow: imprecise widens to the full morning [8:25, 12:00]", () => {
  const w = macroBlockWindow({ minutes: 8 * 60 + 30, precise: false });
  assert.deepEqual(w, { start: 8 * 60 + 25, end: 12 * 60 });
});

test("money-path regression: a 10:00 release on a date-only row stays guarded", () => {
  const ev = parseMacroEventTime(TODAY, TODAY)!;
  const w = macroBlockWindow(ev);
  const tenAm = 10 * 60;
  assert.ok(tenAm >= w.start && tenAm <= w.end, "10:00 ET must fall inside the imprecise block window");
});
