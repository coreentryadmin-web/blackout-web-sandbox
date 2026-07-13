// Shared, side-effect-free grounding-marker renderer for BIE desk answers.
//
// The desk brief lines (SPX AND Vector) wrap every citable figure in `{{value}}` so the strict
// grounding guard can trace it. The member-facing answer must show the VALUE, not the marker — this
// renders them down. Kept in its own tiny module (no server-only imports) so it's unit-testable
// under `tsx --test` and genuinely shared by every composer (composers.ts pulls the server-only
// provider graph, so a helper defined there can't be imported by a test).

/** Replace every `{{value}}` marker with its inner value (`{{7,496}}` → `7,496`, `{{—}}` → `—`). */
export function stripGroundingTokens(text: string): string {
  return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, "$1");
}
