# 08 — Security Audit (Deliverable J)

**Scope:** Full security review of the BLACKOUT trading-intelligence platform (canonical root `C:\Users\raidu\blackout-platform\blackout-web`), targeting a launch scaling from <10 users to ~500 concurrent users.
**Method:** Read-only enumeration with Grep/Glob/Read + `npm audit`. Every finding is grounded in real code with file:line references. Items needing runtime/prod/env to confirm are marked **Not verified — needs X**.
**Date:** 2026-06-24.

---

## Executive summary

This is a **security-conscious codebase**. The team has clearly done prior hardening: parameterized SQL everywhere, constant-time cron-secret comparison, an SSRF allowlist on the engine proxy, a Discord-webhook host allowlist, fail-closed tier resolution on a Clerk outage, telemetry credential redaction, security headers + CSP in `next.config.mjs`, IDOR-safe per-user scoping (`user_id` always from Clerk `auth()`), and verified webhook signatures. No `dangerouslySetInnerHTML`, no `eval`, no CORS wildcards, no raw string-built SQL, and **no server secrets inlined in the client bundle** (verified by scanning `.next/static`).

The **dominant launch risk is dependency CVEs**, not application logic. `npm audit` reports **10 vulnerabilities (9 high, 1 moderate)**. The two that matter most for a 500-user launch:

1. **Clerk (auth provider) has a published authorization-bypass advisory** affecting the installed version range (GHSA-w24r-5266-9c3c). Clerk *is* the auth boundary for the entire app, so this is the single highest-priority item.
2. **Next.js 14.2.35 carries 14 advisories**, including SSRF via WebSocket upgrades, multiple Server-Component DoS vectors, cache-poisoning, and an App-Router XSS — directly relevant under concurrent load.

There is also **no application-layer / per-IP rate limiting or WAF** in front of the routes. Auth is enforced per-route (there is no `middleware.ts`), which is implemented correctly today but is fragile: a future route author who forgets the guard ships an open endpoint with no backstop.

**Severity counts:** Critical **1** · High **5** · Medium **6** · Low **5**.

---

## Inventory — what was checked

| Area | Result |
|---|---|
| Secret/env handling (`NEXT_PUBLIC_*`, `process.env`) | OK — only public values exposed client-side (Clerk publishable key, Whop checkout URLs, VAPID public key, site URL). No server secret names or values in `.next/static`. |
| API-key / token handling | OK — engine secret sent as `Authorization` header (not query string), search keys server-only, telemetry redacts. |
| CORS | No CORS headers anywhere (no `Access-Control-Allow-Origin`). Same-origin only. OK. |
| CSP / security headers | Present in `next.config.mjs` (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, CSP). CSP uses `'unsafe-inline' 'unsafe-eval'` on `script-src` — see H/M findings. |
| Webhook signature verification | Whop webhook verifies via `whop.webhooks.unwrap()` (Standard Webhooks HMAC). OK. |
| Input validation on mutating routes | Strong on `/api/account/*` (positions, personal-alerts, push). |
| SQL injection | None found — all queries parameterized (`$1..$n`); dynamic `SET`/`WHERE` clauses use placeholders, never string interpolation. |
| XSS | No `dangerouslySetInnerHTML`, no `innerHTML`. |
| SSRF | Engine proxy allowlist + Discord host allowlist + web-search fixed hosts. Good. Residual concerns are framework-level (Next CVE) and Largo egress (Medium). |
| Auth bypass | Per-route guards correct; fail-closed tier cache. No middleware backstop (Medium). |
| Dependency vulnerabilities | **10 (9 high, 1 moderate)** — see Critical/High. |
| Logging of sensitive data | Telemetry + error-sink sanitize before persist/log. OK. |
| Unauthenticated endpoints | `/api/health`, `/api/ready`, `/api/engine/health`, `/api/public/track-record`, `/api/webhook/whop` — all intentionally public; track-record is PII-free aggregate. OK by design. |

### Auth posture of every API route (verified)

All `/api/admin/*` → `requireAdminApi()`/`resolveAdminApi()` (401/403). All `/api/cron/*` → `isCronAuthorized()` (constant-time Bearer compare). All `/api/account/*` → Clerk `auth()` + per-user scoping. All `/api/market/*` premium surfaces → `authorizeMarketDeskApi`/`requireTierApi`. Public-by-design: `health`, `ready`, `engine/health`, `public/track-record`, `webhook/whop`.

