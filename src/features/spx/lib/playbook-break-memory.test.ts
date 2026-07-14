import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyOrBreakMemory,
  pb14LongBreakReady,
  pb14ShortBreakReady,
  updateOrBreakMemory,
} from "./playbook-break-memory";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

test("updateOrBreakMemory: low break then re-entry flags long PB-14 path", () => {
  const session = "2026-07-10";
  let memory = emptyOrBreakMemory(session);
  const technicals = {
    or_defined: true,
    or_high: 7400,
    or_low: 7370,
  } as PlayTechnicals;

  memory = updateOrBreakMemory(memory, { price: 7365 } as SpxDeskPayload, technicals);
  assert.equal(memory.broke_below_or_low, true);
  assert.equal(pb14LongBreakReady(memory), false);

  memory = updateOrBreakMemory(memory, { price: 7385 } as SpxDeskPayload, technicals);
  assert.equal(memory.reentered_after_low_break, true);
  assert.equal(pb14LongBreakReady(memory), true);
  assert.equal(pb14ShortBreakReady(memory), false);
});
