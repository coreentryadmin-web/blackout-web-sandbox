/** @type {import('next').NextConfig} */

// FIX 2: Resolve the specific Railway hostname at config-load time from the
// RAILWAY_STATIC_URL env var (set automatically by Railway).  Fall back to
// an explicit RAILWAY_HOSTNAME override for local / staging overrides.
// Do NOT use the "**.railway.app" wildcard — that accepts every Railway app.
const railwayHostname = (() => {
  if (process.env.RAILWAY_HOSTNAME) return process.env.RAILWAY_HOSTNAME;
  if (process.env.RAILWAY_STATIC_URL) {
    try { return new URL(process.env.RAILWAY_STATIC_URL).hostname; } catch { /* malformed URL — ignore */ }
  }
  return null;
})();

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview.com https://*.tradingview.com https://clerk.blackouttrades.com https://*.clerk.accounts.dev; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https: wss:; frame-src 'self' https://s.tradingview.com https://*.tradingview.com; frame-ancestors 'self'",
  },
];

const remotePatterns = [
  { protocol: "https", hostname: "images.unsplash.com" },
];

// FIX 2: Only add Railway hostname when the env var is present so the wildcard
// "**.railway.app" is never used.  Set RAILWAY_HOSTNAME or RAILWAY_STATIC_URL
// in your Railway service variables to enable image proxying from that host.
if (railwayHostname) {
  remotePatterns.push({ protocol: "https", hostname: railwayHostname });
}

import os from "os";

// P3: os.cpus() can return an empty array (and is unreliable in constrained
// containers / cgroup-limited environments), so reading .length directly is
// fragile. Guard with optional chaining + a sane fallback of 1 core before the
// Math.max(1, ...-1) clamp so we never produce NaN or a value < 1.
const cpuCount = os.cpus()?.length || 1;

const nextConfig = {
  experimental: {
    cpus: Math.max(1, cpuCount - 1),
  },
  // instrumentation.ts register() runs at server startup automatically in Next 15
  // (the former experimental.instrumentationHook is now the default — flag removed).
  // Lint is enforced in CI via `npm run lint` (jsx-a11y) and `npm run lint:brand`
  // (no-grey brand guard), NOT during the production build — so a lint finding never
  // blocks a deploy. Build correctness is covered by tsc + next build itself.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    remotePatterns,
  },
  // spx-desk-merge.ts is isomorphic (used by client hooks) and lazily pulls
  // shared-cache -> ioredis for cross-instance Redis sticky state. ioredis is only
  // ever exercised on the server (guarded by process.env.REDIS_URL), but webpack
  // still bundles it into the client graph. Stub its Node built-ins on the client
  // so the build doesn't fail on "Can't resolve 'stream'/'crypto'/'dns'/'net'/'tls'".
  // (This replaced a `webpackIgnore: true` hack that left an unresolvable
  //  import("@/lib/shared-cache") in the server runtime -> ERR_MODULE_NOT_FOUND.)
  webpack: (config, { isServer, nextRuntime }) => {
    if (!isServer) {
      // ioredis is server-only (pulled lazily by shared-cache for cross-instance
      // Redis sticky state, guarded by process.env.REDIS_URL). It must never enter
      // the client bundle — it imports Node built-ins (stream/crypto/dns/net/tls and
      // node:diagnostics_channel). Alias it to false on the client so webpack drops
      // the whole subtree; it is never executed in the browser (REDIS_URL is unset).
      config.resolve.alias = { ...config.resolve.alias, ioredis: false };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        stream: false,
        crypto: false,
        dns: false,
        net: false,
        tls: false,
      };
    }
    // EDGE runtime: src/instrumentation.ts is bundled for BOTH the node and edge
    // runtimes (instrumentationHook). Its error sink lazily reaches @/lib/db -> pg,
    // and pg imports Node built-ins (fs/path/stream/...) that don't exist on edge,
    // failing the build. The edge path NEVER executes that code (instrumentation
    // returns early unless NEXT_RUNTIME === "nodejs"), so drop pg + its built-ins
    // from the edge graph exactly as we do for the client. The node server build is
    // untouched, so the DB sink still works at runtime.
    if (nextRuntime === "edge") {
      config.resolve.alias = { ...config.resolve.alias, pg: false, "pg-native": false };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        path: false,
        stream: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
