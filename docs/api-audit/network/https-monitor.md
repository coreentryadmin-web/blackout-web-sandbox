# HTTPS / Network Health Monitor

Automated TLS, availability, security-header, redirect, and CDN health checks for `www.blackouttrades.com`.

## 2026-06-27 03:23 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1)
### Availability: all live routes healthy — **PASS**
- Landing 200 (710ms), Sign In 200 (321ms), Sign Up 200 (180ms)
- /grid 200 (150ms), /track-record 200, /api/health 200 (128ms)
- Protected page routes (/dashboard, /flows, /heatmap, /nighthawk, /terminal) → **404 by design**: Clerk `auth.protect()` returns 404 for signed-out requests (see `src/middleware.ts` isProtectedRoute). Not an outage — the monitor is unauthenticated.
- Auth-gated APIs returning 401 (working as intended): /api/market/gex-positioning, /api/market/flows, /api/market/spx/pulse
- **No 5xx. No P0.**
### Security Headers: 6/6 present — **PASS**
- Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Content-Security-Policy, Permissions-Policy all OK.
- WARN: `X-Powered-By: Next.js` leaking (minor info disclosure — consider `poweredByHeader: false` in next.config). `Server: cloudflare` is expected (CF edge).
### Redirects: **PASS** — http→https 301 → https://www.blackouttrades.com/ ; /pricing 307 → /#pricing
### CDN: **PASS** — Cloudflare edge (CF-Ray a122b2a79f0d5195-SEA), Railway request ID present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`
### Monitor maintenance: corrected 2 stale probe paths in the task file this run
- `/api/market/spx-pulse` (404, nonexistent) → `/api/market/spx/pulse` (real, 401)
- `/api/flows` (404, nonexistent) → `/api/market/flows` (real, 401)
---

## 2026-06-27 07:14 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1)
### Availability: all live routes healthy — **PASS**
- Landing 200 (509ms), Sign In 200 (234ms), Sign Up 200 (201ms), /grid 200 (491ms), /track-record 200, /api/health 200 (132ms)
- **Root-caused the protected-route "404"** (refines the 03:23 entry): it is a *non-document request* artifact, **not** a blanket "404 for signed-out." Clerk `auth.protect()` only 404-rewrites probes that lack a browser `Accept` header (the monitor sent `Accept: */*` → header `X-Clerk-Auth-Reason: protect-rewrite`, `X-Middleware-Rewrite: /clerk_…`). Re-probed all five (`/dashboard /flows /heatmap /nighthawk /terminal`) with `Accept: text/html` → **307 → /sign-in?redirect_url=…** every time. Real browsers/users are redirected correctly; routes are healthy.
- Auth-gated APIs 401 as intended: /api/market/gex-positioning, /api/market/flows, /api/market/spx/pulse
- **No 5xx. No P0.**
### Security Headers: 6/6 present — **PASS** (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP, Permissions-Policy)
- WARN (unchanged, low priority): `X-Powered-By: Next.js` leaking → `poweredByHeader: false` in next.config to harden. `Server: cloudflare` expected.
### Redirects: **PASS** — http→https 301 → https://www.blackouttrades.com/ ; /pricing 307 → /#pricing
### CDN: **PASS** — Cloudflare edge (CF-Ray a12402125a5176d4-SEA), Railway request ID present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`
### Monitor calibration note
- The Step 2 availability probe should send `Accept: text/html` for page routes so protected routes report their true **307→/sign-in** instead of a misleading 404. APIs correctly return 401 (already not counted as failures — only 5xx is). No code/app defect found this run.
---
