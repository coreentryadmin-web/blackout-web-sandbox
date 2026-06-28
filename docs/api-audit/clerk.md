# Clerk API Audit
Last updated: 2026-06-28

Clerk is the platform's entire authentication and user-identity layer — every user flows
through it for sign-up, sign-in, tier resolution, and admin gating. SDK: **@clerk/nextjs
`^7.5.8`**, **@clerk/types `^4.101.25`**, **svix `1.45.1`**.

## Summary
- **Backend API surface used:** `users.getUser`, `users.getUserList`, `users.updateUserMetadata` — 3 of ~40+ available Backend API operations (we only need user management; sessions/orgs/invitations are unused by design).
- **Webhook events:** handling **2** (`user.created`, `user.updated`) of ~30+ available.
- **SDK server/client functions used:** `auth()`, `currentUser()`, `clerkClient()`, `clerkMiddleware()`, `createRouteMatcher()`, `useUser()`, `useAuth()`, `useSession()` + components `ClerkProvider`, `SignIn`, `SignUp`, `UserButton`.
- **Security/lifecycle gaps:** **3** (1 high — `user.deleted` unhandled; 1 high-value latency win — tier not in JWT claims; 1 low — webhook reads `email_addresses[0]` not primary).

---

## Backend API Usage
| Method/Endpoint | Status | File:Line | Notes |
|---|---|---|---|
| `clerkClient().users.getUser(userId)` | USED | [admin-access.ts:18,27,41,70](src/lib/admin-access.ts), [tier-cache.ts:67](src/lib/tier-cache.ts), [personal-alert-store.ts:20](src/lib/personal-alert-store.ts) | Reads `publicMetadata.role` (admin) and `publicMetadata.tier`. Tier reads are wrapped in a 60s in-memory cache (see `resolveUserTier`). |
| `clerkClient().users.getUserList({emailAddress})` | USED | [membership.ts:22](src/lib/membership.ts) | Email→user lookup for Whop membership sync. |
| `clerkClient().users.getUserList({limit, offset})` | USED | [membership.ts:243](src/lib/membership.ts) | Paginated full-user scan in `reconcileAllMemberships`. |
| `clerkClient().users.updateUserMetadata(id, {publicMetadata})` | USED | [membership.ts:39](src/lib/membership.ts) | Writes `{tier, whop_user_id, whop_membership_id}`. Uses metadata deep-merge (not `updateUser`) to avoid clobbering concurrent writes. |
| `clerkClient().users.updateUserMetadata(id, {privateMetadata})` | USED | [personal-alert-store.ts:38,47](src/lib/personal-alert-store.ts) | Personal alert webhooks stored server-only in `privateMetadata`. |
| `users.deleteUser`, `users.banUser`, `users.lockUser` | UNUSED-LOW-PRIORITY | — | Admin moderation. Could power an admin "disable user" action; not needed today. |
| `users.getUserOauthAccessToken` | UNUSED-LOW-PRIORITY | — | Only relevant if we call third-party APIs on the user's behalf via their OAuth. N/A. |
| `sessions.*` (getSessionList, revokeSession) | UNUSED-VALUABLE | — | `sessions.revokeSession` would let the `/admin` panel force-logout a user (e.g. after a refund/ban). See recommendations. |
| `invitations.*`, `organizations.*`, `allowlistIdentifiers.*` | UNUSED-LOW-PRIORITY | — | B2C product, no orgs/seat-invites (see [Clerk settings memo] — Organizations deliberately OFF). |
| `actorTokens.*` (impersonation) | UNUSED-VALUABLE | — | Admin "sign in as user" for support debugging. Medium value; security-sensitive. |

---

## Webhook Events
Handler: [src/app/api/webhooks/clerk/route.ts](src/app/api/webhooks/clerk/route.ts) (alias re-export at `src/app/api/webhook/clerk/route.ts`). Svix signature verification, fail-closed (400) on bad sig; DB errors fail-open (200) to avoid Clerk retry storms.

