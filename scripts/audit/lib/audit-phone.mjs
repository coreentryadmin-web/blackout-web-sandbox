/**
 * Generates the default phone number for data-validator.mjs's temp Clerk audit user.
 *
 * BACKGROUND (task #175): the old default was a single hardcoded constant,
 * +14155550123. Clerk enforces phone-number uniqueness per instance, and that exact
 * number eventually ended up registered to a Clerk user (most likely this script's own
 * temp user from a run whose end-of-run DELETE didn't stick, though it could equally be
 * an unrelated account) — after that, EVERY subsequent run failed at temp-user creation
 * with no recovery short of an operator remembering to set AUDIT_PHONE by hand. Since
 * this script is invoked by the standing daily 13:32 UTC scheduled market-open
 * validation trigger (docs/audit/MARKET-OPEN-VALIDATION.md), "remember to set an env var
 * every run" is not a durable fix for an unattended job.
 *
 * FIX: derive a fresh last-4-digits suffix per run instead of hardcoding one value.
 * `AUDIT_PHONE` (if set) is still used verbatim — this function is only the fallback.
 *
 * FORMAT CHOICE — area code 415, exchange 555, fixed; last 4 digits randomized over the
 * FULL 0000-9999 range (not narrowed to the officially-reserved-for-fiction 555-0100
 * .. 555-0199 sub-block, which is where the old default's "0123" suffix happened to
 * live):
 *   - The "555" middle-three-digit exchange is itself already the universally
 *     recognized "this is a fake/non-dialable U.S. number" convention — real carriers
 *     do not assign 555 to live subscriber lines outside that narrow 100-number
 *     directory-assistance-adjacent block. So any 4-digit suffix under 415-555 is
 *     exactly as safe/non-reachable in practice as one drawn from the smaller reserved
 *     sub-block — there is no realism/safety benefit to narrowing further.
 *   - Using the full 10,000-value range instead of only 100 gives ~100x more collision
 *     headroom for the one case that actually matters here — two runs landing on the
 *     same value close enough in time that both are alive in Clerk simultaneously (e.g.
 *     a scheduled run overlapping a manual re-run; steady-state reruns don't accumulate
 *     collision risk since each run's temp user, and its phone, is deleted at the end)
 *     — for zero added complexity.
 *   - This is a deleted-within-seconds test fixture, not a security control, so no
 *     cryptographic guarantee is needed; node:crypto's randomInt is used simply because
 *     it's already a zero-dependency stdlib source of an unbiased integer.
 *
 * `rand` is injectable (defaults to node:crypto's randomInt) so the output format can be
 * unit-tested deterministically without depending on real randomness.
 */
import { randomInt } from 'node:crypto';

export function generateDefaultAuditPhone(rand = randomInt) {
  const suffix = String(rand(0, 10000)).padStart(4, '0');
  return `+1415555${suffix}`;
}
