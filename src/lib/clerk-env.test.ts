import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clerkAllowedRedirectOrigins,
  clerkIsSatellite,
  clerkMiddlewareAuthOptions,
  clerkPrimarySignInUrl,
  clerkProxyUrl,
  clerkSatelliteAuthRedirect,
  clerkSatelliteProviderProps,
} from "./clerk-env";

test("clerkAllowedRedirectOrigins: staging self-origin when allowlist env unset", () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  const prevRaw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
  const prevSat = process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
  try {
    delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    delete process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    assert.deepEqual(clerkAllowedRedirectOrigins(), ["https://staging.blackouttrades.com"]);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    if (prevRaw === undefined) delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    else process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS = prevRaw;
    if (prevSat === undefined) delete process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
    else process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE = prevSat;
  }
});

test("clerkAllowedRedirectOrigins: prod allows staging when allowlist env unset", () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  const prevRaw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
  const prevSat = process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
  try {
    delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    delete process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
    process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
    assert.deepEqual(clerkAllowedRedirectOrigins(), ["https://staging.blackouttrades.com"]);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    if (prevRaw === undefined) delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
    else process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS = prevRaw;
    if (prevSat === undefined) delete process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
    else process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE = prevSat;
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

test("clerkIsSatellite: auto-detects staging deploy", () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  const prevSat = process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
  try {
    delete process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    assert.equal(clerkIsSatellite(), true);
    process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
    assert.equal(clerkIsSatellite(), false);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    if (prevSat === undefined) delete process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE;
    else process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE = prevSat;
  }
});

test("clerkSatelliteAuthRedirect: sends staging users to primary sign-in", () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    assert.equal(
      clerkSatelliteAuthRedirect("sign-in", "/dashboard"),
      "https://blackouttrades.com/sign-in?redirect_url=https%3A%2F%2Fstaging.blackouttrades.com%2Fdashboard"
    );
    assert.equal(
      clerkSatelliteAuthRedirect("sign-up", "/spx"),
      "https://blackouttrades.com/sign-up?redirect_url=https%3A%2F%2Fstaging.blackouttrades.com%2Fspx"
    );
    process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
    assert.equal(clerkSatelliteAuthRedirect("sign-in", "/dashboard"), null);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
  }
});

test("staging satellite: proxy + primary sign-in URLs", () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  const prevProxy = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
  const prevSignIn = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    delete process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
    delete process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
    assert.equal(clerkProxyUrl(), "https://staging.blackouttrades.com/__clerk");
    assert.equal(clerkPrimarySignInUrl(), "https://blackouttrades.com/sign-in");
    const provider = clerkSatelliteProviderProps();
    assert.equal(provider.isSatellite, true);
    assert.equal(provider.proxyUrl, "https://staging.blackouttrades.com/__clerk");
    assert.equal(provider.signInUrl, "https://blackouttrades.com/sign-in");
    const mw = clerkMiddlewareAuthOptions();
    assert.equal(mw.isSatellite, true);
    assert.equal(mw.frontendApiProxy?.enabled, true);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    if (prevProxy === undefined) delete process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
    else process.env.NEXT_PUBLIC_CLERK_PROXY_URL = prevProxy;
    if (prevSignIn === undefined) delete process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
    else process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = prevSignIn;
  }
});
