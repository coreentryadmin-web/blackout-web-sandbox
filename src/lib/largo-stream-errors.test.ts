import assert from "node:assert/strict";
import { test } from "node:test";
import { largoStreamErrorMessage } from "./largo-stream-errors";

test("largoStreamErrorMessage: maps auth and tier errors", () => {
  assert.equal(largoStreamErrorMessage("Market /largo/query → 401"), "Sign in with Premium to reach Largo.");
  assert.equal(
    largoStreamErrorMessage("Market /largo/query → 403", { ios: false }),
    "Largo is a Premium instrument. Unlock Premium to deploy it."
  );
  assert.equal(
    largoStreamErrorMessage("Market /largo/query → 403", { ios: true }),
    "Largo is a Premium instrument. Membership is managed on the web."
  );
});

test("largoStreamErrorMessage: maps rate limits and outages", () => {
  assert.match(
    largoStreamErrorMessage("Market /largo/query → 429"),
    /active Largo sessions/
  );
  assert.match(
    largoStreamErrorMessage("Daily Largo query limit reached (50/day)"),
    /Daily Largo query limit/
  );
  assert.match(largoStreamErrorMessage("Market /largo/query → 502"), /couldn't complete/);
  assert.match(largoStreamErrorMessage("Market /largo/query → 503"), /offline/);
});

test("largoStreamErrorMessage: maps stream cuts and timeouts", () => {
  assert.match(largoStreamErrorMessage("Largo stream ended without result"), /Connection dropped/);
  assert.match(largoStreamErrorMessage("Largo stream timeout"), /timed out/);
  assert.match(largoStreamErrorMessage("The operation was aborted"), /timed out/);
});
