# 06 · Auth & Clerk — Full Audit (Deliverable H)

**Scope:** Clerk auth end-to-end — `src/middleware.ts`, `src/lib/{auth-access,market-api-auth,tier-cache,admin-access,tiers,whop,membership}.ts`, sign-in/up routes, the Whop webhook + manual-sync handlers, tier/role logic, the admin gate, and every `src/app/api/**/route.ts` and protected page.
**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).
**Method:** Exhaustive enumeration — all 73 API route files, all 30 page files, all 5 auth-helper libs were read or grepped. Read-only; no source modified.
**Target:** scale from <10 → ~500 concurrent users.

## Executive summary

The auth layer is **the strongest area of the platform audited so far**. The security model is explicit and documented in `middleware.ts`, and the codebase honors it: **every** `/api/*` route self-authorizes in its handler (not relying on middleware), **every** protected page calls `requireTier("premium")` server-side (defense-in-depth beyond the middleware redirect), **every** admin route gates on its first line, and **every** cron route checks the `CRON_SECRET` with a constant-time compare. Per-user data routes (positions, journal, Largo sessions, push, personal-alerts) derive `user_id` exclusively from the trusted server-side `auth()` session and scope every query by it — there are no IDOR paths and no header/body-trusted identity. The Whop webhook verifies the Standard-Webhooks HMAC signature and fails closed on a bad signature.

The findings below are therefore mostly **Medium/Low** hardening items, not open holes. The two issues that matter most at 500 concurrent users are operational, not access-control: (1) the **per-replica 60s tier cache** means a downgrade/churn can keep `premium` access for up to 60s on each replica independently (revenue leak + the documented webhook is fire-and-forget), and (2) **`/api/membership/sync` fails open when Redis is down**, letting any signed-in user spam Whop's API (an upstream-rate-limit / cost amplification vector). No Critical access-control defect was found.

## Inventory — auth surfaces

| Surface | File | Gate | Notes |
|---|---|---|---|
| Edge middleware | `src/middleware.ts` | `clerkMiddleware` + `protect()` on page routes only | API routes explicitly NOT guarded here (by design) |
| Page auth | `src/lib/auth-access.ts` | `requireAuth` / `requireTier` | redirects to `/sign-in` or `/upgrade` |
| API auth | `src/lib/market-api-auth.ts` | `requireTierApi` / `authorizeCronOrTierApi` / `authorizeMarketDeskApi` / `isCronAuthorized` | returns 401/403/503 Response |
| Tier resolution | `src/lib/tier-cache.ts` | `resolveUserTier` | 60s per-replica in-memory cache, reads Clerk `publicMetadata.tier` |
| Tier model | `src/lib/tiers.ts` | `parseTier` / `tierAtLeast` | only `free`/`premium`; `pro`/`elite` → premium |
| Admin gate | `src/lib/admin-access.ts` | `requireAdmin` / `requireAdminApi` / `resolveAdminApi` | role==admin OR email in `ADMIN_EMAILS` |
| Whop billing | `src/lib/whop.ts` + `membership.ts` | product/plan-id allowlist | writes `publicMetadata.tier` via `updateUserMetadata` |
| Whop webhook | `src/app/api/webhook/whop/route.ts` | `whop.webhooks.unwrap()` HMAC | fails closed (400) on bad sig |
| Manual sync | `src/app/api/membership/sync/route.ts` | `auth()` + per-user cooldown | email from `currentUser()`, not client |
| Personal webhook | `src/lib/personal-alert-validate.ts` | host allowlist | anti-SSRF, discord.com only |

**API-route gating census (all 73 routes):**
- 17 admin routes → all call `requireAdminApi`/`resolveAdminApi` first-line.
- 12 cron routes → all call `isCronAuthorized` first-line (401 on miss).
- ~30 market routes → all call `authorizeMarketDeskApi`/`authorizeCronOrTierApi`/`requireTierApi`.
- 5 account/push/personal-alerts → all call `auth()` first-line, scope queries by `userId`.
- 4 intentionally public/health: `health`, `ready`, `engine/health`, `public/track-record` (aggregate, PII-free), plus `webhook/whop` (signature-verified). Each is an explicit, documented choice.

