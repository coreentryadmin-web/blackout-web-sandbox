import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatKnowledgeFootnotes } from "@/lib/bie/platform-footnotes";

describe("platform-context helpers", () => {
  test("formatKnowledgeFootnotes returns null for empty", () => {
    assert.equal(formatKnowledgeFootnotes([]), null);
  });

  test("formatKnowledgeFootnotes formats retrieved chunks", () => {
    const out = formatKnowledgeFootnotes([
      { source: "FINDINGS.md", kind: "finding", chunk: "GEX flip must match desk.", similarity: 0.42 },
    ]);
    assert.ok(out?.includes("Desk knowledge"));
    assert.ok(out?.includes("GEX flip"));
  });
});