---

## Findings

### Critical

---

**Title:** Clerk auth library on a version with a published authorization-bypass advisory
**Severity:** Critical
**File:** `package.json` (`"@clerk/nextjs": "^5.7.6"`); resolved `node_modules/@clerk/backend@1.14.1`, `@clerk/shared@2.9.2`
**Code reference:** `npm audit` output:
```
@clerk/clerk-react ... Severity: high
Clerk has an authorization bypass when combining organization, billing, or
reverification checks - https://github.com/advisories/GHSA-w24r-5266-9c3c
... @clerk/nextjs / @clerk/backend / @clerk/shared depend on vulnerable versions
fix available via `npm audit fix --force` (installs @clerk/nextjs@7.5.8 — breaking)
```
**Why it's a problem:** Clerk is the *entire* authentication and authorization boundary for the app — `requireAuth`, `requireAdminApi`, and `resolveUserTier` all delegate to it. A flagged authorization-bypass in the auth library is the worst place to carry a known CVE. The advisory specifically concerns combined org/billing/reverification checks; the app's tier gating reads `publicMetadata.tier` and admin role from `publicMetadata.role`, so the precise exploitability against *this* app's check pattern is **Not verified — needs the advisory's technical detail vs. the app's exact Clerk calls**, but the risk class (auth bypass) plus the auth-critical position make this Critical regardless.
**Impact (500 concurrent users):** A working bypass means unauthenticated or non-premium users could reach premium market data, the admin surface, or other users' Night's Watch positions / Largo sessions. At 500 users the blast radius is the whole paid product and all per-user data.
**Recommended fix:** Upgrade Clerk to a patched line. `@clerk/nextjs@7.x` is the fixed major but is a breaking change — schedule the migration before launch, test the auth flows (sign-in, tier gate, admin gate) end-to-end. If a v7 migration cannot land pre-launch, pin to the latest patched **5.x** that resolves `@clerk/shared`/`@clerk/backend` off the vulnerable range and re-run `npm audit`.
**Example code change:**
```jsonc
// package.json — after validating the v7 migration guide
"@clerk/nextjs": "^7.5.8"
```
Then `npm install && npm audit` must show the Clerk advisories cleared.

---

### High

---

**Title:** Next.js 14.2.35 carries 14 security advisories (SSRF, DoS, cache-poisoning, XSS)
**Severity:** High
**File:** `package.json` (`"next": "14.2.35"`)
**Code reference:** `npm audit`:
```
next 9.3.4-canary.0 - 16.3.0-canary.5  Severity: high
- Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades (GHSA-c4j6-fc7j-m34r)
- Next.js has a Denial of Service with Server Components (GHSA-q4gf-8mx6-v5v3, -8h8q-6873-q5fj)
- Next.js's Middleware / Proxy redirects can be cache-poisoned (GHSA-3g8h-86w9-wvmq)
- Next.js vulnerable to cross-site scripting in App Router applications using CSP nonces (GHSA-ffhc-5mcf-pf4q)
- Next.js has a Denial of Service in the Image Optimization API (GHSA-h64f-5h5j-jqjh)
- ... (14 total)
```
**Why it's a problem:** The app uses the App Router, SSE/WebSocket upgrades (`/api/market/live`, `/api/market/flows/stream`, `spxBroadcaster`, Polygon/Massive sockets), Server Components, and `next/image` optimization — i.e. the exact surfaces these advisories target. The WebSocket-upgrade SSRF and the Server-Component DoS are directly reachable.
**Impact (500 concurrent users):** The DoS advisories are the sharpest concern at scale — a single attacker can amplify a Server-Component or Image-Optimizer DoS to degrade the service for all 500 users. Cache-poisoning could serve a poisoned response to many users at once.
**Recommended fix:** Upgrade to a patched Next 14.2.x release (preferred — smallest blast radius; `npm audit` shows the fix path lands on a much newer line, so pick the **highest patched 14.2.x** rather than jumping majors unless you intend to). Re-run `npm audit` and smoke-test SSR, image optimization, and the SSE routes after upgrade. **Not verified — needs** confirmation of the exact minimum patched 14.2.x from the Next.js security releases.

---

