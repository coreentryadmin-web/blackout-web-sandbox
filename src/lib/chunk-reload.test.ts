import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isChunkLoadErrorMessage, CHUNK_ERROR_PATTERN_SOURCE } from "./chunk-reload";

test("isChunkLoadErrorMessage: matches the real deploy-race errors, ignores app errors", () => {
  // The exact strings observed live during a rollout.
  assert.ok(isChunkLoadErrorMessage("ChunkLoadError: Loading chunk 5784 failed."));
  assert.ok(isChunkLoadErrorMessage("Loading chunk 1471 failed.\n(error: https://.../_next/static/chunks/1471-e49e.js)"));
  assert.ok(isChunkLoadErrorMessage("Refused to execute script from 'https://.../_next/static/chunks/5784.js' because its MIME type ('text/plain') is not executable"));
  assert.ok(isChunkLoadErrorMessage("Failed to fetch dynamically imported module: https://.../x.js"));
  // An Error-like object (has .message) works too.
  assert.ok(isChunkLoadErrorMessage(new Error("ChunkLoadError: Loading chunk 3 failed")));
  // App/logic errors must NOT trigger a reload.
  assert.ok(!isChunkLoadErrorMessage("TypeError: cannot read properties of undefined"));
  assert.ok(!isChunkLoadErrorMessage("Network request failed"));
  assert.ok(!isChunkLoadErrorMessage(null));
  assert.ok(!isChunkLoadErrorMessage(""));
});

test("layout inline script embeds the canonical chunk-error pattern (kept in sync)", () => {
  const layout = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app", "layout.tsx"), "utf8");
  // The inline reload guard must use the exact shared pattern so the two never drift.
  assert.ok(
    layout.includes(CHUNK_ERROR_PATTERN_SOURCE),
    "app/layout.tsx must embed CHUNK_ERROR_PATTERN_SOURCE verbatim in its reload-guard script"
  );
  // The resource-error branch matches failed <script>/<link> loads under the chunks path (the
  // slashes are regex-escaped in the inline script, so check the distinctive tokens).
  assert.ok(layout.includes("static") && layout.includes("chunks") && layout.includes("tagName"), "guard must also catch failed chunk resource loads");
});