| Event | Status | File:Line | Impact |
|---|---|---|---|
| `user.created` | HANDLED | [route.ts:50-65](src/app/api/webhooks/clerk/route.ts) | INSERT users row (`ON CONFLICT DO UPDATE`). |
| `user.updated` | HANDLED | [route.ts:66-77](src/app/api/webhooks/clerk/route.ts) | UPDATE email/name. |
| `user.deleted` | **MISSING-RISK** | — | **No handler.** When a user deletes their account in Clerk, our `users` row, `spx_play_outcomes`, personal-alert metadata, etc. are orphaned. GDPR/CCPA deletion is not propagated. **High priority** — see gaps. |
| `session.created` | UNUSED-LOW-PRIORITY | — | Could feed login analytics / "active now" counts. |
| `session.ended` / `session.removed` / `session.revoked` | UNUSED-VALUABLE | — | Would let us proactively tear down per-user SSE/desk streams ([authorizeMarketDeskApi](src/lib/market-api-auth.ts)) and clear server caches on logout, instead of relying on the client `SessionCacheGuard`. |
| `email.created` / `sms.created` | UNUSED-LOW-PRIORITY | — | Only needed if we want to relay Clerk-sent OTP/magic-link emails through our own provider. We let Clerk send natively. |
| `organization*` / `permission*` / `role*` | N/A | — | Orgs disabled by design (B2C). |
| `waitlistEntry.*` | UNUSED-LOW-PRIORITY | — | Only if we enable Clerk Waitlist mode for launch gating (we gate via `LAUNCHED_TOOLS` env instead). |

---

## SDK Features
| Feature | Status | File:Line | Notes |
|---|---|---|---|
| `clerkMiddleware()` + `createRouteMatcher()` | USED | [middleware.ts:1,3,12](src/middleware.ts) | Protects `/dashboard /flows /terminal /heatmap /nighthawk /admin`. API routes are NOT auto-guarded — each self-gates. Clock-skew tolerance raised to 10s. |
| `auth()` | USED | [auth-access.ts:7](src/lib/auth-access.ts), [admin-access.ts:39,56](src/lib/admin-access.ts), [market-api-auth.ts:29](src/lib/market-api-auth.ts) | Returns `{userId}`. **`sessionClaims` is available here but unused** — see latency recommendation. |
| `currentUser()` | USED | [membership/sync/route.ts:22](src/app/api/membership/sync/route.ts) | Full user fetch for email during manual sync. |
| `publicMetadata.tier` | USED | [tier-cache.ts:68](src/lib/tier-cache.ts), [SpxDashboard.tsx:41](src/components/SpxDashboard.tsx) | Source of truth for entitlement. |
| `publicMetadata.role` | USED | [admin-access.ts:19,71](src/lib/admin-access.ts) | Admin flag (OR email allowlist `ADMIN_EMAILS`). |
| `privateMetadata` | USED | [personal-alert-store.ts:38,47](src/lib/personal-alert-store.ts) | Server-only personal-alert webhook config. |
| `sessionClaims` (custom JWT claims) | **UNUSED-VALUABLE** | — | Tier/role are NOT in the session token, so every cold-cache protected request makes a Backend API `getUser` call. Putting `tier`/`role` in the JWT eliminates that. **High value** — see recommendations. |
| `getToken()` | UNUSED-LOW-PRIORITY | — | No backend-to-backend JWT minting needed yet. |
| `ClerkProvider` (`dynamic`) | USED | [layout.tsx:108](src/app/layout.tsx) | `dynamic` flag preserves per-request auth under Next 15 / Clerk v7 static-default; comment cites RSC-handshake CVE GHSA-w24r-5266-9c3c. |
| `SignIn` / `SignUp` (catch-all routes) | USED | sign-in/sign-up `page.tsx:14` | Themed via [clerk-theme.ts](src/lib/clerk-theme.ts). |
| `UserButton` | USED | [Nav.tsx:328,401](src/components/Nav.tsx) | Inline appearance override. |
| `useAuth()` | USED | [Nav.tsx:94](src/components/Nav.tsx), OnboardingGuide, [SessionCacheGuard.tsx](src/components/SessionCacheGuard.tsx) | `{isSignedIn,isLoaded,userId}`. |
| `useUser()` | USED | [SpxDashboard.tsx:4](src/components/SpxDashboard.tsx) | Client tier gate reads `user.publicMetadata.tier`. |
| `useSession()` | USED | [SyncMembershipButton.tsx:5](src/components/SyncMembershipButton.tsx) | `session.reload()` to refresh JWT after a Whop sync. |
| `Protect` / `SignedIn` / `SignedOut` | UNUSED-LOW-PRIORITY | — | We use explicit guards (`requireTier`, `requireAdmin`) instead. Fine. |
| `useClerk()` (e.g. `signOut`, `openUserProfile`) | UNUSED-LOW-PRIORITY | — | `UserButton` covers the current needs. |

