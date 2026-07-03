import test from "node:test";
import assert from "node:assert/strict";

/** Mirror of db.ts ymdOf — keep in sync; locks pg DATE midnight-UTC → YYYY-MM-DD. */
function ymdOf(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

test("ymdOf: pg DATE midnight UTC stays on the calendar day (not local-tz shifted)", () => {
  const expiry = new Date("2026-07-17T00:00:00.000Z");
  assert.equal(ymdOf(expiry), "2026-07-17");
});

test("ymdOf: ISO string input slices date part", () => {
  assert.equal(ymdOf("2026-10-16T00:00:00.000Z"), "2026-10-16");
});
