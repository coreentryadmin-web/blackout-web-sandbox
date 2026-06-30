import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  largoFailClosedWithoutRedis,
  shouldRejectLargoWithoutRedis,
} from "./largo-redis-policy";

describe("largo-redis-policy", () => {
  it("defaults to fail-closed when LARGO_REDIS_FAILOPEN unset", () => {
    assert.equal(largoFailClosedWithoutRedis({}), true);
    assert.equal(shouldRejectLargoWithoutRedis(false, {}), true);
    assert.equal(shouldRejectLargoWithoutRedis(true, {}), false);
  });

  it("fail-open when LARGO_REDIS_FAILOPEN=1", () => {
    assert.equal(largoFailClosedWithoutRedis({ LARGO_REDIS_FAILOPEN: "1" }), false);
    assert.equal(shouldRejectLargoWithoutRedis(false, { LARGO_REDIS_FAILOPEN: "1" }), false);
  });
});
