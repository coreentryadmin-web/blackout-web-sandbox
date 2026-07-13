import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RTH_START_MIN,
  RTH_END_MIN,
  assignTimebarLanes,
  bandGeometry,
  clampToSession,
  fmtTimebarMinutes,
  hourTickPcts,
  macroWindowBands,
  nowCursorPct,
  pctForEtMinutes,
  playbookWindowBands,
  sessionPhase,
  type TimebarBand,
} from "./spx-session-timebar";
import { PLAYBOOK_REGISTRY } from "./playbook-registry";

// ── position / geometry math ────────────────────────────────────────────────

test("pctForEtMinutes: session edges and midpoints", () => {
  assert.equal(pctForEtMinutes(RTH_START_MIN), 0);
  assert.equal(pctForEtMinutes(RTH_END_MIN), 100);
  // 12:45 ET is exactly halfway through the 390-minute session.
  assert.equal(pctForEtMinutes(12 * 60 + 45), 50);
  // Clamped outside RTH.
  assert.equal(pctForEtMinutes(8 * 60), 0);
  assert.equal(pctForEtMinutes(17 * 60), 100);
});

test("clampToSession clips and drops fully-outside windows", () => {
  assert.deepEqual(clampToSession(9 * 60, 10 * 60), {
    startMin: RTH_START_MIN,
    endMin: 10 * 60,
  });
  assert.deepEqual(clampToSession(15 * 60, 17 * 60), {
    startMin: 15 * 60,
    endMin: RTH_END_MIN,
  });
  assert.equal(clampToSession(7 * 60, 9 * 60), null); // fully pre-open
  assert.equal(clampToSession(16 * 60 + 5, 18 * 60), null); // fully post-close
});

test("bandGeometry: opening-range window (9:35–10:30) sits at the left of the bar", () => {
  const geo = bandGeometry({ startMin: 9 * 60 + 35, endMin: 10 * 60 + 30 });
  assert.ok(geo);
  assert.ok(Math.abs(geo.leftPct - (5 / 390) * 100) < 1e-9);
  assert.ok(Math.abs(geo.widthPct - (55 / 390) * 100) < 1e-9);
});

test("nowCursorPct hidden outside RTH, positioned inside", () => {
  assert.equal(nowCursorPct(9 * 60), null);
  assert.equal(nowCursorPct(16 * 60 + 1), null);
  assert.equal(nowCursorPct(RTH_START_MIN), 0);
  assert.equal(nowCursorPct(12 * 60 + 45), 50);
});

test("sessionPhase covers pre / rth / post / closed", () => {
  assert.equal(sessionPhase(9 * 60, true), "pre");
  assert.equal(sessionPhase(12 * 60, true), "rth");
  assert.equal(sessionPhase(16 * 60 + 30, true), "post");
  assert.equal(sessionPhase(12 * 60, false), "closed");
});

test("fmtTimebarMinutes renders h:mm", () => {
  assert.equal(fmtTimebarMinutes(9 * 60 + 30), "9:30");
  assert.equal(fmtTimebarMinutes(15 * 60 + 5), "3:05");
  assert.equal(fmtTimebarMinutes(12 * 60), "12:00");
});

test("hourTickPcts: 6 ticks (10:00–15:00), strictly increasing within (0,100)", () => {
  const ticks = hourTickPcts();
  assert.equal(ticks.length, 6);
  for (let i = 0; i < ticks.length; i++) {
    assert.ok(ticks[i]! > 0 && ticks[i]! < 100);
    if (i > 0) assert.ok(ticks[i]! > ticks[i - 1]!);
  }
});

// ── playbook window bands (real registry definitions) ───────────────────────

