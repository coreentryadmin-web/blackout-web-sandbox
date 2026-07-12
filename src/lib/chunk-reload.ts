/**
 * Canonical detector for "the browser failed to load a JS/CSS chunk" errors. During a deploy the
 * freshly-served HTML can reference chunk hashes the CDN/edge hasn't caught up to yet (or is briefly
 * serving an error page for), so a member who loads mid-rollout gets a `ChunkLoadError` and a blank
 * or half-rendered page. The fix is a one-shot guarded reload (see the inline script in
 * `app/layout.tsx`) — after the deploy settles, the reload pulls the correct chunks and the page
 * renders. This module is the SHARED, unit-tested matcher; the layout's inline head script mirrors
 * the same pattern (kept in sync by `chunk-reload.test.ts`, which asserts the layout embeds it).
 */

/** Source-of-truth pattern. Kept as a string so the layout's inline script can embed it verbatim. */
export const CHUNK_ERROR_PATTERN_SOURCE =
  "ChunkLoadError|Loading chunk [0-9]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Refused to execute script|Importing a module script failed";

const CHUNK_ERROR_RE = new RegExp(CHUNK_ERROR_PATTERN_SOURCE, "i");

/** True when `message` looks like a chunk/dynamic-import load failure (not an app logic error). */
export function isChunkLoadErrorMessage(message: unknown): boolean {
  if (message == null) return false;
  const s = typeof message === "string" ? message : String((message as { message?: unknown }).message ?? message);
  return CHUNK_ERROR_RE.test(s);
}
