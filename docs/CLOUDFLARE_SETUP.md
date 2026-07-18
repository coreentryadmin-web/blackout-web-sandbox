# Cloudflare Setup — blackouttrades.com

> **Note:** Railway references in this doc are stale — origin is now an AWS ALB
> (ECS Fargate), not Railway. DNS CNAMEs, SSL, and origin config sections need
> updating. General Cloudflare concepts still apply.

Complete step-by-step guide to put blackouttrades.com behind Cloudflare (CDN, DDoS, cache, WAF).

---

## 1. Add the Site to Cloudflare

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a Site** → enter `blackouttrades.com`.
2. Choose the **Free** plan (or Pro for WAF/bot management).
3. Cloudflare scans existing DNS records — verify they are imported correctly.
4. Copy the two Cloudflare nameservers shown (e.g. `ada.ns.cloudflare.com`, `tom.ns.cloudflare.com`).
5. At your domain registrar (e.g. GoDaddy, Namecheap), replace the current nameservers with Cloudflare's.
6. Propagation takes 5 – 30 minutes. Cloudflare will email you when the site is active.

**DNS records to verify after import:**

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `@` | Railway public IP (or CNAME) | Proxied (orange cloud) |
| CNAME | `www` | `blackouttrades.com` | Proxied |
| CNAME | `clerk` | `accounts.clerk.com` | DNS-only (grey cloud) — Clerk requires this |

> **Important:** Keep the `clerk.blackouttrades.com` subdomain as **DNS-only** (grey cloud). Clerk's JWKS/OAuth flows break through Cloudflare proxy.

---

## 2. SSL/TLS Settings — Full (Strict) Mode

1. In Cloudflare dashboard → **SSL/TLS** → **Overview**.
2. Set encryption mode to **Full (strict)**.
   - *Full* = Cloudflare encrypts between user ↔ CF and CF ↔ Railway, but accepts a self-signed cert on Railway.
   - *Full (strict)* = also validates the Railway origin certificate. Railway's managed Postgres/Next.js services use a valid cert, so this is safe and recommended.
3. Under **SSL/TLS → Edge Certificates**:
   - Enable **Always Use HTTPS** → On
   - Enable **Automatic HTTPS Rewrites** → On
   - **Minimum TLS Version** → TLS 1.2
   - **TLS 1.3** → On
