import { test } from "node:test";
import assert from "node:assert/strict";
import { isClerkErrorClassName, shouldReportAuthFailure, DEDUPE_WINDOW_MS } from "./auth-failure-detect";

test("isClerkErrorClassName: matches Clerk's formFieldErrorText marker", () => {
  assert.equal(isClerkErrorClassName("cl-formFieldErrorText cl-formFieldErrorText__password abc123"), true);
});

test("isClerkErrorClassName: matches Clerk's alert marker", () => {
  assert.equal(isClerkErrorClassName("cl-alert cl-alert__error"), true);
});

test("isClerkErrorClassName: does not match an unrelated element", () => {
  assert.equal(isClerkErrorClassName("cl-formFieldInput cl-formFieldInput__password"), false);
});

test("isClerkErrorClassName: empty className never matches", () => {
  assert.equal(isClerkErrorClassName(""), false);
});

test("shouldReportAuthFailure: first-ever message always reports", () => {
  assert.equal(shouldReportAuthFailure("Password is incorrect", null, 1000), true);
});

test("shouldReportAuthFailure: blank/whitespace-only message never reports", () => {
  assert.equal(shouldReportAuthFailure("   ", null, 1000), false);
  assert.equal(shouldReportAuthFailure("", { message: "x", at: 0 }, 1000), false);
});

test("shouldReportAuthFailure: identical message within the dedupe window is suppressed", () => {
  const last = { message: "Password is incorrect", at: 1000 };
  assert.equal(shouldReportAuthFailure("Password is incorrect", last, 1000 + DEDUPE_WINDOW_MS - 1), false);
});

test("shouldReportAuthFailure: identical message AFTER the dedupe window reports again", () => {
  const last = { message: "Password is incorrect", at: 1000 };
  assert.equal(shouldReportAuthFailure("Password is incorrect", last, 1000 + DEDUPE_WINDOW_MS + 1), true);
});

test("shouldReportAuthFailure: a DIFFERENT message reports immediately, even inside the window", () => {
  const last = { message: "Password is incorrect", at: 1000 };
  assert.equal(shouldReportAuthFailure("Too many requests", last, 1001), true);
});
