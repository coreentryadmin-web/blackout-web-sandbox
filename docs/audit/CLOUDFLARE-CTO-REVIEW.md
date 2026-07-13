# Cloudflare Performance + Configuration Review — BlackOut Trades

**Date:** 2026-07-13
**Scope:** `blackouttrades.com` (single zone, **Free Website** plan, active, proxied) + `staging.blackouttrades.com` (subdomain of the same zone). Origin: Next.js 15 App Router (`output: "standalone"`) on AWS ECS behind Cloudflare.
**Method:** read-only Cloudflare API reads (token is permission-limited — see §9) + non-destructive live HTTP probing of prod and staging (a handful of requests per URL; no load testing, no purges, no config changes).

> **READ-ONLY REVIEW.** Nothing on Cloudflare was changed. Every proposal below is a **recommendation only** — the single zone IS production, so any cache-rule edit or purge is the user's call.

---

## 1. Executive summary — top 5 by impact

| # | Recommendation | Impact | Effort | Free? | Risk |
|---|---|---|---|---|---|
| 1 | **The 3 API edge-cache rules (regime / gex / news) are no-ops** — responses return `cf-cache-status: DYNAMIC` on every hit. Root cause: the JSON routes carry `Vary: rsc, next-router-*` **without** `Accept-Encoding`, which Cloudflare treats as uncacheable. Fix = strip the RSC `Vary` on these data routes so the rules actually cache. | **H** | S–M | yes | low |
| 2 | **`/_next/image` (Next image optimizer) is not edge-cached on prod** — query-string URL + no cache rule ⇒ every optimized image re-runs on ECS. Add a cache rule for `/_next/image` (1yr edge). | **H** | S | yes | low |
| 3 | **Cache rules are not hostname-scoped**, so the marketing `"/"` rule (edge_ttl 7200, `override_origin`) **caches staging's homepage even though the app explicitly sends `CDN-Cache-Control: no-store`** on staging. Confirmed live: staging `/` returns `cf-cache-status: HIT`. Scope the marketing rule to `http.host eq "blackouttrades.com"`. | **M/H** | S | yes | low |
| 4 | **Broaden static caching**: `/manifest.webmanifest` (`DYNAMIC`), `/robots.txt` (uncached), `/icon.png` `/apple-icon.png` (MISS, no rule), `/images/*`, `/favicon.ico`. Add one rule covering public static file types → higher hit ratio, less ECS load. | **M** | S | yes | low |
| 5 | **Static JS/CSS is served as `gzip`, not `brotli`** (origin pre-gzips; CF caches and serves that). Brotli is ~15–20% smaller for text assets. Have the origin stop pre-compressing `_next/static` (or serve `br`) so Cloudflare's edge Brotli applies. | **M** | M | yes | low |