---

## Security & Auth Gaps

1. **`user.deleted` webhook is unhandled (HIGH).** Account deletions in Clerk leave orphaned rows in our `users` table and downstream tables, and personal-alert `privateMetadata` is moot but related app data persists. This is both a data-hygiene and a privacy-compliance (GDPR/CCPA right-to-erasure) gap. The handler already has the Svix verification scaffold — adding a `user.deleted` branch is a few lines.

2. **Tier/role not in the session JWT (HIGH-VALUE LATENCY).** `resolveUserTier` ([tier-cache.ts:61-79](src/lib/tier-cache.ts)) calls `clerkClient().users.getUser` on every cold cache (60s TTL, per-replica, max 5k entries). On a fresh replica or after TTL expiry, each protected page/API hit blocks on a Clerk Backend round-trip. Moving `tier` and `role` into custom session claims (`{{user.public_metadata.tier}}`) makes them readable from `auth().sessionClaims` with **zero** Backend calls. This also removes a Clerk-availability dependency from the hot path (today a Clerk outage forces the `TierUnavailableError` 503 / stale-cache degrade path in [auth-access.ts:12-32](src/lib/auth-access.ts)). Caveat: session tokens are cookie-bound (~1.2KB custom-claim budget) — `tier`/`role` are tiny, well within budget. Claims update on next token refresh (~60s), so the `SyncMembershipButton` `session.reload()` path stays the right way to force an immediate refresh after an upgrade.

3. **Webhook reads `email_addresses[0]`, not the primary (LOW).** [route.ts:51,67](src/app/api/webhooks/clerk/route.ts) take the first email in the array, which is not guaranteed to be `primary_email_address_id`. For users with multiple verified emails the stored email can be wrong, and `membership.ts` already iterates all verified emails for Whop matching — so the mismatch is mostly cosmetic, but worth aligning. Use the entry whose `id === data.primary_email_address_id`.

No critical auth-bypass issues found: signature verification is fail-closed, middleware protects the page surface, and every API route self-gates via `requireTierApi` / `requireAdminApi` / cron-bearer.

---

## Implementation Recommendations
Ranked by impact.

1. **Add custom session claims for `tier` and `role`** (Clerk Dashboard → Sessions → Edit claims: `tier: {{user.public_metadata.tier}}`, `role: {{user.public_metadata.role}}`), then read `sessionClaims.tier` in `resolveUserTier`/`isAdminUser` with the existing `getUser` path kept as a fallback. Declare `CustomJwtSessionClaims` in a `types/globals.d.ts`. **Removes a Clerk Backend call from every cold-cache protected request** and decouples the auth hot path from Clerk uptime. Highest impact, low effort, no schema change.

2. **Handle `user.deleted`** in the webhook: soft-delete or hard-delete the `users` row (and cascade / null downstream references) and log it. Closes the privacy-compliance gap and stops orphan accumulation. Subscribe the event in the Clerk Dashboard webhook config.

3. **Fix primary-email selection** in `user.created` / `user.updated` to use `data.primary_email_address_id`.

4. **(Optional, medium) `sessions.revokeSession` + `session.ended` webhook** for an admin force-logout action and proactive SSE/desk-stream teardown on logout — useful once refunds/bans are handled in-app.

5. **(Optional, low) Actor tokens / impersonation** for support debugging from `/admin`, gated behind the existing `requireAdminApi`. Defer until support volume justifies the security surface.

---
*Sources: [Clerk Next.js SDK](https://clerk.com/docs/references/nextjs/overview), [Clerk Webhooks overview](https://clerk.com/docs/guides/development/webhooks/overview), [Custom session token](https://clerk.com/docs/backend-requests/custom-session-token).*
