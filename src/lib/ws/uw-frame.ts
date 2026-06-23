/**
 * Pure, dependency-free classifiers for UW WebSocket frame payloads.
 *
 * Kept alias-free so it is directly importable under `tsx --test`.
 */

/**
 * True when an array-frame payload (the second element of `[channel, payload]`)
 * is a server error frame rather than a data row. UW error frames carry a
 * truthy, non-empty `error` field (string or object). Such a frame must never
 * be treated as proof that the channel is authenticated/open, and must not be
 * forwarded to data handlers.
 */
export function isUwErrorFrame(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const rec = payload as Record<string, unknown>;
  if (!("error" in rec)) return false;
  const err = rec.error;
  if (err == null) return false;
  if (typeof err === "string") return err.trim().length > 0;
  if (typeof err === "boolean") return err === true;
  // Non-empty object/array error detail counts as an error frame.
  if (typeof err === "object") return Object.keys(err as object).length > 0;
  return Boolean(err);
}
