import test from "node:test";
import assert from "node:assert/strict";
import { largoEnabled } from "@/lib/largo-env";

test("largoEnabled: false when NEXT_PUBLIC_SITE_URL is staging", () => {
  const prev = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
  assert.equal(largoEnabled(), false);
  process.env.NEXT_PUBLIC_SITE_URL = prev;
});

test("largoEnabled: true on production origin", () => {
  const prev = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
  assert.equal(largoEnabled(), true);
  process.env.NEXT_PUBLIC_SITE_URL = prev;
});