**Confirmed already-good (don't touch):** the recently-fixed **`_next/static` 404 cache bug is verified resolved on prod** (missing chunk → `404` + `cf-cache-status: BYPASS` + `no-store`); HTTP/3, TLS 1.3, Brotli-on-HTML, HSTS+preload, CSP, and a clean single-hop www→apex redirect are all live and correct.

---

## 2. What's already good (verified live)

- **HTTP/3 (QUIC) is ON** — every response advertises `alt-svc: h3=":443"; ma=86400`.
- **TLS 1.3** negotiated, certificate verifies cleanly (`ssl_verify_result=0`), HTTP/2 for the main transport.
- **Brotli on HTML** — homepage/`/learn`/`/upgrade` and JSON return `content-encoding: br`.
- **HSTS with preload** — `strict-transport-security: max-age=31536000; includeSubDomains; preload` on every route (preload-eligible: ≥1yr + includeSubDomains + preload).
- **Solid security-header posture** (served on every response): `content-security-policy` (with `frame-ancestors 'self'`), `x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: camera=(), microphone=(), geolocation=()`.
- **Marketing HTML caches at edge** — homepage `cf-cache-status: HIT`, `age` ~1700s, served from the `"/"` cache rule.
- **`_next/static` JS/CSS caches at edge** — `HIT`, `cache-control: public, max-age=31536000, immutable`.
- **The `_next/static` 404 cache bug is fixed on prod** (see §7 for the header capture).
- **Redirects are clean** — `www→apex` and `http→https` are each a single `301`, no chains.
- **`poweredByHeader: false`** — no `x-powered-by` leak.

---

## 3. Cache-rule audit (the one ruleset the token CAN read)

Ruleset `95d2e74be110459ea6d8f0da6729dba4`, phase `http_request_cache_settings`, last updated 2026-07-13T03:01:26Z. Six rules, all enabled, evaluated top-down:

| # | Expression | cache | edge TTL | browser TTL | Notes |
|---|---|---|---|---|---|
| 1 | `http.request.uri.path contains "/_next/static/"` | on | 1yr (`override_origin`) + **4xx/5xx → -1 (no-store)** | 1yr | **Correct.** The `status_code_ttl` `-1` on 400–599 is the 404-chunk fix. Verified live. |
| 2 | `path eq "/api/market/gex-positioning"` | on | 60s (`override_origin`) | bypass | **Ineffective in practice** (see §3.1). |
| 3 | `path eq "/api/market/news"` | on | 120s (`override_origin`) | bypass | **Ineffective in practice** (see §3.1). |
| 4 | `path eq "/api/market/regime"` | on | 30s (`override_origin`) | bypass | **Proven not caching — `DYNAMIC` live** (see §3.1). |
| 5 | `path wildcard "/api/*"` | **off** | — | — | Correct: bypass all other (per-user/authenticated) APIs. Good default. |
| 6 | `path eq "/"` OR `path eq "/upgrade"` OR `starts_with(path,"/learn")` | on | 7200s (`override_origin`) | `respect_origin` | Works on prod, but **not host-scoped** → also caches staging (see §3.2). Also note `/upgrade` origin sends `private, no-store` — the rule force-caches it anyway. |

### 3.1 The API cache rules are no-ops — root cause

Rules 2–4 look right on paper but do not cache. Direct evidence on the one that returns 200 anonymously:

```
GET https://blackouttrades.com/api/market/regime   (3 consecutive hits)
  cache-control: public, s-maxage=30, stale-while-revalidate=10
  vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
  cf-cache-status: DYNAMIC   ← every time (never HIT/MISS/EXPIRED)
```

`DYNAMIC` means Cloudflare treated the response as uncacheable and the cache rule's TTL never engaged. The distinguishing feature versus the **cacheable** homepage is the `Vary` header:

- Homepage (`HIT`): `vary: rsc, next-router-…, **Accept-Encoding**`
- `regime` (`DYNAMIC`): `vary: rsc, next-router-…` (**no `Accept-Encoding`**)

Cloudflare only caches responses whose `Vary` is absent or effectively `Accept-Encoding`; a `Vary` listing other tokens (here Next's RSC/router hints) with no `Accept-Encoding` is treated as uncacheable. Next.js App Router stamps that RSC `Vary` on every response, including data routes where it is meaningless (these JSON endpoints do not vary by RSC negotiation). `gex-positioning` and `news` return `401` to an anonymous probe, so I could not observe their cache status directly, **but they share the identical route-handler `Vary` behavior**, so the same root cause almost certainly makes rules 2 and 3 no-ops as well. (Definitive confirmation of gex/news would need an authenticated probe or CF cache analytics — the latter is `403` for this token.)

**Recommended fix (origin-side, preferred):** on the three cacheable data routes, delete the RSC `Vary` before returning (e.g. `res.headers.delete("Vary")` or set `Vary: Accept-Encoding`). Then the existing edge rules start producing `HIT`s.
**Alternative (Cloudflare-side):** a **Response Headers Transform** rule removing `Vary` for `path in {…}` — but that ruleset is `403` for this token, and stripping `Vary` zone-wide is riskier than a targeted origin change.
**Reality check:** these are market-data endpoints hit by authenticated members carrying session cookies. Even after the `Vary` fix, confirm the responses carry no `Set-Cookie` (they don't today) and that the data is genuinely shared across users (not per-account) before relying on edge caching — the rule already sets `browser_ttl: bypass`, which correctly keeps it edge-only.

### 3.2 Cache rules apply to staging too (not host-scoped)

None of the six expressions constrain `http.host`. Staging is the same zone, so rule 6 matches `staging.blackouttrades.com/`. Live proof:

```
GET https://staging.blackouttrades.com/
  cdn-cache-control: no-store                       ← app explicitly opts staging out
  cache-control: private, no-cache, no-store, …
  cf-cache-status: HIT                              ← rule 6 override_origin cached it anyway
```

The app's `next.config.mjs` deliberately sends `CDN-Cache-Control: no-store` on staging HTML (`stagingEdgeBypass`), but the cache rule's `edge_ttl: override_origin` ignores origin cache directives and caches it regardless. Result: staging serves a possibly-stale edge copy, defeating staging's purpose. **Fix:** add `and http.host eq "blackouttrades.com"` to rule 6 (and, once they cache, the API rules). Do the same for any rule that should be prod-only.

### 3.3 Proposed additional / edited rules (recommendations only)

Ordered; exact expressions given. All Free-plan compatible.

1. **Next image optimizer** — highest-value addition.
   `(http.request.uri.path eq "/_next/image")` → cache **on**, edge TTL **1yr** `override_origin`, browser TTL respect_origin.
   *Why:* `/_next/image?url=…&w=…&q=…` has a query string and no file extension, so Cloudflare's default caching skips it → every resize runs on ECS. (On staging the app already sets `CDN-Cache-Control` for this path; prod does not.)

2. **Public static files** — one rule to lift manifest/robots/icons/images/fonts.
   `(http.request.uri.path in {"/manifest.webmanifest" "/robots.txt" "/favicon.ico" "/sitemap.xml" "/icon.png" "/apple-icon.png" "/sw.js"}) or (starts_with(http.request.uri.path,"/images/")) or (http.request.uri.path.extension in {"png" "jpg" "jpeg" "webp" "svg" "ico" "woff" "woff2" "txt" "xml" "webmanifest"})`
   → cache **on**, edge TTL **1yr** `override_origin` for hashed/static, or a safer **1h–24h** if you prefer revalidation for `robots`/`manifest`/`sw.js`.
   **Caveat:** `sw.js` (service worker) should **not** be long-cached at the browser — keep its `browser_ttl` short (or `respect_origin`); a stale SW is painful to dislodge. Edge-cache it, but don't override browser TTL to 1yr.

3. **Host-scope existing rules** — append `and http.host eq "blackouttrades.com"` to rules 2–4 and 6 (see §3.2).

**Never cache (leave bypassed / do NOT add rules for):** authenticated app HTML, per-user API routes (rule 5's `/api/*` bypass is correct), SSE/streaming endpoints, anything with `Set-Cookie`, Clerk auth routes. The current "bypass all other `/api/*`" default is the right safety net — keep it last.

---

## 4. Live edge-performance table (prod, 2026-07-13)

TTFB = `curl -w %{time_starttransfer}`, 3 samples, from this sandbox (proxied egress — treat TTFB as *relative*, not absolute user latency). `enc` = negotiated `content-encoding` when `br,gzip` offered. All responses: HTTP/2 + `alt-svc h3` + TLS 1.3.

| URL | Status | cf-cache-status | enc | content-type | cache-control | age | TTFB (s) |
|---|---|---|---|---|---|---|---|
| `/` (home HTML) | 200 | **HIT** | br | text/html | s-maxage=31536000 | ~1757 | 0.21 |
| `/learn` | 200 | MISS | br | text/html | s-maxage=31536000 | — | 0.19 |
| `/upgrade` | 200 | MISS | br | text/html | private, no-store | — | 0.21 |
| `/_next/static/chunks/*.js` | 200 | **HIT** | **gzip** | application/javascript | public, max-age=31536000, immutable | ~1559 | 0.20 |
| `/_next/static/css/*.css` | 200 | **HIT** | **gzip** | text/css | …immutable | ~945 | 0.18 |
| `/_next/static/media/*.woff2` | 200 | MISS | none | font/woff2 | …immutable | — | 0.21 |
| `/icon-192.png` | 200 | REVALIDATED | none | image/png | public, max-age=31536000 | — | 0.20 |
| `/images/marketing/hawk.webp` | 200 | MISS | none | image/webp | public, max-age=31536000 | — | 0.21 (140 KB) |
| `/manifest.webmanifest` | 200 | **DYNAMIC** | br | application/manifest+json | public, **max-age=0** | — | 0.21 |
| `/favicon.ico` | **404** | BYPASS | br | text/html | no-store | — | 0.23 |
| `/robots.txt` | 200 | *(blank)* | br | text/plain | *(none)* | — | 0.21 |
| `/sitemap.xml` | **404** | DYNAMIC | br | text/html | no-store | — | 0.20 |
| `/icon.png` | 200 | MISS | none | image/png | …immutable, no-transform | — | 0.17 |
| `/apple-icon.png` | 200 | MISS | none | image/png | …immutable | — | 0.17 |
| `/sw.js` | 200 | MISS | gzip | application/javascript | public, max-age=31536000 | — | 0.18 |
| `/_next/image?url=…` | 400* | DYNAMIC | — | — | public, …immutable | — | — |
| `/api/market/regime` | 200 | **DYNAMIC** | br | application/json | public, s-maxage=30, swr=10 | — | 0.21 |
| `/api/market/gex-positioning` | 401 | DYNAMIC | none | application/json | *(none)* | — | 0.20 |
| `/api/market/news` | 401 | DYNAMIC | none | application/json | *(none)* | — | 0.18 |
| `/_next/static/…DOES-NOT-EXIST.js` | **404** | **BYPASS** | br | text/plain | private, no-store | — | 0.23 |
| staging `/` | 200 | **HIT** | br | text/html | private, no-store (`cdn: no-store`) | — | — |

\* The `/_next/image` `400` is my probe's param validation, not an outage; the caching point (query-string path is not edge-cached on prod) stands.

**Callouts from the table:**
- **HTML + `_next/static` cache well;** everything else static is MISS/DYNAMIC/uncached (see §3.3).
- **Static JS/CSS is gzip, not brotli** — because the origin pre-gzips and CF serves the cached encoded object. HTML is `br` because CF compresses it at the edge. See §5 item "Brotli."
- **`/manifest.webmanifest` `max-age=0` + DYNAMIC** — refetched every load.
- **`/favicon.ico` 404** — the app ships `/icon.png` metadata icons but no `/favicon.ico`; browsers auto-request it → guaranteed 404 per visit (noise, §7).
- **`/sitemap.xml` 404** — no sitemap for the marketing/SEO surface.
- **Fonts + images `enc: none`** is correct (woff2/webp/png are already compressed; do not re-compress).

---

## 5. Ranked speed enhancements (with enable steps)

Each tagged **[impact][effort][Free?]** and **risk**.

1. **Fix the API `Vary` so the edge rules cache** — **[H][S–M][Free]** low risk. §3.1. Origin: strip RSC `Vary` on regime/gex/news. This is the single biggest *configured-but-not-working* item.
2. **Add `/_next/image` cache rule** — **[H][S][Free]** low risk. §3.3.1. Dashboard: *Caching → Cache Rules → Create* with the expression above, Eligible for cache = on, Edge TTL = 1yr. Cuts ECS image-optimization CPU dramatically if `next/image` is used on marketing/app.
3. **Host-scope the cache rules** — **[M/H][S][Free]** low risk. §3.2. Stops staging being edge-cached against its own `no-store`.
4. **Broaden static caching (manifest/robots/icons/images/fonts)** — **[M][S][Free]** low risk. §3.3.2.
5. **Serve Brotli for `_next/static`** — **[M][M][Free]** low risk. The origin currently emits `Content-Encoding: gzip` for JS/CSS, so Cloudflare caches and serves gzip (its edge Brotli only applies to content CF itself compresses). Options: (a) stop pre-compressing `_next/static` at the origin and let Cloudflare Brotli the edge copy; or (b) have the origin emit `br`. ~15–20% smaller text transfer. *Cloudflare Brotli toggle:* Dashboard → *Speed → Optimization → Content Optimization → Brotli* (verify it's ON — I cannot read it via this token).
6. **HTTP/3 / TLS 1.3 / 0-RTT** — **[—][—][Free]** — h3 + TLS 1.3 already live. If you want **0-RTT** (faster resumed TLS): Dashboard → *SSL/TLS → Edge Certificates → 0-RTT Connection Resumption*. Low risk for idempotent GETs; keep it off for state-changing requests (CF scopes 0-RTT to GET/HEAD, so generally safe).
7. **Tiered Cache (Smart Tiered Cache) — free** — **[M][S][Free]** low risk. Dashboard → *Caching → Tiered Cache → Smart Tiered Cache Topology*. Improves hit ratio and reduces origin (ECS) fetches by designating upper-tier data centers. Genuinely useful once §3.3 lands. **Status not readable via this token (`403`).**
8. **Early Hints (`103`)** — **[M][M][Free]** ⚠️ *medium risk with Next.js.* Can conflict with Next's own preloading/streaming and RSC. If tried, A/B it and watch for double-loading. Dashboard → *Speed → Optimization → Early Hints*. Recommend **defer** until §1–4 are done.
9. **Argo Smart Routing** — **[M][S to enable][PAID ~$5/mo + usage]** low risk. Latency routing to origin; helps a single-region ECS origin serving global users. Assess after free wins.
10. **Rocket Loader — leave OFF** — ⚠️ **[negative][—][Free]**. Rocket Loader defers/async-rewrites JS and **routinely breaks React/Next hydration** (`unsafe-eval`/ordering). **Recommendation: keep disabled.** Verify it's off (Dashboard → *Speed → Optimization → Rocket Loader*).
11. **Auto Minify — N/A** — Cloudflare **removed** Auto Minify (Aug 2024). Next already minifies at build. No action.
12. **Polish / Mirage / Image Resizing** — **[M][S][PAID]**. Polish (WebP/AVIF re-encode + metadata strip) needs Pro+; Image Resizing is paid. The app already ships `.webp` and uses Next's optimizer, so marginal benefit; skip on Free.

---

## 6. Cache Reserve assessment (user recently "enabled" it)

**I cannot verify Cache Reserve status with this token** — `GET /zones/{id}/cache/cache_reserve` returns **`403` (request is not authorized)**. So I can neither confirm it is active nor read its stored-bytes/ops. State that honestly.

**What I can say on the merits:**
- **Cache Reserve is an R2-backed paid add-on** (storage + Class A/B operations, billed via R2), and the dashboard toggle **requires an active R2 subscription**. This zone is **Free Website plan** (`plan.legacy_id: "free"`, `price: 0`, `is_subscribed: false`, confirmed via the zone read). It is very unlikely Cache Reserve is actually *serving* here without an R2 subscription; a "toggle" without R2 provisioned typically does nothing.
- **Even if active, it barely helps this workload.** Cache Reserve's value is retaining **large, rarely-changing** assets (video, big media, installer blobs) that would otherwise be evicted from edge tiers between infrequent requests. BlackOut's cacheable surface is small hashed JS/CSS (already `immutable`, tiny), marketing HTML, a few sub-150 KB images, and short-TTL JSON. None of that benefits meaningfully from a persistent reserve — the edge cache already holds it, and the JSON is 30–120s TTL (Cache Reserve won't retain sub-10s/short-TTL churn usefully).
- **Recommendation:** confirm whether it's genuinely provisioned (needs `Zone:Read`/dashboard access). If it is billing against R2, **turn it off** — for this asset profile it adds cost and R2 operations without a hit-ratio win. Put the effort into **§3.1 (fix the dead API rules)** and **§5.7 (free Tiered Cache)** instead — those actually raise hit ratio here.

---

## 7. Noise reduction

- **`_next/static` 404 caching — RESOLVED (verified).** A missing chunk now returns:
  ```
  GET /_next/static/chunks/DOES-NOT-EXIST-9999.js
    HTTP/2 404
    cache-control: private, no-cache, no-store, max-age=0, must-revalidate
    cf-cache-status: BYPASS
  ```
  Rule 1's `status_code_ttl: -1` on 400–599 is doing its job — post-deploy `ChunkLoadError`-from-cached-404 is fixed on prod. ✔
- **`/favicon.ico` 404 on every visit** — browsers request it unconditionally. Add a real `/favicon.ico` (or a redirect/`icon` alias) so it stops generating a 404 + origin hit + console noise per session. **[L][S]**
- **`/sitemap.xml` 404** — add `app/sitemap.ts` for the marketing routes (SEO + stops the 404). **[L][S]**
- **`/manifest.webmanifest` refetched every load** (`max-age=0`, `DYNAMIC`) — give it a short cache (§3.3.2). **[L][S]**
- **Static JS/CSS gzip instead of brotli** — wasted bytes on every cold client (§5.5). **[M][M]**
- **Staging edge-cached against its own `no-store`** — wasted/incorrect caching + risk of serving stale staging (§3.2). **[M][S]**
- **Redirect chains:** none found — `www→apex` and `http→https` are single 301s. ✔ (No action.)

---

## 8. Config sanity inferred from headers (dashboard is `403`)

| Check | Observed | Verdict |
|---|---|---|
| Proxied through Cloudflare | `server: cloudflare`, `cf-ray`, `cf-cache-status` present | ✔ proxied |
| HTTPS / cert | TLS 1.3, `ssl_verify_result=0` | ✔ valid |
| HTTP/3 | `alt-svc: h3=":443"` | ✔ on |
| HSTS + preload | `max-age=31536000; includeSubDomains; preload` | ✔ preload-eligible |
| CSP | present, `frame-ancestors 'self'`, scoped script/style/connect | ✔ reasonable |
| `x-content-type-options` | `nosniff` | ✔ |
| Framing | `x-frame-options: SAMEORIGIN` + CSP `frame-ancestors` | ✔ |
| `referrer-policy` / `permissions-policy` | present, tight | ✔ |

**Cannot verify via this token (flagged honestly):**
- **SSL/TLS mode (Flexible vs Full vs Full-Strict).** Not readable (`/settings/ssl` → `403`). **This matters:** *Flexible* mode is a security hole (CF↔origin leg is plaintext, and it breaks with an HTTPS origin). The ECS origin serves HTTPS, so this **should** be **Full (Strict)** — **verify in the dashboard** (SSL/TLS → Overview). This is the top unverified security item.
- **HSTS max-age discrepancy:** origin `next.config.mjs` sets `max-age=63072000` (2yr) but the **edge serves `31536000` (1yr)** — something (a Cloudflare HSTS setting or the `http_response_headers_transform` ruleset, both `403` to this token) is rewriting it. Harmless for preload (still ≥1yr), but reconcile so intent matches reality.
- Whether **Brotli**, **Tiered Cache**, **0-RTT**, **Early Hints**, **Rocket Loader**, **Cache Reserve** are on — all `403`.

---

## 9. Honest limitations + exact permissions needed for a full audit

**Token reality (verified, not assumed).** The token (`c949ee5633f3528b25fd68a1acb6086e`, valid through 2027-06-30) is **narrower than a full-audit token**. Probing each API:

| API | Result |
|---|---|
| `/user/tokens/verify` | 200 (active) |
| `/zones/{id}` (zone read) | **200** — gave plan (Free), status, `type: full`, nameservers, and `permissions: [#waf:read, #waf:edit, #cache_purge:edit, #zone:read]` |
| `/zones/{id}/rulesets` (list) | 200 — all 7 phase rulesets **listed** |
| `/zones/{id}/rulesets/{cache_id}` | **200** — full cache-settings ruleset **readable** (this is the Cache Rules grant) |
| `/zones/{id}/rulesets/{redirect_id}` and `{security_headers_id}` | **403** — rule **contents** of non-cache phases not readable |
| `/zones/{id}/settings` and every `/settings/{ssl,http3,brotli,early_hints,0rtt,min_tls_version,…}` | **403** |
| `/zones/{id}/dns_records` | **403** |
| `/zones/{id}/pagerules` | **403** |
| `/zones/{id}/firewall/rules`, firewall_custom entrypoint | **403** |
| `/zones/{id}/cache/cache_reserve` | **403** |
| `/zones/{id}/argo/tiered_caching` | **403** |

So effectively: **can read** = zone metadata + ruleset list + the **cache-settings ruleset only**; **can edit** = cache rules + purge (not exercised — read-only review). Everything else is `403`. (Note: the zone object advertises `#waf:edit`, but live WAF/firewall endpoints returned `403` — I did not and will not test writes.)

**To complete a full config audit, add these READ scopes to the token** (Zone-level, this zone):
- **`Zone → Zone:Read`** (have it) — general zone/plan.
- **`Zone → Zone Settings:Read`** — SSL/TLS mode, Brotli, HTTP/3, 0-RTT, Early Hints, Rocket Loader, min TLS, Auto HTTPS Rewrites, HSTS setting.
- **`Zone → DNS:Read`** — proxied/grey-cloud records, CNAME flattening, dangling records.
- **`Zone → SSL and Certificates:Read`** — cert type, TLS mode, validation.
- **`Zone → Page Rules:Read`** — legacy page rules (quota shows 3 available).
- **`Zone → Firewall Services:Read`** (WAF/Firewall read) — managed + custom rules, rate limits, bot settings.
- *(For Cache Reserve/Tiered Cache/Argo status specifically: `Zone → Cache Rules:Read` covers rules, but reserve/tiered/argo read comes with `Zone Settings:Read` / the Cache Reserve API scope.)*

**Other limitations:**
- **Staging API cache status (gex/news) unconfirmed** — they return `401` anonymously; verifying their `cf-cache-status` needs an authenticated session. `regime` (public 200) is the proxy that proves the `Vary` root cause.
- **TTFB numbers are relative** — measured through this sandbox's proxied egress, not a real user path. Use them for A/B (cached vs uncached), not as absolute latency SLOs.
- **No purge / no writes performed** — single production zone; all findings are recommendations.

---

*Prepared read-only. No Cloudflare configuration was created, edited, or purged. All numbers above are live captures from 2026-07-13; nothing is fabricated — items I could not verify are labelled as such with the exact access that would resolve them.*