4. Under **SSL/TLS → Origin Server** (optional but recommended):
   - Create an **Origin CA Certificate** from Cloudflare, install it on Railway if you have a custom origin cert path (Railway handles this automatically for managed services — skip if using Railway's default).

---

## 3. Cache Rules

Navigate to **Caching → Cache Rules** → **Create rule** for each entry below (in order — Cloudflare evaluates top-to-bottom, first match wins).

### Rule 1 — Static Assets (1-year cache)

| Field | Value |
|-------|-------|
| **Rule name** | `Static assets — JS/CSS/fonts/images` |
| **When** | URL path matches regex: `\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|avif)$` |
| **Cache status** | Cache Everything |
| **Edge Cache TTL** | 1 year |
| **Browser Cache TTL** | 1 year |
| **Respect origin Cache-Control** | Off (override with TTL above) |

> Next.js content-hashes its static chunks (`/_next/static/…`), so a 1-year TTL is safe — stale files never get served because the URL changes on each deploy.

### Rule 2 — GEX Positioning (60s CDN cache)

| Field | Value |
|-------|-------|
| **Rule name** | `API — GEX positioning` |
| **When** | URL path equals `/api/market/gex-positioning` |
| **Cache status** | Cache Everything |
| **Edge Cache TTL** | 60 seconds |
| **Browser Cache TTL** | Respect origin (app sends `s-maxage=8, stale-while-revalidate=5`) |
| **Cache Key** | Include query string: `ticker` only (strip others) |

> This route requires a valid Clerk session. Only cache if you strip auth from the key — otherwise skip CDN caching for this route and rely on the in-app Redis cache alone.

### Rule 3 — Market News (2-minute cache)

| Field | Value |
|-------|-------|
| **Rule name** | `API — market news` |
| **When** | URL path equals `/api/market/news` |
| **Cache status** | Cache Everything |
| **Edge Cache TTL** | 120 seconds |
| **Browser Cache TTL** | Respect origin |

### Rule 4 — Market Regime (30s cache)

| Field | Value |
|-------|-------|
| **Rule name** | `API — market regime` |
| **When** | URL path equals `/api/market/regime` |
| **Cache status** | Cache Everything |
| **Edge Cache TTL** | 30 seconds |
| **Browser Cache TTL** | Respect origin |

### Rule 5 — Market Anomalies (30s cache)

| Field | Value |
|-------|-------|
| **Rule name** | `API — market anomalies` |
| **When** | URL path equals `/api/market/anomalies` |
| **Cache status** | Cache Everything |
| **Edge Cache TTL** | 30 seconds |
| **Browser Cache TTL** | Respect origin |

### Rule 6 — All Other API Routes (bypass)

| Field | Value |
|-------|-------|
| **Rule name** | `API — bypass all others` |
| **When** | URL path starts with `/api/` |
| **Cache status** | Bypass |

> This must be the **last** rule so specific `/api/market/*` rules above take precedence.

---

## 4. Security — WAF & Firewall Rules

### 4a. Rate Limiting (Cloudflare Pro+)

Under **Security → WAF → Rate limiting rules**:

| Rule | Threshold | Action |
|------|-----------|--------|
| `/api/*` per IP | 100 req / 10s | Managed Challenge |
| `/sign-in`, `/sign-up` | 10 req / 60s | Block |
| `/api/admin/*` | 5 req / 60s | Block |

### 4b. Bot Management (Cloudflare Pro)

Under **Security → Bots**:
- Enable **Bot Fight Mode** (Free) or **Super Bot Fight Mode** (Pro).
- Definitely-automated bots → Block.
- Verified bots (search engines) → Allow.

### 4c. DDoS Protection

Under **Security → DDoS**:
- HTTP DDoS Attack Protection → **High Sensitivity** for `/api/*` paths.

### 4d. IP Access Rules (optional — if you have known bad actors)

Under **Security → WAF → Tools → IP Access Rules**: block individual IPs or ASNs that are hammering you.

### 4e. Security Headers (already in Next.js)

The app already sets:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (full policy in `next.config.mjs`)

These headers pass through Cloudflare unchanged. Do **not** add duplicate security headers in Cloudflare → it would send doubled headers and break CSP.

---

## 5. Trusted Proxy IPs for Next.js (so `req.ip` works behind CF)

Cloudflare forwards the real visitor IP in the `CF-Connecting-IP` header and also in the standard `X-Forwarded-For` header. Next.js `req.ip` reads from `X-Forwarded-For` by default, but only trusts it if the proxy is declared trusted.

### 5a. next.config.mjs — `experimental.trustHostHeader` / `trustProxies`

As of Next.js 15, set `experimental.serverActions.trustProxies` or add to the top-level config:

```js
// next.config.mjs  (already updated in this repo — see the file)
const nextConfig = {
  // ... existing config ...

  // Trust Cloudflare + Railway reverse proxy so req.ip resolves to the real
  // visitor IP from CF-Connecting-IP / X-Forwarded-For, not the proxy IP.
  // Next.js 15 reads this and marks these CIDR blocks as trusted.
  // Cloudflare IPv4 ranges: https://www.cloudflare.com/ips-v4/
  // Cloudflare IPv6 ranges: https://www.cloudflare.com/ips-v6/
  experimental: {
    // ... existing experimental flags ...
    trustProxies: [
      // Cloudflare IPv4
      "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
      "104.16.0.0/13", "104.24.0.0/14", "108.162.192.0/18",
      "131.0.72.0/22", "141.101.64.0/18", "162.158.0.0/15",
      "172.64.0.0/13", "173.245.48.0/20", "188.114.96.0/20",
      "190.93.240.0/20", "197.234.240.0/22", "198.41.128.0/17",
      // Cloudflare IPv6
      "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32",
      "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
      // Railway internal proxy
      "100.64.0.0/10",
    ],
  },
};
```

### 5b. Use `CF-Connecting-IP` in middleware for extra safety

In `src/middleware.ts` you can also read `req.headers.get('cf-connecting-ip')` as the canonical visitor IP when behind Cloudflare, bypassing any X-Forwarded-For spoofing entirely:

```ts
// In any API route or middleware:
const visitorIp =
  req.headers.get('cf-connecting-ip') ??
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
  req.ip;
```

---

## 6. Cloudflare Analytics & Speed

- **Speed → Optimization**: Enable **Auto Minify** (JS/CSS/HTML) — note this can interfere with source maps; disable if needed.
- **Speed → Optimization → Rocket Loader**: **Off** — it breaks Next.js hydration.
- **Speed → Image Resizing**: optional (Next.js `<Image>` already optimizes).
- **Analytics → Web Analytics**: optional Cloudflare beacon (complements your existing analytics).

---

## 7. Cache Purge on Deploy

After each Railway deploy, purge the Cloudflare cache so old static chunks don't get served. Add this to your CI or Railway deploy hook:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Add `CF_ZONE_ID` and `CF_API_TOKEN` (with Cache Purge permission) to Railway env.