No route was found that serves per-user or premium data without a server-side gate.

---

## Findings

### H-0 · [LIVE FINDING 2026-06-24] Test mode is ENABLED on the PRODUCTION Clerk instance → open account creation + email-verification bypass
**Severity:** Critical — **config, not code.** Verified live in the Clerk dashboard (Production instance), not derivable from the repo; this updates the executive summary's "no Critical access-control defect" to "none *in code* — one Critical *config* hole found live."
**Where:** Clerk Dashboard → Blackout Trading → **Production** instance → User & authentication → **"Test mode"** toggle = **ON**.
**What:** With test mode on a production instance, anyone can sign in / sign up using the **public** Clerk test fixtures — any `…+clerk_test@…` email + the fixed verification code **`424242`** (and test phone `+1 555 555 010x`) — with **no real email/SMS verification**. These are documented, public Clerk conventions, so this is effectively a self-service path to a real session on the live app with a throwaway identity.
**Impact:** Account-creation abuse / spam signups; email-verification bypass; polluted user table + signup metrics; a free surface to probe premium gates. The Whop entitlement gate still applies (so it is not *direct* premium access), but it is an open hole on the identity boundary.
**Not app-detectable:** Clerk does **not** expose "test mode on" to the application — the `pk_live` publishable key does not reflect it — so there is **no runtime guard the code can add.** This is dashboard-only by nature.
**Fix (USER ACTION — dashboard, ~30s):** Clerk Dashboard → **Production** instance → toggle **Test mode OFF** before launch; keep test mode only on the **Development** instance. After disabling, confirm a real sign-up requires a real emailed code (not `424242`).
**Status:** **RESOLVED 2026-06-24** — user disabled Test mode on the **Production** Clerk instance (confirmed via dashboard screenshot); the Development instance correctly retains test mode. Surfaced during live UI verification (test mode had been temporarily enabled on prod to grant screenshot-based access). Re-verify post-launch that a `+clerk_test` sign-up on prod is rejected.

### H-B · [LIVE FINDING → FIXED 2026-06-24] Intermittent sign-in bounce on RSC soft-navigation
**Severity:** High (UX/auth) — **RESOLVED** via the Clerk 7 + Next 15 upgrade (`a4bb594`, deployed).
**Symptom:** a logged-in user clicking between tools (e.g. SPX desk → HELIX) was *intermittently* redirected to `/sign-in?redirect_url=…` despite a valid session; a hard reload of the same route logged them straight back in.
**Root cause (reproduced live + confirmed in code):** protected pages are guarded by `auth().protect()` in `clerkMiddleware` (`middleware.ts`). Clerk's session JWT lives ~60s and is refreshed by a **handshake that runs only on top-level *document* requests — never on RSC (soft-navigation) requests.** So when a soft-nav carried a JWT aged past its lifetime (the client SDK hadn't refreshed it yet — right after login, or after a backgrounded tab throttled the refresh timer), `protect()` could not handshake to refresh and redirected to `/sign-in`. The session itself was still valid (a hard nav to the same route handshaked and loaded — verified both directions). The prior `clockSkewInMs: 10_000` covered clock drift only, not a truly-expired token. `@clerk/nextjs` 5.x was frozen at 5.7.6 (no patch), so the fix required v7 — which requires Next.js 15.
**Fix:** Next 14.2.35 → 15.5.19 + Clerk 5.7.6 → 7.5.8 (`a4bb594`). v7 drives the token refresh through the handshake on the protected RSC request (verified: a browser nav to `/dashboard` now 307s to the Clerk handshake endpoint with `__clerk_hs_reason`, not a sign-in bounce). Same upgrade clears `GHSA-w24r-5266-9c3c`. Migration detail: `BLACKOUT_FULL_AUDIT.md` → Post-Audit Resolutions.
**Status:** **RESOLVED — verified in prod 2026-06-24.** Live check via the browser bridge: 4 RSC soft-navs (dashboard → flows → admin → nighthawk) all held the session with **no `/sign-in` bounce**; the admin gate (async `clerkClient`) loaded the control room; UserButton renders. A logged-out protected-route nav `307`s to the Clerk handshake (`__clerk_hs_reason`), not a sign-in bounce — confirming the handshake-on-RSC fix is live.

