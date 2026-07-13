import { test } from "node:test";
import assert from "node:assert/strict";

import {
  answeredParts,
  biasToneClass,
  confidenceToneClass,
  evidenceKindToneClass,
  freshnessToneClass,
  headlineFromMarkdown,
  relativeTime,
} from "./answer-format";
import type { BieSection } from "@/lib/bie/answer-envelope";

test("tone-class helpers are stable and scoped", () => {
  assert.equal(biasToneClass("bullish"), "bie-bias-bullish");
  assert.equal(confidenceToneClass("insufficient"), "bie-conf-insufficient");
  assert.equal(evidenceKindToneClass("calc"), "bie-kind-calc");
  assert.equal(freshnessToneClass("stale"), "bie-fresh-stale");
});

test("relativeTime formats and rejects bad input", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");
  assert.equal(relativeTime(null, now), null);
  assert.equal(relativeTime("not-a-date", now), null);
  assert.equal(relativeTime("2026-07-13T11:59:30Z", now), "just now");
  assert.equal(relativeTime("2026-07-13T11:45:00Z", now), "15m ago");
  assert.equal(relativeTime("2026-07-13T09:00:00Z", now), "3h ago");
  assert.equal(relativeTime("2026-07-11T12:00:00Z", now), "2d ago");
  // A future timestamp is clamped to "just now", never negative.
  assert.equal(relativeTime("2026-07-13T12:05:00Z", now), "just now");
});

test("answeredParts counts unavailable sections as unanswered", () => {
  const sections: BieSection[] = [
    { title: "SPX", body: "..." },
    { title: "Flow", body: "..." },
    { title: "News", body: "", unavailable: { reason: "Benzinga key missing" } },
  ];
  assert.deepEqual(answeredParts(sections), { answered: 2, total: 3 });
  assert.deepEqual(answeredParts([]), { answered: 0, total: 0 });
});

test("headlineFromMarkdown extracts first meaningful line, stripped and truncated", () => {
  assert.equal(headlineFromMarkdown("**SPX holding above VWAP**  _(bullish)_"), "SPX holding above VWAP");
  assert.equal(headlineFromMarkdown("---\n\n## Read\nbody"), "Read");
  assert.equal(headlineFromMarkdown("   \n\n"), "Largo read");
  const long = "x".repeat(120);
  const out = headlineFromMarkdown(long);
  assert.ok(out.length <= 90 && out.endsWith("…"));
});