**Title:** No application-layer / per-IP rate limiting on expensive and auth endpoints (cost + DoS)
**Severity:** High
**File:** all routes (no global limiter); e.g. `src/app/api/market/largo/query/route.ts`, `src/app/api/market/quote/route.ts`, `src/app/api/public/track-record/route.ts`
**Code reference:** Largo has only a *per-user* concurrency/budget gate that **fails open** when Redis is down:
```ts
// src/app/api/market/largo/query/route.ts:35
if (!redis) return { acquired: true, redis: null }; // fail-open: no Redis → no gate
// :75-83 budget check also returns false (allow) on any Redis null/error
```
There is no per-IP throttle anywhere, and no limiter in front of sign-in, `/api/public/track-record`, or `/api/health`.
**Why it's a problem:** (1) Largo calls the Anthropic API (real money per query). The only cost guard is Redis-backed and fails open — a Redis blip removes the daily-budget and concurrency caps simultaneously. (2) Authenticated-but-cheap endpoints (`quote`, `ticker-search`, `flows`) collapse to shared caches, but the **auth check itself** calls Clerk; a flood of unauthenticated requests still incurs a Clerk `getUser`/session lookup per request (mitigated by the 60s tier cache only for already-known users). (3) Public routes have zero abuse protection.
**Impact (500 concurrent users):** A malicious or buggy client can (a) run up the Anthropic bill during a Redis outage, (b) exhaust the Clerk Backend API rate limit (the code comments already note Clerk 502s under poll storms), or (c) saturate the single shared Polygon/UW upstream budget. Any of these degrades the product for all paying users.
**Recommended fix:** Add an edge/proxy rate limiter (Railway/Cloudflare in front, or a Redis token-bucket middleware) keyed by IP for unauthenticated routes and by `userId` for authenticated ones. For Largo specifically, make the budget gate **fail closed** (reject when Redis is unavailable) since the downside is a real dollar cost, not just a degraded UX.
**Example code change:**
```ts
// largo/query — flip the cost gate to fail-closed
async function acquireLargoSlot(userId: string) {
  const redis = (await getUwCacheRedis()) as GateRedis;
  if (!redis) return { acquired: false, redis: null }; // fail-CLOSED for a paid LLM path
  ...
}
```

---

**Title:** Whop webhook drops (and 200-ACKs) membership changes when `WHOP_WEBHOOK_SECRET` is unset
**Severity:** High
**File:** `src/app/api/webhook/whop/route.ts:31-59`
**Code reference:**
```ts
if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
  // Return 200 so Whop does not retry-loop or blacklist this endpoint.
  ...
  return NextResponse.json({ ok: true, warning: "webhook_secret_not_configured" }, { status: 200 });
}
```
**Why it's a problem:** With the secret unset the endpoint acknowledges every webhook as 200 but processes nothing. Signature verification (the security control) is only reached *after* this branch. If the env var is missing in prod, billing/membership state silently desyncs (paying users not upgraded; cancelled users not downgraded). It's a fail-open of the billing→entitlement pipeline, gated entirely on an env var being present. The code does alert ops via Discord, which is good, but the entitlement loss is still silent to users.
**Impact (500 concurrent users):** A misconfigured deploy means new purchases never grant premium and cancellations never revoke it — both a revenue-loss and an access-control problem at scale. The `membership-reconcile` cron partially heals this, but only for users whose Whop email is readable.
**Recommended fix:** Treat a missing webhook secret as a **deploy-blocking** misconfiguration in production: fail the health/readiness check (`/api/ready`) when `WHOP_WEBHOOK_SECRET` is unset in `NODE_ENV=production`, so the bad deploy never goes live. Keep the 200-ACK behavior only as a last-resort runtime guard.
**Example code change:**
```ts
// src/app/api/ready/route.ts — add to the readiness gate
if (process.env.NODE_ENV === "production" && !process.env.WHOP_WEBHOOK_SECRET?.trim()) {
  return NextResponse.json({ ready: false, reason: "WHOP_WEBHOOK_SECRET unset" }, { status: 503 });
}
```

---

