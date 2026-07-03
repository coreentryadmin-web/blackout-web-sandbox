import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIncidentsToResolve } from "./admin-incidents";

test("resolves open rows not in the active set when no scope is given", () => {
  const open = [
    { fingerprint: "a:1", category: "spx" },
    { fingerprint: "b:2", category: "spx" },
  ];
  const resolved = computeIncidentsToResolve(open, new Set(["a:1"]));
  assert.deepEqual(resolved, ["b:2"]);
});

test("never resolves a fingerprint still in the active set", () => {
  const open = [{ fingerprint: "a:1", category: "spx" }];
  const resolved = computeIncidentsToResolve(open, new Set(["a:1"]));
  assert.deepEqual(resolved, []);
});

test("resolveScope excludes categories the caller doesn't own", () => {
  const open = [
    { fingerprint: "a:1", category: "data-integrity-freshness" },
    { fingerprint: "b:2", category: "spx-halt" },
  ];
  const resolved = computeIncidentsToResolve(open, new Set(), (cat) => !cat.startsWith("data-integrity"));
  assert.deepEqual(resolved, ["b:2"]);
});

test("resolveScope scoped to data-integrity only resolves that namespace", () => {
  const open = [
    { fingerprint: "a:1", category: "data-integrity-freshness" },
    { fingerprint: "b:2", category: "spx-halt" },
  ];
  const resolved = computeIncidentsToResolve(open, new Set(), (cat) => cat.startsWith("data-integrity"));
  assert.deepEqual(resolved, ["a:1"]);
});

test("empty open set resolves nothing", () => {
  assert.deepEqual(computeIncidentsToResolve([], new Set()), []);
});

test("scope AND active-set exclusion combine — a scoped, still-active row is not resolved", () => {
  const open = [{ fingerprint: "a:1", category: "data-integrity-freshness" }];
  const resolved = computeIncidentsToResolve(open, new Set(["a:1"]), (cat) => cat.startsWith("data-integrity"));
  assert.deepEqual(resolved, []);
});
