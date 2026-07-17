import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickLargoStatusLine, largoRouteStatus } from "./largo-status";

describe("largo-status", () => {
  it("returns intent-scoped copy when available", () => {
    const line = pickLargoStatusLine({ phase: "compose", intent: "helix_read", index: 0 });
    assert.match(line, /HELIX/i);
  });

  it("formats route status with ticker", () => {
    const msg = largoRouteStatus({ intent: "technical_read", ticker: "NVDA" });
    assert.match(msg, /NVDA/);
    assert.match(msg, /Routing/i);
  });
});