**Title:** No `middleware.ts` auth backstop — every route self-gates; one forgotten guard = open endpoint
**Severity:** High
**File:** project-wide (no `src/middleware.ts`; verified absent via Glob). Referenced as if it exists in `src/app/api/public/track-record/route.ts:6` ("See the security contract in src/middleware.ts").
**Code reference:**
```
$ glob src/**/middleware.ts  → No files found
```
Yet a route comment points at it:
```ts
// src/app/api/public/track-record/route.ts:5-6
// requireTierApi / authorizeMarketDeskApi / isCronAuthorized). See the security
// contract in src/middleware.ts — public-ness is an explicit per-handler choice.
```
**Why it's a problem:** Clerk's recommended pattern is a `clerkMiddleware()` that establishes the auth context and can enforce a default-deny. Here, auth is enforced **only** inside each route handler. Today every handler is correctly guarded (audited above), but there is no defense-in-depth: a new `/api/...` route that forgets `auth()`/`requireTierApi` is silently public, and the referenced `middleware.ts` "security contract" file does not actually exist.
**Impact (500 concurrent users):** A single future omission exposes premium data or a mutating endpoint with no second layer to catch it. The missing-but-referenced file also misleads reviewers into thinking a backstop exists.
**Recommended fix:** Add a `clerkMiddleware()` in `src/middleware.ts` that (a) wires Clerk auth context app-wide and (b) default-denies `/api/*` except an explicit public allowlist (`/api/health`, `/api/ready`, `/api/engine/health`, `/api/public/*`, `/api/webhook/*`). Keep per-route checks as the authoritative gate; middleware is the backstop. Update or remove the stale comment so the "security contract" reference is real.

---

**Title:** `eslint.ignoreDuringBuilds: true` — security lint never blocks a deploy
**Severity:** High
**File:** `next.config.mjs:61`
**Code reference:**
```js
eslint: { ignoreDuringBuilds: true },
```
**Why it's a problem:** Production builds skip ESLint entirely. The comment says lint runs in CI via `npm run lint`, but if CI is not enforced on the deploy path (Railway builds straight from source), nothing prevents shipping code that violates security-relevant lint rules (e.g. `react/no-danger`, `jsx-a11y`, or any custom rule banning unsafe patterns). **Not verified — needs** confirmation that the GitHub Actions/CI gate is *required* and blocks Railway deploys.
**Impact (500 concurrent users):** Security regressions (a newly introduced `dangerouslySetInnerHTML`, a leaked secret pattern) can reach prod undetected if CI is advisory rather than blocking.
**Recommended fix:** Make `npm run lint` (and any security lint) a **required** status check that blocks merge/deploy. Optionally keep `ignoreDuringBuilds` for build speed *only* if CI enforcement is guaranteed; otherwise set it to `false`.

---

### Medium

---

**Title:** CSP allows `'unsafe-inline'` and `'unsafe-eval'` in `script-src`
**Severity:** Medium
**File:** `next.config.mjs:25-28`
**Code reference:**
```js
"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview.com ...",
```
**Why it's a problem:** `'unsafe-inline'` + `'unsafe-eval'` on `script-src` largely defeats the XSS-mitigation value of CSP: if any reflected/stored XSS sink is ever introduced, inline script execution is allowed. There is also a Next.js advisory specifically about XSS in App-Router apps **using CSP nonces** — and this CSP uses neither nonces nor hashes.
**Impact (500 concurrent users):** Reduced defense-in-depth. No XSS sink exists today (no `dangerouslySetInnerHTML`), so this is latent, but it removes the safety net for any future injection.
**Recommended fix:** Move to a nonce- or hash-based CSP and drop `'unsafe-inline'`/`'unsafe-eval'` from `script-src`. Next.js supports nonce injection; TradingView's embed can be loaded with a nonce. If `'unsafe-eval'` is required by a dependency, scope it as tightly as possible and document why. **Not verified — needs** a check of whether TradingView/recharts/framer-motion actually require `eval` at runtime.

---

