import test from "node:test";
import assert from "node:assert/strict";
import { PLAYBOOK_ARCHITECTURE_ASSUMPTIONS } from "./playbook-architecture-assumptions";

test("PLAYBOOK_ARCHITECTURE_ASSUMPTIONS: documents instance id limitation", () => {
  assert.match(PLAYBOOK_ARCHITECTURE_ASSUMPTIONS.instance_id_known_limitation, /P0/i);
  assert.equal(PLAYBOOK_ARCHITECTURE_ASSUMPTIONS.play_engine_poll_ms_rth, 2_000);
  assert.equal(PLAYBOOK_ARCHITECTURE_ASSUMPTIONS.session_timezone, "America/New_York (ET) — session_date, playbook windows, macro gates");
});
