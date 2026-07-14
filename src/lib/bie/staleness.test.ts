import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stalenessMarker, appendStalenessMarker } from "@/lib/bie/staleness";

// All fixtures pin BOTH the as-of instant and the `now` clock so the ET wall-clock math is fully
// deterministic (no dependence on when the suite runs). Times chosen for US ET (UTC-4, summer).
describe("stalenessMarker (PR-L4d-2)", () => {
  test("fresh RTH read → no marker", () => {
    // 2026-07-14 is a Tuesday. 15:00Z = 11:00 ET (mid-session), 2 min old.
    const asOf = "2026-07-14T15:00:00Z";
    const now = new Date("2026-07-14T15:02:00Z").getTime();
    assert.equal(stalenessMarker(asOf, now), null);
  });

  test("off-hours (after 16:00 ET) read → 'prior close' marker with the ET capture time", () => {
    // 00:10Z on the 15th = 20:10 ET on the 14th (after the close) — the task's exact example.
    const asOf = "2026-07-15T00:10:00Z";
    const now = new Date("2026-07-15T00:12:00Z").getTime();
    assert.equal(stalenessMarker(asOf, now), "· as of 20:10 ET, prior close");
  });

  test("weekend read → prior-close marker even inside RTH clock minutes", () => {
    // 2026-07-18 is a Saturday. 15:00Z = 11:00 ET — RTH minutes, but the weekend makes it off-hours.
    const asOf = "2026-07-18T15:00:00Z";
    const now = new Date("2026-07-18T15:01:00Z").getTime();
    assert.equal(stalenessMarker(asOf, now), "· as of 11:00 ET, prior close");
  });

  test("pre-market (before 09:30 ET) read → prior-close marker", () => {
    // 12:00Z = 08:00 ET on a Tuesday — before the open.
    const asOf = "2026-07-14T12:00:00Z";
    const now = new Date("2026-07-14T12:01:00Z").getTime();
    assert.equal(stalenessMarker(asOf, now), "· as of 08:00 ET, prior close");
  });

  test("RTH but STALE by age (cron stalled) → 'delayed' marker, not prior close", () => {
    // 14:00Z = 10:00 ET mid-session, but the read is 40 min old → delayed.
    const asOf = "2026-07-14T14:00:00Z";
    const now = new Date("2026-07-14T14:40:00Z").getTime();
    assert.equal(stalenessMarker(asOf, now), "· as of 10:00 ET, delayed");
  });

  test("no / unparseable timestamp → no fabricated marker", () => {
    assert.equal(stalenessMarker(null), null);
    assert.equal(stalenessMarker(undefined), null);
    assert.equal(stalenessMarker("not-a-date"), null);
  });

  test("appendStalenessMarker only appends when stale", () => {
    const fresh = "2026-07-14T15:00:00Z";
    const nowFresh = new Date("2026-07-14T15:01:00Z").getTime();
    assert.equal(appendStalenessMarker("body", fresh, nowFresh), "body");

    const stale = "2026-07-15T00:10:00Z";
    const nowStale = new Date("2026-07-15T00:11:00Z").getTime();
    assert.equal(appendStalenessMarker("body", stale, nowStale), "body\n\n· as of 20:10 ET, prior close");
  });
});