### H-1 · Per-replica 60s tier cache + fire-and-forget webhook → up to 60s of post-churn premium access per replica
**Severity:** Medium
**File:** `src/lib/tier-cache.ts`
**Code reference** (`tier-cache.ts:19-20`, `40-49`):
```ts
const tierCache = new Map<string, { tier: Tier; at: number }>();
const TIER_CACHE_TTL_MS = 60_000;
...
const cached = tierCache.get(userId);
if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS) return cached.tier;
```
**Why it's a problem:** The cache is an in-memory `Map` per Railway replica with a 60s TTL. A downgrade (Whop `membership.deactivated` webhook → `updateUserMetadata`) only invalidates the cache on the *one* replica that next re-fetches after TTL; other replicas keep serving the stale `premium` tier for up to 60s. Worse, the canonical writer (the Whop webhook) is fire-and-forget and only self-heals via the reconcile cron — so a *dropped* webhook leaves the tier wrong until the next reconcile sweep, and the cache adds another 60s on top per replica. The Whop status list also extends premium during `past_due` / `canceling` grace windows (`whop.ts:7-14`), which is an intentional ops policy but widens the paid-access-after-stop window.
**Impact at 500 concurrent users:** With N replicas, a churned/refunded user retains premium market-data + Largo access for up to 60s after each replica's TTL lapses, and indefinitely if the deactivation webhook is dropped (until `membership-reconcile` runs). At 500 users this is a measurable revenue leak and a UW/Polygon cost leak (churned users still pulling premium streams). It is a *bounded* leak, not an open door.
**Recommended fix:** (a) Have the Whop webhook and `/api/membership/sync` proactively *evict* the user's tier-cache entry across replicas (publish a small Redis pub/sub "tier-changed:{userId}" message that each replica subscribes to and deletes the Map entry on). (b) Shorten TTL for the downgrade-sensitive path, or store the cache in Redis with a short TTL so it's shared. (c) Ensure the reconcile cron runs frequently (already exists at `cron/membership-reconcile`).
**Example change** (eviction hook in `membership.ts` after a successful write):
```ts
// after updateClerkMembershipMetadata(...)
await publishTierChanged(user.id); // redis.publish('tier-changed', user.id)
// tier-cache.ts subscribes once and does tierCache.delete(userId) on message
```

### H-2 · `/api/membership/sync` fails open when Redis is down → unauthenticated-of-cost Whop API amplification
**Severity:** Medium
**File:** `src/lib/membership-sync-limit.ts`, `src/app/api/membership/sync/route.ts`
**Code reference** (`membership-sync-limit.ts:41-43, 50-54`):
```ts
export async function acquireMembershipSyncSlot(userId: string): Promise<SyncSlot> {
  const redis = await getRedis();
  if (!redis) return { ok: true }; // fail-open: no Redis configured
  ...
  } catch (err) { /* fail-open */ return { ok: true }; }
}
```
**Why it's a problem:** The per-user 45s cooldown is the *only* throttle on a route that, per call, fans out to multiple Whop API calls (`whop.members.list` + `whop.memberships.list` paginated, then `clerkClient.users.getUserList` + per-user `updateUserMetadata` — see `membership.ts:65-131`). When Redis is absent or erroring, the cooldown is bypassed entirely, so any single signed-in user can hammer `POST /api/membership/sync` with no server-side limit.
**Impact at 500 concurrent users:** During a Redis outage (or if `REDIS_URL` is unset), a handful of malicious/buggy clients can drive unbounded Whop + Clerk Backend API calls, tripping Whop/Clerk rate limits and degrading membership sync *for everyone* (the same Clerk Backend limit the tier-cache was built to avoid — see `tier-cache.ts:8-14`). It's a self-inflicted DoS / billing-API amplification vector, gated only by the requirement to be signed in.
**Recommended fix:** Add a cheap in-process fallback limiter (per-replica `Map<userId, lastAt>`) so that even with Redis down a user can't exceed ~1 sync/45s on a given replica; or fail *closed* on this specific route (return 429) since a manual resync that's delayed during a Redis outage is benign. Also cap concurrent in-flight syncs globally.
**Example change:**
```ts
// in-process backstop independent of Redis
const localLast = new Map<string, number>();
const now = Date.now();
const prev = localLast.get(userId) ?? 0;
if (now - prev < COOLDOWN_SEC * 1000) return { ok: false, retryAfterSec: COOLDOWN_SEC };
localLast.set(userId, now);
```