test("playbookWindowBands pulls OR / max-pain / power-hour windows from the registry", () => {
  const bands = playbookWindowBands();
  assert.equal(bands.length, 3);

  const byId = new Map(bands.map((b) => [b.id, b]));
  const or = byId.get("pb-PB-03")!;
  const drift = byId.get("pb-PB-07")!;
  const power = byId.get("pb-PB-08")!;

  // Must MATCH the registry, not restate literals — compare against the live definitions.
  const reg = new Map(PLAYBOOK_REGISTRY.map((p) => [p.id, p.sessionWindow]));
  const min = (h: number, m: number) => h * 60 + m;
  assert.equal(or.startMin, min(reg.get("PB-03")!.startEtHour, reg.get("PB-03")!.startEtMin));
  assert.equal(or.endMin, min(reg.get("PB-03")!.endEtHour, reg.get("PB-03")!.endEtMin));
  assert.equal(drift.startMin, min(reg.get("PB-07")!.startEtHour, reg.get("PB-07")!.startEtMin));
  assert.equal(power.endMin, min(reg.get("PB-08")!.endEtHour, reg.get("PB-08")!.endEtMin));

  assert.equal(or.tone, "or");
  assert.equal(drift.tone, "drift");
  assert.equal(power.tone, "power");
  assert.match(or.detail, /Opening Range Breakout \(PB-03\)/);
});

// ── macro window bands ──────────────────────────────────────────────────────

test("macroWindowBands: precise 10:00 print blocks 9:55–11:00; overlapping prints merge", () => {
  const today = "2026-07-13";
  const bands = macroWindowBands(
    [
      { time: "10:00", event: "ISM Services", country: "US", impact: "high" },
      { time: "10:30", event: "EIA Crude", country: "US", impact: "medium" },
    ],
    today
  );
  // [9:55, 11:00] and [10:25, 11:30] overlap → ONE merged band 9:55–11:30.
  assert.equal(bands.length, 1);
  assert.equal(bands[0]!.startMin, 9 * 60 + 55);
  assert.equal(bands[0]!.endMin, 11 * 60 + 30);
  assert.match(bands[0]!.detail, /ISM Services, EIA Crude/);
  assert.equal(bands[0]!.tone, "macro");
});

test("macroWindowBands: 8:30 print survives only as its in-session tail; other-day rows skipped", () => {
  const today = "2026-07-13";
  const bands = macroWindowBands(
    [
      { time: "08:30", event: "CPI", country: "US", impact: "high" },
      { time: "10:00", event: "Tomorrow thing", country: "US", impact: "high", date: "2026-07-14" },
    ],
    today
  );
  // CPI blocks [8:25, 9:30] → exactly the open minute — clamp leaves nothing (e > s fails).
  // A [t-5, t+60] window for 8:30 ends 9:30 sharp, so no band survives; date-mismatch skipped.
  assert.equal(bands.length, 0);
});

test("macroWindowBands: date-only (imprecise) row blocks the in-session morning", () => {
  const today = "2026-07-13";
  const bands = macroWindowBands(
    [{ time: today, event: "Unknown-time print", country: "US", impact: "high" }],
    today
  );
  assert.equal(bands.length, 1);
  // Full-morning block [8:25, 12:00] clamps to [9:30, 12:00].
  assert.equal(bands[0]!.startMin, RTH_START_MIN);
  assert.equal(bands[0]!.endMin, 12 * 60);
});

// ── lane assignment ─────────────────────────────────────────────────────────

function band(id: string, startMin: number, endMin: number): TimebarBand {
  return { id, label: id, detail: id, startMin, endMin, tone: "or" };
}

test("assignTimebarLanes: disjoint bands all take lane 0", () => {
  const laned = assignTimebarLanes([
    band("a", 575, 630),
    band("b", 840, 945),
    band("c", 900, 955), // overlaps b → lane 1
  ]);
  const lanes = Object.fromEntries(laned.map((b) => [b.id, b.lane]));
  assert.equal(lanes.a, 0);
  assert.equal(lanes.b, 0);
  assert.equal(lanes.c, 1);
});

test("assignTimebarLanes: lane 0 frees up after its occupant ends", () => {
  const laned = assignTimebarLanes([
    band("a", 570, 600),
    band("b", 580, 620), // overlaps a → lane 1
    band("c", 610, 650), // a ended → back to lane 0
  ]);
  const lanes = Object.fromEntries(laned.map((b) => [b.id, b.lane]));
  assert.equal(lanes.a, 0);
  assert.equal(lanes.b, 1);
  assert.equal(lanes.c, 0);
});

test("assignTimebarLanes: unsorted input is sorted by start time", () => {
  const laned = assignTimebarLanes([band("late", 900, 955), band("early", 575, 630)]);
  assert.equal(laned[0]!.id, "early");
  assert.equal(laned[1]!.id, "late");
  assert.equal(laned[0]!.lane, 0);
  assert.equal(laned[1]!.lane, 0);
});
