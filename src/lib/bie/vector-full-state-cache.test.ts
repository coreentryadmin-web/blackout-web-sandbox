import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  vectorFullStateCacheKey,
  readVectorFullStateCache,
  writeVectorFullStateCache,
} from "./vector-full-state-cache";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";

describe("vector-full-state cache", () => {
  test("cache key is vector:full-state:{ticker}:{horizon}, normalized", () => {
    assert.equal(vectorFullStateCacheKey("nvda", "all"), "vector:full-state:NVDA:all");
    assert.equal(vectorFullStateCacheKey("SPY", "0dte"), "vector:full-state:SPY:0dte");
  });

  test("read returns null on a miss (never throws)", async () => {
    const miss = await readVectorFullStateCache("VFSNEVERWRITTEN", "weekly");
    assert.equal(miss, null);
  });

  test("write then read round-trips the full state (memory fallback when no Redis)", async () => {
    // A distinctive fake ticker so this never collides with a real cached snapshot.
    await writeVectorFullStateCache("VFSTESTX", "all", VECTOR_FULL_STATE_FIXTURE);
    const back = await readVectorFullStateCache("VFSTESTX", "all");
    // JSON round-trip through the shared cache preserves the whole object.
    assert.deepEqual(back, VECTOR_FULL_STATE_FIXTURE);
  });
});
