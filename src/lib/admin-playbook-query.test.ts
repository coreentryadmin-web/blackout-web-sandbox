import test from "node:test";
import assert from "node:assert/strict";
import { parseAdminSessionDate, parseAdminSinceDate } from "./admin-playbook-query";

test("parseAdminSessionDate: accepts ISO date", () => {
  const r = parseAdminSessionDate("2026-07-10", "2026-07-11");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, "2026-07-10");
});

test("parseAdminSessionDate: rejects malformed", () => {
  const r = parseAdminSessionDate("07-10-2026", "2026-07-11");
  assert.equal(r.ok, false);
});

test("parseAdminSinceDate: empty is ok", () => {
  const r = parseAdminSinceDate(null);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, undefined);
});
