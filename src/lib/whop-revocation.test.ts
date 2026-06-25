import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTierFromMemberships } from "./whop";

// resolveTierFromMembership reads getPremiumProductIds() (process.env) LIVE on each call, so setting
// this before the test callbacks run is enough to classify our test product as premium.
process.env.WHOP_PREMIUM_PRODUCT_IDS = "prod_premium";

type Mem = Parameters<typeof resolveTierFromMemberships>[0][number];
const mem = (id: string, status: string, productId: string): Mem =>
  ({ id, status, plan: { id: "plan_x" }, product: { id: productId } }) as unknown as Mem;

// audit launch-path #6 — refund/chargeback revocation of a (possibly still-'completed') membership.

test("a premium membership grants premium when NOT revoked", () => {
  const m = mem("mem_1", "completed", "prod_premium"); // one-time / lifetime
  assert.equal(resolveTierFromMemberships([m]), "premium");
});

test("the SAME premium membership resolves FREE once revoked (refunded/disputed)", () => {
  const m = mem("mem_1", "completed", "prod_premium");
  assert.equal(resolveTierFromMemberships([m], new Set(["mem_1"])), "free");
});

test("a still-live premium membership keeps premium even when another is revoked", () => {
  const revoked = mem("mem_r", "completed", "prod_premium");
  const live = mem("mem_l", "active", "prod_premium");
  assert.equal(resolveTierFromMemberships([revoked, live], new Set(["mem_r"])), "premium");
});

test("revocation of a non-premium membership is a no-op (already free)", () => {
  const m = mem("mem_2", "active", "prod_other");
  assert.equal(resolveTierFromMemberships([m]), "free");
  assert.equal(resolveTierFromMemberships([m], new Set(["mem_2"])), "free");
});
