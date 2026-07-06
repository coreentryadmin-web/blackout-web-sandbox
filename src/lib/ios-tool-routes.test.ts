import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isIosToolRoute } from "@/lib/ios-tool-routes";

describe("isIosToolRoute", () => {
  it("matches primary tool paths", () => {
    assert.equal(isIosToolRoute("/dashboard"), true);
    assert.equal(isIosToolRoute("/flows"), true);
    assert.equal(isIosToolRoute("/heatmap"), true);
    assert.equal(isIosToolRoute("/terminal"), true);
    assert.equal(isIosToolRoute("/nighthawk/edition"), true);
    assert.equal(isIosToolRoute("/grid"), true);
  });

  it("rejects marketing and auth paths", () => {
    assert.equal(isIosToolRoute("/"), false);
    assert.equal(isIosToolRoute("/pricing"), false);
    assert.equal(isIosToolRoute("/sign-in"), false);
    assert.equal(isIosToolRoute("/faq"), false);
  });
});
