# Cloudflare Configuration — blackouttrades.com

> Configured 2026-06-27 via API through browser session. Reference this before touching CF settings.

## Account
- **Zone:** blackouttrades.com
- **Plan:** Free (upgrade to Pro for rate limiting + Bot Fight Mode)
- **Account email:** Coreentryadmin@gmail.com

---

## DNS Records (do not change proxy status)

| Name | Type | Content | Proxied | Notes |
|---|---|---|---|---|
| blackouttrades.com | CNAME | jzwkg5uc.up.railway.app | ✅ YES | Main app → Railway blackout-web |
| www.blackouttrades.com | CNAME | 8dkf6fp5.up.railway.app | ✅ YES | www → Railway (redirects to apex) |
| clk._domainkey | CNAME | dkim1.tzneys6rxyan.clerk.services | ❌ NO | Clerk DKIM — must stay DNS-only |
| clk2._domainkey | CNAME | dkim2.tzneys6rxyan.clerk.services | ❌ NO | Clerk DKIM — must stay DNS-only |
| mail (Clerk) | CNAME | mail.tzneys6rxyan.clerk.services | ❌ NO | Clerk mail — must stay DNS-only |
| blackouttrades.com | MX | (Zoho) | ❌ NO | Email — must stay DNS-only |
| blackouttrades.com | TXT | zoho-verification=... | ❌ NO | Zoho domain verify |
| _railway-verify | TXT | railway-verify=... | ❌ NO | Railway verify |

**CRITICAL:** Clerk DNS records MUST remain DNS-only (grey cloud). Proxying them breaks auth.

---

## Security Settings

| Setting | Value | Notes |
|---|---|---|
| SSL mode | `full` | Full encryption origin↔CF↔user |
| Always HTTPS | `on` | HTTP → HTTPS redirect |
| HSTS | enabled, max_age=31536000, includeSubdomains, preload | 1 year, full HSTS preload |
| TLS minimum | `1.2` | Blocks TLS 1.0/1.1 |
| TLS 1.3 | `zrt` (on + 0-RTT) | Fastest handshake |
| 0-RTT resumption | `on` | Reduces repeat-visit latency |
| DNSSEC | `active` (propagating ~24h from setup) | DNS tampering protection |
| Browser integrity check | `on` | Blocks known bad bots |
| Security level | `medium` | Challenges suspicious IPs |
| Hotlink protection | `on` | Prevents asset embedding by other sites |
| Email obfuscation | `on` | Hides emails from scrapers |
| Server-side excludes | `on` | |
| Post-quantum key exchange | `on` | Future-proof encryption |

---

## Security Response Headers (applied to ALL responses via Transform Rules)

| Header | Value |
|---|---|
| X-Content-Type-Options | nosniff |
| X-Frame-Options | SAMEORIGIN |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |

---

## Performance Settings

| Setting | Value | Notes |
|---|---|---|
| Brotli compression | `on` | Better than gzip, supported by all modern browsers |
| HTTP/2 | `on` | Multiplexed requests |
| HTTP/3 (QUIC) | `on` | Fastest protocol, especially on mobile |
| Early Hints (103) | `on` | Browser starts loading assets before full response |
| Browser cache TTL | `31536000` (1 year) | Static assets cached in browser for 1 year |
| Always Online | `on` | Serves cached version if Railway is down |
| Challenge TTL | `3600` (1 hour) | How long a challenged IP stays trusted |
| ECH (Encrypted Client Hello) | `on` | Hides SNI from network observers |
| Opportunistic encryption | `on` | |
| Opportunistic onion | `on` | Tor users get .onion routing |
| Automatic HTTPS rewrites | `on` | Fixes mixed-content http:// links in HTML |

---

## Cache Rules (applied in order — first match wins)

| Priority | Match | Action | Edge TTL |
|---|---|---|---|
| 1 | `/_next/static/*` | Cache | 1 year (31536000s) |
| 2 | `/api/market/gex-positioning` | Cache | 60s |
| 3 | `/api/market/news` | Cache | 120s |
| 4 | `/api/market/regime` | Cache | 30s |
| 5 | `/api/*` (everything else) | Bypass | — |

**Why these routes:** GEX, news, regime are public market data — identical for all users.
All auth-gated or user-specific routes bypass cache entirely.

---

## Redirect Rules

| Rule | Action |
|---|---|
| `www.blackouttrades.com/*` → `blackouttrades.com/*` | 301 permanent redirect |

Canonical URL is the apex domain (no www).

---

## Active Rulesets (Cloudflare-managed)

| Ruleset | Phase | Notes |
|---|---|---|
| Cloudflare Normalization Ruleset | http_request_sanitize | Normalizes requests to prevent bypass tricks |
| Cloudflare Managed Free Ruleset | http_request_firewall_managed | Free WAF — blocks OWASP top 10 patterns |
| DDoS L7 ruleset | ddos_l7 | Automatic DDoS mitigation |
| Cache rules (ours) | http_request_cache_settings | Configured above |
| Redirect rules (ours) | http_request_dynamic_redirect | www → apex |
| Security headers (ours) | http_response_headers_transform | Security headers on all responses |

---

## App Compatibility (DO NOT CHANGE)

| Setting | Value | Reason |
|---|---|---|
| WebSockets | `on` | Required for SSE streams + WS connections |
| Rocket Loader | `off` | **Must stay off** — breaks Next.js RSC/async JS |
| Response buffering | `off` | **Must stay off** — breaks SSE streaming |
| Railway CDN | `off` | **Must stay off** — conflicts with Cloudflare (double CDN) |

---

## Requires Pro Plan ($20/mo) — Not Yet Configured

| Feature | Why It Matters |
|---|---|
| Rate limiting on `/sign-in` (10 req/min) | Brute force protection on auth |
| Rate limiting on `/api/*` (300 req/min) | API abuse prevention |
| Bot Fight Mode | Blocks credential stuffing bots |
| Image optimization (Polish + WebP) | Automatic image compression at edge |

To upgrade: dash.cloudflare.com → blackouttrades.com → Overview → Upgrade Plan.
After upgrading, add rate limit rules via: Security → WAF → Rate Limiting Rules.

---

## DNSSEC DS Records (add at domain registrar after propagation)

After DNSSEC finishes propagating (~24h), go to:
1. dash.cloudflare.com → blackouttrades.com → DNS → DNSSEC
2. Copy the DS record shown
3. Add it at your domain registrar's DNS settings

---

## Maintenance Notes

- **On every Railway deploy:** Cloudflare automatically purges HTML cache (set in Railway CDN settings — actually purge via CF API if needed)
- **If you change an API route from public → auth-gated:** Add it to the cache bypass rule immediately
- **Never proxy Clerk DNS records** — breaks sign-in
- **Never enable Railway CDN** while Cloudflare proxy is active
- **If you upgrade to Vercel:** Update the Railway CNAME records to point to Vercel deployment URL instead
