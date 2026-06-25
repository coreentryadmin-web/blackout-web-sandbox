// Shared expiry-input validation for Night's Watch position writes.
//
// One source of truth imported by BOTH the POST /api/account/positions route and
// the PATCH /api/account/positions/[id] route so the two can never drift.
//
// Guards three failure classes that previously leaked past `isValidYmd`:
//  1. Wrong format          → not YYYY-MM-DD.
//  2. IMPOSSIBLE date       → Date.parse silently rolls 2026-02-30 → 03-02 and
//                             2026-06-31 → 07-01. That rolled value then (a) fails
//                             the Postgres DATE column INSERT as a 502 (not a clean
//                             400) and (b) corrupts the DTE math against the rolled
//                             day. We round-trip through Date to reject these.
//  3. PAST expiry           → an already-expired contract pins dte=0 and the
//                             position stays 'unavailable' forever. Rejected
//                             strictly-before today in ET (today itself = 0DTE is
//                             allowed and valid).

import { todayEt } from "@/lib/et-date";

export type ExpiryValidation =
  | { ok: true; ymd: string; listingWarning?: string }
  | { ok: false; error: string };

/** Strict YYYY-MM-DD format guard. */
function isYmdShape(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Validate a user-supplied option expiry.
 *
 * @param v    the raw input (expected YYYY-MM-DD string)
 * @param now  injectable clock for deterministic tests; defaults to new Date()
 * @returns    { ok:true, ymd } on success (optionally with a soft listingWarning
 *             for weekend dates), or { ok:false, error } with a 400-ready message.
 */
export function validateExpiryYmd(v: unknown, now: Date = new Date()): ExpiryValidation {
  if (!isYmdShape(v)) {
    return { ok: false, error: "expiry must be a valid YYYY-MM-DD date" };
  }

  // Round-trip through a UTC Date: an impossible date (e.g. 2026-02-30) rolls
  // forward, so the normalized ISO date no longer equals the input → reject.
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    return { ok: false, error: "expiry must be a real calendar date (YYYY-MM-DD)" };
  }

  // Reject strictly-before today in ET. Both strings are ISO YYYY-MM-DD so a
  // lexicographic compare is a correct date compare. Today (0DTE) is allowed.
  const today = todayEt(now);
  if (v < today) {
    return { ok: false, error: "expiry cannot be in the past" };
  }

  // Soft, non-blocking warning for weekend expiries (no standard equity/index
  // option settles Sat/Sun). getUTCDay() is safe — we built `d` at 00:00:00Z.
  const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) {
    return {
      ok: true,
      ymd: v,
      listingWarning: "expiry falls on a weekend; verify this contract is listed",
    };
  }

  return { ok: true, ymd: v };
}
