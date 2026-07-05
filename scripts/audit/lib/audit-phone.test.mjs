import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDefaultAuditPhone } from './audit-phone.mjs';

test('generateDefaultAuditPhone produces a valid +1415555XXXX number with real randomness', () => {
  for (let i = 0; i < 25; i++) {
    const phone = generateDefaultAuditPhone();
    assert.match(phone, /^\+1415555\d{4}$/);
  }
});

test('generateDefaultAuditPhone zero-pads the injected random suffix', () => {
  assert.equal(generateDefaultAuditPhone(() => 0), '+14155550000');
  assert.equal(generateDefaultAuditPhone(() => 42), '+14155550042');
  assert.equal(generateDefaultAuditPhone(() => 123), '+14155550123');
  assert.equal(generateDefaultAuditPhone(() => 9999), '+14155559999');
});

test('generateDefaultAuditPhone varies across calls (regression guard against an accidental constant return)', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(generateDefaultAuditPhone());
  // 30 draws from a 10,000-value space landing on the same value every time is
  // astronomically unlikely — this only guards against the function silently
  // degrading back into a hardcoded constant, not full-blown statistical uniformity.
  assert.ok(seen.size > 1, 'expected multiple distinct phone numbers across 30 calls');
});