### H-3 · `/docs/*` internal API-reference pages gated by sign-in only (any free user), exposing full vendor endpoint/architecture catalog
**Severity:** Low
**File:** `src/middleware.ts` (`isProtectedRoute` includes `/docs(.*)`), pages under `src/app/docs/**`
**Code reference** (`middleware.ts:3-11`):
```ts
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)", "/flows(.*)", "/terminal(.*)", "/heatmap(.*)",
  "/nighthawk(.*)", "/admin(.*)", "/docs(.*)",
]);
```
**Why it's a problem:** `/docs(.*)` is protected only by `auth().protect()` (any signed-in user, including a free account that just signed up). The docs tree contains the platform's internal vendor playbook — full Unusual Whales endpoint catalog (`docs/unusual-whales/endpoints`), Polygon REST/WS maps, `system-analysis`, `cursor-api-analysis`, `claude-api-analysis`, and `api-probe`. These reveal the exact upstream providers, endpoint inventory, and internal architecture. (The *premium* playbook download `/api/docs/spx-playbook` IS correctly premium-gated — `docs/spx-playbook/route.ts:16`.) No live secrets were found in these pages, so this is information-exposure, not credential leak.
**Impact at 500 concurrent users:** Any of the 500 (incl. free/trial users) can enumerate the entire data-vendor surface and internal tooling. This lowers the bar for a competitor to replicate the data pipeline, and for an attacker to map upstream rate-limit chokepoints (the UW 2 RPS cluster-wide limit is a known pressure point). Reconnaissance value, not direct compromise.
**Recommended fix:** Either gate `/docs/*` reference pages behind `requireAdmin()` (they read as internal engineering docs, not customer features) or move them out of the deployed app entirely. If some `/docs` content is genuinely a customer feature, split the customer-facing subset from the internal vendor catalogs.

### H-4 · `/api/push/send` lets an admin broadcast/target push to ANY userId from request body — confirm this is intended admin power, and log it
**Severity:** Low
**File:** `src/app/api/push/send/route.ts`
**Code reference** (`push/send/route.ts:38-39, 78-80`):
```ts
const denied = await requireAdminApi();
if (denied) return denied;
...
const rows = body.userId
  ? (await dbQuery(`... WHERE user_id = $1`, [body.userId])).rows
  : (await dbQuery(`SELECT ... FROM push_subscriptions`)).rows; // ALL users
```
**Why it's a problem:** This is correctly admin-gated, but it's the one route where caller-supplied `body.userId` selects whose data/subscriptions are acted on, and with no `userId` it broadcasts to **every** stored subscription. That's a lot of blast radius behind a single admin check, and there is no audit-log entry on send (unlike `admin/incidents` and `admin/apis/rescan`, which capture `getAdminApiActor()`). It is currently *inert* (returns 501 until VAPID keys + `web-push` are installed), which is why this is Low.
**Impact at 500 concurrent users:** Once VAPID is enabled, a compromised or careless admin session can push an arbitrary title/body/url (`url` becomes a client-side navigation target) to all 500 users — a phishing/notification-spam channel — with no attribution trail.
**Recommended fix:** Record the admin actor + payload via `getAdminApiActor()` + the existing admin-audit log on every send; consider an allowlist/confirmation for the broadcast (no-`userId`) path; validate `body.url` is a same-origin relative path before it ships to clients.

