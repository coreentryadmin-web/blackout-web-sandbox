import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import { mergePlayWithCache } from "@/features/spx/hooks/useSpxPlay";

function basePlay(overrides: Partial<SpxPlayPayload> = {}): SpxPlayPayload {
  return {
    available: true,
    action: "SCANNING",
    direction: null,
    phase: "FLAT",
    as_of: "2026-07-05T14:00:00.000Z",
    signal_committed: false,
    factors: [],
    gates: { passed: false, blocks: [], warnings: [], play_idea: null },
    levels: {},
    technicals: null,
    mtf: null,
    watch: null,
    telemetry: null,
    confirmations: null,
    ...overrides,
  } as SpxPlayPayload;
}

test("mergePlayWithCache does not resurrect cached confirmations on fresh SCANNING", () => {
  const cached = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: {
      passed_count: 4,
      total: 4,
      checks: [{ label: "Tide", detail: "bullish", passed: true }],
    },
  });
  const fresh = basePlay({ action: "SCANNING", direction: "long", confirmations: null });

  const merged = mergePlayWithCache(fresh, cached);
  assert.equal(merged?.action, "SCANNING");
  assert.equal(merged?.confirmations, null);
});

test("mergePlayWithCache still bridges confirmation gaps for same-direction WATCHING", () => {
  const cached = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: {
      passed_count: 3,
      total: 4,
      checks: [{ label: "Tide", detail: "bullish", passed: true }],
    },
  });
  const fresh = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: null,
  });

  const merged = mergePlayWithCache(fresh, cached);
  assert.equal(merged?.confirmations?.passed_count, 3);
});

test("mergePlayWithCache drops cached confirmations when direction flips", () => {
  const cached = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: {
      passed_count: 4,
      total: 4,
      checks: [{ label: "Tide", detail: "bullish", passed: true }],
    },
  });
  const fresh = basePlay({
    action: "WATCHING",
    direction: "short",
    confirmations: null,
  });

  const merged = mergePlayWithCache(fresh, cached);
  assert.equal(merged?.confirmations, null);
});
