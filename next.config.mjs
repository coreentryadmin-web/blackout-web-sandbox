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
    // FIX 1: Removed 'unsafe-eval' and 'unsafe-inline' from script-src.
    // TradingView widgets are loaded from their CDN domains explicitly.
    // Clerk auth JS is served from clerk.accounts.dev / clerk.blackouttrades.com
    // (add your Clerk Frontend API hostname if it differs).
    // 'unsafe-inline' is kept only in style-src for Tailwind / inline styles.
    // Added upgrade-insecure-requests.
    value:
      "default-src 'self'; " +
      "script-src 'self' https://s.tradingview.com https://*.tradingview.com https://clerk.blackouttrades.com https://*.clerk.accounts.dev; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; " +
      "img-src 'self' data: blob: https:; " +
      "connect-src 'self' https: wss:; " +
      "frame-src 'self' https://s.tradingview.com https://*.tradingview.com; " +
      "frame-ancestors 'self'; " +
      "upgrade-insecure-requests",
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

const nextConfig = {
  experimental: {
    cpus: Math.max(1, os.cpus().length - 1),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    remotePatterns,
  },
};

export default nextConfig;