### H-5 · Tier write trusts Clerk `publicMetadata.tier`; the only writers are server-side, but document/enforce that users can never set it
**Severity:** Low (informational hardening)
**File:** `src/lib/tier-cache.ts`, `src/lib/membership.ts`, `src/lib/tiers.ts`
**Code reference** (`tier-cache.ts:46-47`, `tiers.ts:8-11`):
```ts
const user = await clerkClient.users.getUser(userId);
const tier = parseTier(user.publicMetadata?.tier);
...
export function parseTier(value: unknown): Tier {
  if (value === "premium" || value === "pro" || value === "elite") return "premium";
  return "free";
}
```
**Why it's a problem:** Entitlement is driven entirely by Clerk `publicMetadata.tier`, written only by `updateUserMetadata` from the Whop webhook / sync / reconcile (all server-side). Clerk does *not* allow end users to write `publicMetadata` (only `unsafeMetadata`), so there is **no** client escalation path today — this is verified-safe. The residual risk is purely organizational: if anyone ever exposes a Clerk API key client-side, or adds a route that copies `unsafeMetadata.tier`→`publicMetadata`, the whole tier model collapses. `parseTier` is also called only on the trusted metadata value, never on request input (confirmed across the codebase).
**Impact at 500 concurrent users:** None today. Listed so the invariant ("`publicMetadata.tier` is server-write-only; never derive it from `unsafeMetadata` or request input") is explicit and survives future changes.
**Recommended fix:** Add a one-line invariant comment at the `parseTier` call site and the `updateUserMetadata` writer. Optionally add a CI grep that fails if `unsafeMetadata` ever feeds a tier decision.

### H-6 · Admin allowlist via `ADMIN_EMAILS` env + unverified-email risk
**Severity:** Low
**File:** `src/lib/admin-access.ts`
**Code reference** (`admin-access.ts:17-23, 70-74`):
```ts
const role = String(user.publicMetadata?.role ?? "").toLowerCase();
if (role === "admin") return true;
const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress;
return isAdminEmail(email);
```
**Why it's a problem:** Admin is granted if `publicMetadata.role === "admin"` **or** the user's primary email is in `ADMIN_EMAILS`. The email path keys on the *primary* email but does not check that the email is **verified** (`emailAddress.verification.status === "verified"`). If Clerk is configured to allow adding an email without verification (or an account is created with an attacker-chosen unverified primary email that happens to match an allowlisted address), the email branch could grant admin. With Clerk's default (verification required to set a primary email) this is not exploitable, hence Low — but it depends on a Clerk dashboard setting, not on code.
**Impact at 500 concurrent users:** If email-verification enforcement is ever relaxed in the Clerk dashboard, admin access (the full ops console + nighthawk run + rescan + incident write) becomes reachable by anyone who can set an allowlisted email as primary. Not verified — needs the Clerk instance's email-verification policy confirmed in prod.
**Recommended fix:** In `isAdminUser`/`resolveAdminApi`, require the matched email's `verification.status === "verified"` before honoring the `ADMIN_EMAILS` branch. Prefer the `role === "admin"` metadata path as the primary mechanism and treat `ADMIN_EMAILS` as bootstrap-only.
**Example change:**
```ts
const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
const verified = primary?.verification?.status === "verified";
return verified && isAdminEmail(primary?.emailAddress);
```

