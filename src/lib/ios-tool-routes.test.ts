import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getIosHeaderMeta,
  getIosRouteKey,
  getIosToolMeta,
  getIosToolNavLabel,
  getIosToolRouteIndex,
  isIosNativeShellRoute,
  isIosToolRoute,
  IOS_TOOLS,
} from "@/lib/ios-tool-routes";

describe("isIosToolRoute", () => {
  it("matches primary tool paths", () => {
    assert.equal(isIosToolRoute("/dashboard"), true);
    assert.equal(isIosToolRoute("/flows"), true);
    assert.equal(isIosToolRoute("/heatmap"), true);
    assert.equal(isIosToolRoute("/terminal"), true);
    assert.equal(isIosToolRoute("/nighthawk/edition"), true);
  });

  it("rejects marketing and auth paths", () => {
    assert.equal(isIosToolRoute("/"), false);
    assert.equal(isIosToolRoute("/pricing"), false);
    assert.equal(isIosToolRoute("/sign-in"), false);
    assert.equal(isIosToolRoute("/faq"), false);
  });

  it("resolves nav labels for tool routes", () => {
    assert.equal(getIosToolNavLabel("/dashboard"), "SPX Slayer");
    assert.equal(getIosToolNavLabel("/flows"), "HELIX");
    assert.equal(getIosToolNavLabel("/nighthawk/edition"), "Night Hawk");
    assert.equal(getIosToolNavLabel("/account"), null);
  });
});

describe("isIosNativeShellRoute", () => {
  it("includes tool routes and signed-in utility paths", () => {
    assert.equal(isIosNativeShellRoute("/dashboard"), true);
    assert.equal(isIosNativeShellRoute("/account"), true);
    assert.equal(isIosNativeShellRoute("/upgrade"), true);
    assert.equal(isIosNativeShellRoute("/admin/health"), true);
  });

  it("excludes marketing and auth paths", () => {
    assert.equal(isIosNativeShellRoute("/"), false);
    assert.equal(isIosNativeShellRoute("/sign-in"), false);
    assert.equal(isIosNativeShellRoute("/pricing"), false);
  });
});

describe("IOS_TOOLS metadata", () => {
  it("defines five primary tools with accents and instrument codes", () => {
    assert.equal(IOS_TOOLS.length, 5);
    assert.ok(IOS_TOOLS.every((t) => t.accent.startsWith("#")));
    assert.ok(IOS_TOOLS.every((t) => t.code.length >= 2 && t.code.length <= 4));
    assert.deepEqual(
      IOS_TOOLS.map((t) => t.code),
      ["SPX", "HLX", "THM", "LRG", "HWK"]
    );
  });

  it("resolves tool meta by path prefix", () => {
    assert.equal(getIosToolMeta("/flows")?.label, "HELIX");
    assert.equal(getIosToolMeta("/nighthawk/edition")?.short, "Hawk");
    assert.equal(getIosToolMeta("/pricing"), null);
  });

  it("returns tab order index for transitions", () => {
    assert.equal(getIosToolRouteIndex("/dashboard"), 0);
    assert.equal(getIosToolRouteIndex("/flows"), 1);
    assert.equal(getIosToolRouteIndex("/nighthawk"), 4);
    assert.equal(getIosToolRouteIndex("/account"), -1);
  });
});

describe("getIosRouteKey", () => {
  it("maps tool and utility paths to route keys", () => {
    assert.equal(getIosRouteKey("/dashboard"), "dashboard");
    assert.equal(getIosRouteKey("/terminal"), "largo");
    assert.equal(getIosRouteKey("/faq"), "faq");
    assert.equal(getIosRouteKey("/learn/spx-slayer"), "learn");
    assert.equal(getIosRouteKey("/admin/health"), "admin");
  });
});

describe("getIosHeaderMeta", () => {
  it("returns tagline kickers for tools", () => {
    assert.equal(getIosHeaderMeta("/flows").kicker, "Institutional flow tape");
    assert.equal(getIosHeaderMeta("/flows").title, "HELIX");
    assert.equal(getIosHeaderMeta("/flows").showBack, false);
  });

  it("returns utility titles with back affordance", () => {
    const account = getIosHeaderMeta("/account");
    assert.equal(account.title, "Account");
    assert.equal(account.kicker, "");
    assert.equal(account.showBack, true);
    assert.equal(getIosHeaderMeta("/learn").title, "Learn");
  });
});
