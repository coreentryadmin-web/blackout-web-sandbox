import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement } from "react";
import { renderEmphasis } from "@/features/spx/lib/spx-emphasis";

type EmphSpan = ReactElement<{ className?: string; children?: unknown }>;

function stringLeaves(nodes: ReturnType<typeof renderEmphasis>): string[] {
  return nodes.filter((n): n is string => typeof n === "string");
}
function spans(nodes: ReturnType<typeof renderEmphasis>): EmphSpan[] {
  return nodes.filter((n): n is EmphSpan => isValidElement(n));
}

test("a Watch item 'γflip {{7,543}}' renders 7,543 emphasized with NO literal braces (the live leak)", () => {
  const out = renderEmphasis("γflip {{7,543}}");

  // No plain-text leaf carries the literal marker any more.
  for (const s of stringLeaves(out)) {
    assert.ok(!s.includes("{{") && !s.includes("}}"), `literal braces leaked in: "${s}"`);
  }
  // The number lives INSIDE the emphasis span, not as raw text.
  const [span, ...rest] = spans(out);
  assert.ok(span, "expected one emphasis span");
  assert.equal(rest.length, 0);
  assert.equal(span.props.className, "spx-ai-key");
  assert.equal(span.props.children, "7,543");
  // …and the number does NOT appear as a plain string leaf.
  assert.ok(!stringLeaves(out).some((s) => s.includes("7,543")));
  // The neon-yellow label prefix survives as plain text.
  assert.ok(stringLeaves(out).some((s) => s.includes("γflip")));
});

test("text with no markers passes through unchanged (single plain string)", () => {
  assert.deepEqual(renderEmphasis("no braces here"), ["no braces here"]);
});

test("multiple markers each become their own emphasis span, braces fully stripped", () => {
  const out = renderEmphasis("call wall {{7,600}} · put wall {{7,500}}");
  assert.deepEqual(spans(out).map((s) => s.props.children), ["7,600", "7,500"]);
  for (const s of stringLeaves(out)) {
    assert.ok(!s.includes("{{") && !s.includes("}}"));
  }
});

test("empty markers and empty input don't throw or emit braces", () => {
  assert.equal(spans(renderEmphasis("{{}}")).length, 1);
  assert.deepEqual(renderEmphasis(""), []);
});