### H-7 · Whop webhook drops/loses membership changes when `WHOP_WEBHOOK_SECRET` unset or `user.email` is null (acknowledged in-code, but a real entitlement-integrity gap)
**Severity:** Low
**File:** `src/app/api/webhook/whop/route.ts`
**Code reference** (`webhook/whop/route.ts:31-58`, `95-122`):
```ts
if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
  // Return 200 so Whop does not retry-loop ... membership changes are being silently lost
  return NextResponse.json({ ok: true, warning: "webhook_secret_not_configured" }, { status: 200 });
}
...
const email = event.data.user?.email;
if (email) { await syncWhopMembershipForEmail(email); }
else { /* warn + ops alert; change is LOST (no id-based heal path) */ }
```
**Why it's a problem:** Two documented gaps: (1) if `WHOP_WEBHOOK_SECRET` is unset the endpoint 200s and processes nothing; (2) the sync keys entirely on `event.data.user.email`, and if Whop returns `email: null` (app lacks `member:email:read`) the change is silently lost because neither the sync nor the reconcile cron can key off the Whop user id. Both paths fire loud ops alerts and are healed *eventually* by the reconcile cron, which is why this is Low rather than High — but until reconcile runs, tiers are wrong.
**Impact at 500 concurrent users:** With a missing secret or absent `member:email:read` permission, real-time upgrades/downgrades stop working at scale — paid users locked on `free` (support load) and churned users keeping `premium` (revenue leak) until the next reconcile sweep. The `parseTier`/`resolveTierFromMembership` guards (`whop.ts:81-86`) correctly throw rather than silently downgrade when product/plan IDs are unset, which is the right fail-closed posture.
**Recommended fix:** Treat `WHOP_WEBHOOK_SECRET` and `member:email:read` as **boot-required** in production (fail the readiness check, not just log). Add an id-based heal path: persist `whop_user_id` (already stored in `publicMetadata`, `membership.ts:123-127`) and let the reconcile cron resolve email→tier by Whop user id when email is null.

### H-8 · SSE stream auth is per-connect only; long-lived premium streams are not re-checked on downgrade
**Severity:** Low
**File:** `src/app/api/market/live/route.ts`, `src/app/api/market/flows/stream/route.ts`, `src/app/api/market/spx/pulse/stream/route.ts`, `src/app/api/admin/apis/stream/route.ts`
**Code reference** (`market/live/route.ts:18-21`):
```ts
const auth = await authorizeMarketDeskApi(req)
if (auth instanceof Response) return auth
// ... stream stays open indefinitely; tier is never re-evaluated
```
**Why it's a problem:** SSE routes authorize once at connection time, then hold the stream open indefinitely (the `live` stream has no max-duration; flows-stream caps *count* not *duration*). A user who is downgraded (or whose membership lapses) while connected keeps receiving premium data on the existing connection until they disconnect. Combined with H-1's 60s cache, the practical window can exceed a minute. Auth itself is correct — EventSource sends the Clerk session cookie same-origin and `auth()` resolves it; the matcher correctly excludes only WebSocket upgrades, not SSE.
**Impact at 500 concurrent users:** Bounded continued premium-data delivery to churned users on persistent connections; also a resource consideration (the flows-stream `MAX_STREAMS=500` per instance — `flows/stream/route.ts:13` — is per-instance, so total concurrent streams scale with replica count, which is fine, but downgrade enforcement lags).
**Recommended fix:** Add a periodic re-auth tick inside long-lived streams (e.g. every 60–120s re-resolve tier and `controller.close()` if no longer premium), and/or set a `maxDuration` so clients must reconnect (and re-authorize) periodically. The existing heartbeat timer is a natural hook.

### H-9 · `getUserTier` / `requireTierApi` degrade to "free" (deny) on Clerk outage — correct, but causes a hard paywall flap for paying users during Clerk incidents
**Severity:** Low (correctness/UX tradeoff, called out for completeness)
**File:** `src/lib/auth-access.ts`, `src/lib/market-api-auth.ts`, `src/lib/tier-cache.ts`
**Code reference** (`tier-cache.ts:50-57`, `auth-access.ts:26-31`, `market-api-auth.ts:40-45`):
```ts
} catch (err) {
  if (cached) return cached.tier;            // last-known tier — good
  throw new TierUnavailableError();           // no cache → caller denies / 503
}
```
**Why it's a problem:** The fail-closed posture (never over-grant premium on a Clerk outage) is the *correct* security choice and is well-reasoned in the comments. The tradeoff: a premium user with a *cold* cache on a given replica (e.g. right after deploy / new replica scale-up) who hits a Clerk Backend outage gets denied — page → treated as free → redirect to `/upgrade`; API → 503. At 500 users behind autoscaling, replica churn means cold caches are common.
**Impact at 500 concurrent users:** During a Clerk Backend incident, paying users on freshly-scaled replicas can be bounced to `/upgrade` or see 503s until Clerk recovers or a warm replica serves them. Security-correct, but a customer-visible availability dent precisely when you're scaling. Not a vulnerability.
**Recommended fix:** Back the tier cache with Redis (shared, longer "last-known-good" TTL than the 60s freshness TTL) so a cold per-replica Map can fall back to a cross-replica last-known tier during a Clerk outage, preserving the "never over-grant, but don't kick out a known-paying user" intent across replica churn.

