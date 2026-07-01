import { test } from "node:test";
import assert from "node:assert/strict";
import { isIosAppShell } from "./ios-app-shell";

test("returns false when there is no document (SSR / plain Node)", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(isIosAppShell(), false);
});
