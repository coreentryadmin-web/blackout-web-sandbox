import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYBOOK_LIVE_ALLOWLIST_DEFAULT_STAGING,
  parsePlaybookLiveAllowlist,
} from "./spx-play-config";

test("parsePlaybookLiveAllowlist: staging default is PB-01..04", () => {
  const allowlist = parsePlaybookLiveAllowlist(undefined, true);
  assert.ok(allowlist);
  assert.deepEqual(
    [...allowlist].sort(),
    [...PLAYBOOK_LIVE_ALLOWLIST_DEFAULT_STAGING].sort()
  );
  assert.equal(allowlist.has("PB-12"), false);
});

test("parsePlaybookLiveAllowlist: prod unset returns null (no filter)", () => {
  assert.equal(parsePlaybookLiveAllowlist(undefined, false), null);
});

test("parsePlaybookLiveAllowlist: explicit list", () => {
  const allowlist = parsePlaybookLiveAllowlist("PB-04,PB-08", false);
  assert.ok(allowlist);
  assert.deepEqual([...allowlist], ["PB-04", "PB-08"]);
});

test("parsePlaybookLiveAllowlist: * disables filter", () => {
  assert.equal(parsePlaybookLiveAllowlist("*", true), null);
  assert.equal(parsePlaybookLiveAllowlist("all", true), null);
});
