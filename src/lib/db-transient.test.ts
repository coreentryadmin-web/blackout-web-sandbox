import test from "node:test";
import assert from "node:assert/strict";
import { isTransientPgError } from "./db-transient";

test("isTransientPgError: PgBouncer server_login_retry", () => {
  assert.equal(
    isTransientPgError(
      new Error(
        "server login has been failing, cached error: connect failed (server_login_retry)"
      )
    ),
    true
  );
});

test("isTransientPgError: connection terminated", () => {
  assert.equal(isTransientPgError(new Error("Connection terminated unexpectedly")), true);
});

test("isTransientPgError: pg error codes", () => {
  assert.equal(isTransientPgError({ code: "57P01", message: "admin shutdown" }), true);
  assert.equal(isTransientPgError({ code: "53300", message: "too many connections" }), true);
});

test("isTransientPgError: non-transient constraint violation", () => {
  assert.equal(
    isTransientPgError({ code: "23505", message: 'duplicate key value violates unique constraint "foo"' }),
    false
  );
});

test("isTransientPgError: syntax error", () => {
  assert.equal(isTransientPgError(new Error('syntax error at or near "SELCT"')), false);
});