**Title:** Largo agent egress + tool loop is a server-side fetch surface driven by model output
**Severity:** Medium
**File:** `src/lib/providers/web-search.ts:18-101`; `src/lib/largo-terminal.ts` (tool loop); `src/app/api/market/largo/query/route.ts`
**Code reference:** Web search posts a model/user-influenced query to fixed provider hosts:
```ts
// web-search.ts:24
await trackedFetch("web_search", "/search", "https://api.tavily.com/search", { ... body: JSON.stringify({ query: q, ... }) })
```
**Why it's a problem:** The Largo terminal is an Anthropic tool-loop driven by user questions (capped at 4000 chars). Today the egress targets are **fixed allowlisted hosts** (Tavily/Serper/Brave, the engine via `fetchEngine`'s allowlist, Polygon/UW providers), so there is no arbitrary-URL SSRF. The residual risk is **prompt-injection-driven tool abuse**: a crafted question (or injected content returned by web search) could steer the model to call internal tools in unintended ways, and search results are concatenated into the model context. This is an LLM-application risk class rather than a classic SSRF.
**Impact (500 concurrent users):** Bounded by per-user concurrency (2) and the daily budget, and by the tool allowlist — so blast radius is one user's session and some token cost. The main exposure is data the tools can read (the user's own positions, market data) being summarized back; cross-user data is not reachable because tools scope by `userId`.
**Recommended fix:** Keep the host allowlists. Ensure no Largo tool can take a fully user-controlled URL/host as an argument (audit each tool definition in `run-tool.ts`). Treat web-search result text as untrusted (it already is, since it's only summarized, not executed). Confirm the Anthropic API key is server-only (it is: `ANTHROPIC_API_KEY`, gated by `largoConfigured()`).

---

**Title:** Database SSL defaults to `rejectUnauthorized: false` (cert not validated) on the public endpoint
**Severity:** Medium
**File:** `src/lib/db.ts:38-47`
**Code reference:**
```ts
function poolSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  ...
  const strict = process.env.DATABASE_SSL_STRICT === "1";
  return { rejectUnauthorized: strict }; // default false
}
```
**Why it's a problem:** When connecting over the public Postgres endpoint (the documented fallback when Railway private DNS fails), TLS is used but the server certificate is **not verified** by default (`rejectUnauthorized: false`). That permits an active MITM to impersonate the database. The private `.railway.internal` path correctly uses no TLS (internal VPC), which is fine; the concern is the public fallback.
**Impact (500 concurrent users):** If the app ever runs on the public DB URL (e.g. private DNS outage, as the code explicitly handles and warns about), an attacker on the network path could intercept or tamper with all user data (positions, journal, membership metadata is in Clerk, but flow/play state is in PG).
**Recommended fix:** Set `DATABASE_SSL_STRICT=1` in production and provide the managed Postgres CA so the public endpoint validates properly. Prefer keeping traffic on the private network so the public fallback is never used. **Not verified — needs** prod env: confirm whether `DATABASE_URL` (private) is the active mode in production (the code logs a warning when it falls back to public).

---

**Title:** `push/subscribe` lets an authenticated user overwrite another user's subscription row (endpoint is the PK)
**Severity:** Medium
**File:** `src/app/api/push/subscribe/route.ts:45-53`
**Code reference:**
```sql
INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
  VALUES ($1, $2, $3, $4)
ON CONFLICT (endpoint)
  DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
```
**Why it's a problem:** `endpoint` is the primary key and `ON CONFLICT` overwrites `user_id`. An authenticated user who knows or guesses another user's push `endpoint` can re-point that row to themselves (or clobber its keys), which would hijack or break the victim's push delivery. Push is currently a scaffold (admin-only send, inert without VAPID + `web-push`), which limits live impact.
**Impact (500 concurrent users):** Low today (push not delivering), but once enabled this is a cross-user tampering/IDOR on the subscription table. Endpoints are long and high-entropy, so guessing is hard, but they can leak (logs, browser, network).
**Recommended fix:** Scope the upsert so a row can only be claimed by its owner — make the conflict target `(endpoint, user_id)` or add `WHERE push_subscriptions.user_id = EXCLUDED.user_id` to the `DO UPDATE`, and on a true conflict from a *different* user, reject rather than overwrite.

---

**Title:** Membership/entitlement keys on email — shared/duplicate emails can cross-grant tiers
**Severity:** Medium
**File:** `src/lib/membership.ts:17-28, 65-90`; `src/app/api/webhook/whop/route.ts:95-97`
**Code reference:**
```ts
export async function findClerkUsersByEmail(email: string) {
  ...
  const { data } = await client.users.getUserList({ emailAddress: [normalized], limit: 10 });
  return data; // up to 10 Clerk users share this email
}
```
and the webhook syncs by `event.data.user?.email`.
**Why it's a problem:** Entitlement is derived from email matching between Whop and Clerk. If two distinct Clerk accounts share an email address (Clerk allows this in some configs), a single Whop purchase could grant premium to *all* matching Clerk users (the sync returns up to 10 and updates each). Conversely a deactivation downgrades all of them.
**Impact (500 concurrent users):** A user could potentially obtain premium for a second account by registering it with the same email as a paid account. Probability is low (requires email reuse), but the entitlement is money-gated.
**Recommended fix:** Bind entitlement to a stable identifier where possible (store `whop_user_id`/`whop_membership_id` — already in the metadata type — and reconcile on that), and enforce unique verified emails per Clerk account. At minimum, log/alert when `findClerkUsersByEmail` returns more than one user so collisions are visible.

---

**Title:** Verbose upstream error messages returned to clients (information disclosure)
**Severity:** Medium
**File:** `src/app/api/market/largo/query/route.ts:234-235`; `src/app/api/market/flows/route.ts:41`
**Code reference:**
```ts
// largo/query
const message = error instanceof Error ? error.message : "Largo query failed";
return NextResponse.json({ error: message }, { status: 502 });
```
```ts
// flows
return NextResponse.json({ source: "postgres_error", flows: [], count: 0, error: detail }, { status: 503 });
```
**Why it's a problem:** Raw `error.message` / `detail` is echoed to the client. These can leak internal details (DB error text, upstream provider responses, stack-ish fragments) that aid an attacker mapping the backend. Most routes correctly return generic messages; these two (and a few siblings) pass the raw message through.
**Impact (500 concurrent users):** Low individually, but it lowers the cost of reconnaissance across a large user base; an attacker can probe to surface DB/provider internals.
**Recommended fix:** Return a generic client-facing message and log the detail server-side only. Reserve detailed errors for admin/telemetry surfaces (which are already gated).

---

### Low

---

**Title:** `glob` CLI command-injection advisory (devDependency via `eslint-config-next`)
**Severity:** Low
**File:** `package-lock.json` (transitive: `eslint-config-next` → `@next/eslint-plugin-next` → `glob 10.2.0-10.4.5`)
**Code reference:** `npm audit`: *"glob CLI: Command injection via -c/--cmd executes matches with shell:true (GHSA-5j98-mcp5-4vw2)"*.
**Why it's a problem:** Only the `glob` **CLI** with `-c/--cmd` is affected, and this is a build/lint-time devDependency — it is not in the runtime/production graph. Low real risk.
**Impact:** Negligible at runtime; minor supply-chain hygiene in CI.
**Recommended fix:** Bump `eslint-config-next` when upgrading Next (the audit's fix path updates this chain). Not launch-blocking.

---

**Title:** `postcss` moderate XSS-in-stringify advisory (build-time)
**Severity:** Low
**File:** transitive `next/node_modules/postcss <8.5.10`
**Code reference:** `npm audit`: *"PostCSS has XSS via Unescaped </style> in its CSS Stringify Output (GHSA-qx2v-qp2m-jg93)"* — moderate.
**Why it's a problem:** Build-time CSS tooling; the app does not feed untrusted CSS through PostCSS at runtime. Low impact.
**Impact:** Negligible for this app's usage.
**Recommended fix:** Resolves with the Next upgrade. Track, don't block.

---

**Title:** `js-cookie` prototype-hijack advisory (transitive via Clerk)
**Severity:** Low
**File:** transitive `@clerk/shared → js-cookie <=3.0.5`
**Code reference:** `npm audit`: *"JavaScript Cookie: Per-instance prototype hijack in assign() enables cookie-attribute injection (GHSA-qjx8-664m-686j)"*.
**Why it's a problem:** Bundled by Clerk's client SDK. Exploitation requires attacker-controlled input into `js-cookie`'s `assign()`, which is not a path the app drives directly. Will be cleared by the Clerk upgrade (Critical finding).
**Impact:** Low; folds into the Clerk remediation.
**Recommended fix:** Resolved by upgrading Clerk.

---

**Title:** Admin allowlist depends on `ADMIN_EMAILS` env + Clerk `publicMetadata.role` (no MFA enforcement at app layer)
**Severity:** Low
**File:** `src/lib/admin-access.ts:5-23, 70-74`
**Code reference:**
```ts
function adminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
...
const isAdmin = role === "admin" || isAdminEmail(email);
```
**Why it's a problem:** Admin status is granted by either a Clerk `publicMetadata.role === "admin"` **or** an email in `ADMIN_EMAILS`. `publicMetadata` is server-written (good), but the gate has no application-level requirement that admin accounts use MFA. If an admin's Clerk account is phished without MFA, the admin surface (telemetry with sanitized snippets, manual cron triggers, push send) is exposed.
**Impact:** Limited — admin routes are read/ops-oriented and snippets are redacted; no money movement. Still, admin compromise enables triggering pipelines and reading ops data.
**Recommended fix:** Enforce MFA for admin accounts in Clerk (org/role policy) and document it. Optionally verify `user.twoFactorEnabled` in `resolveAdminApi()` and deny admin if false. **Not verified — needs** Clerk dashboard config.

---

**Title:** Largo concurrency / membership-sync / quote gates fail **open** on Redis errors
**Severity:** Low
**File:** `src/app/api/market/largo/query/route.ts:35,46,81`; `src/lib/membership-sync-limit.ts` (cooldown); quote coalescing
**Code reference:**
```ts
} catch {
  // Redis error → fail-open so queries are never blocked by infra issues
  return { acquired: true, redis: null };
}
```
**Why it's a problem:** Multiple abuse/cost gates intentionally fail open when Redis is unavailable, prioritizing availability over protection. For purely UX gates (membership sync cooldown) this is reasonable; for the Largo **cost** gate it is a real-money exposure (also captured in the High rate-limiting finding). Listing here for completeness as a design pattern to revisit.
**Impact:** During a Redis outage, per-user caps vanish platform-wide simultaneously.
**Recommended fix:** Differentiate gates: UX/concurrency gates may fail open; **cost** gates (Anthropic) should fail closed or degrade to a conservative static cap. Add Redis-health alerting so an outage that disables all gates is visible immediately.

---

## Things verified as SAFE (so they are not re-litigated)

- **SQL injection:** every query in `db.ts`, `largo-store.ts`, `personal-alert-store`, `push/*`, telemetry-persist uses `$n` placeholders; dynamic `SET`/`WHERE` builders push values as params (`db.ts:1166-1194`, `fetchRecentFlows` clause builder). No string interpolation of user input into SQL.
- **XSS:** no `dangerouslySetInnerHTML` / `innerHTML` anywhere in `src`.
- **SSRF (app-level):** engine proxy allowlist (`engine/[...path]/route.ts:12` + `engine.ts:28-37`), Discord host allowlist + path regex (`personal-alert-validate.ts:12-29`), web-search fixed hosts. POST proxying explicitly disabled.
- **Secret handling:** `.env.local` is gitignored; no server secret names/values found in `.next/static`; engine secret sent as header not query; telemetry redacts URL/body/snippet/headers (`api-telemetry-sanitize.ts`), error-sink sanitizes message/stack/meta.
- **Webhook auth:** Whop signature verified via SDK `unwrap()`; invalid sig → 400.
- **Cron auth:** constant-time `timingSafeEqual` Bearer compare, single gate for all crons (`market-api-auth.ts:7-16`).
- **IDOR / per-user isolation:** positions, journal, Largo sessions, personal-alerts, push all scope every query by Clerk `userId`; Largo enforces `sessionOwnedByUser` before reads.
- **Tier/auth fail-closed:** `tier-cache.ts` never over-grants on Clerk outage; `requireTierApi` returns 503 (retryable) when unknown.
- **CORS:** none configured → same-origin only.

---

## Launch blockers (ordered)

1. **Upgrade Clerk off the auth-bypass advisory (GHSA-w24r-5266-9c3c).** [Critical]
2. **Upgrade Next.js 14.2.35 to a patched 14.2.x** (SSRF/DoS/cache-poison/XSS). [High]
3. **Add per-IP / per-user rate limiting** (edge or Redis), and **fail-close the Largo cost gate**. [High]
4. **Make `WHOP_WEBHOOK_SECRET` a production readiness gate** so a misconfigured deploy can't silently drop entitlement webhooks. [High]
5. **Add a `clerkMiddleware()` default-deny backstop** for `/api/*` (and fix the stale `middleware.ts` reference). [High]
6. **Ensure CI lint is a required, deploy-blocking check** (given `ignoreDuringBuilds: true`). [High]

Recommended pre-launch but not strictly blocking: nonce-based CSP (drop `unsafe-inline`/`unsafe-eval`), `DATABASE_SSL_STRICT=1` on the public DB path, push-subscribe owner-scoped upsert, generic client error messages, and entitlement keyed on `whop_user_id` rather than email.
