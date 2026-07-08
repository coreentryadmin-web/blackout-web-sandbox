import { test } from "node:test";
import assert from "node:assert/strict";
import { clerkAllowedRedirectOrigins } from "./clerk-env";

test("clerkAllowedRedirectOrigins: staging self-origin when allowlist env unset", () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  const prevRaw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
  try {
    delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    assert.deepEqual(clerkAllowedRedirectOrigins(), ["https://staging.blackouttrades.com"]);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    if (prevRaw === undefined) delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    else process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS = prevRaw;
  }
});

test("clerkAllowedRedirectOrigins: prod allows staging when allowlist env unset", () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  const prevRaw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
  try {
    delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
    assert.deepEqual(clerkAllowedRedirectOrigins(), ["https://staging.blackouttrades.com"]);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    if (prevRaw === undefined) delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    else process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS = prevRaw;
  }
});

test("clerkAllowedRedirectOrigins: explicit env wins", () => {
  const prevRaw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
  try {
    process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS =
      "https://staging.blackouttrades.com,https://blackouttrades.com";
    assert.deepEqual(clerkAllowedRedirectOrigins(), [
      "https://staging.blackouttrades.com",
      "https://blackouttrades.com",
    ]);
  } finally {
    if (prevRaw === undefined) delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    else process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS = prevRaw;
  }
});