---

## Verified-clean (explicitly checked, no issue)

- **No middleware-only protection of API routes.** Every `/api/*` self-authorizes; the security contract in `middleware.ts:27-58` is honored across all 73 routes. The 4 unguarded routes (`health`, `ready`, `engine/health`, `public/track-record`) are intentionally public and benign.
- **No IDOR.** `account/positions[/id]`, `spx/journal`, `largo/session`, `push/subscribe`, `personal-alerts` all derive `userId` from `auth()` and scope every query by it (`positions/[id]/route.ts:28,57,119,146`; `largo-store.ts:51` `sessionOwnedByUser`).
- **Largo AI tool can't escalate.** `runLargoTool` takes a trusted server-side `userId`; `get_my_positions` reads only `input.status`, never owner/userId from model input (`run-tool.ts:1248-1257`).
- **No header/body-trusted identity.** Only `/api/push/send` reads `body.userId`, and it's admin-gated (intended).
- **Engine proxy is not an SSRF/auth-bypass.** `engine/[...path]` enforces an allowlist (`nighthawk/plays`, `heatmap`), blocks traversal, requires premium/cron, and disables POST (`engine/[...path]/route.ts:12-18,53-55`).
- **Personal-webhook is anti-SSRF.** `isValidDiscordWebhook` restricts to https discord.com/discordapp.com `/api/webhooks/...` (`personal-alert-validate.ts:12-29`); stored in `privateMetadata`, never returned (only redacted host).
- **Cron secret compare is constant-time** (`market-api-auth.ts:13-15`, `timingSafeEqual` with length guard).
- **Whop webhook verifies HMAC and fails closed** on bad signature (400) via `whop.webhooks.unwrap` (Standard Webhooks; includes timestamp → replay protection).
- **`updateUserMetadata` deep-merges** (avoids the read-modify-write race) for both tier and personal-webhook writes (`membership.ts:30-42`, `personal-alert-store.ts:47`).
- **No committed secrets / no NEXT_PUBLIC secret leak.** `.env.local` is gitignored; the previously-leaked `NEXT_PUBLIC_ENGINE_WS_KEY` client reference was removed (`api.ts:700-703`). Clerk keys are read by the SDK from env, not referenced in app code.
- **Sign-in/up pages** use stock Clerk `<SignIn>/<SignUp>` components with no custom redirect handling → no open-redirect (`sign-in/[[...sign-in]]/page.tsx`).
- **Protected pages do server-side `requireTier("premium")`** in addition to the middleware redirect — dashboard, flows, terminal, heatmap, nighthawk all verified (`(site)/**/page.tsx`).
- **Prior P0 fixed:** `/api/market/live` (flagged "unauth leak" in the 2026-06 platform audit) now calls `authorizeMarketDeskApi` (`market/live/route.ts:19`).

## Launch blockers

None are hard access-control blockers. Recommended to clear before/just-after the 500-user launch, in priority order:
1. **H-2** — add an in-process fallback for the membership-sync cooldown (Redis-outage cost amplification).
2. **H-7** — make `WHOP_WEBHOOK_SECRET` + `member:email:read` boot-required in prod and add the id-based reconcile heal path (entitlement integrity at scale).
3. **H-1** — cross-replica tier-cache eviction on membership change (revenue + cost leak window).
4. **H-3** — gate or remove `/docs/*` internal vendor catalogs (recon exposure).
