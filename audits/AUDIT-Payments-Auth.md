# Audit — Batch 01: Payments & Auth

**Repo:** `C:\Users\raidu\blackout-web`  
**Method:** Step 2 (full read) + Step 3 (edge-case second pass)  
**Date:** 2026-06-19  
**Scope:** 13 files per `audits/AUDIT-PLAN.md` Batch 01  
**Focus:** auth bypass, VIP gating, Whop webhook issues, session leaks, middleware holes

---

## Findings

### MED-1 — Session cache not cleared on account switch (session leak)

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **File:line** | `src/components/SessionCacheGuard.tsx:12-18` |
| **Bug quote** | `if (wasSignedIn.current && !isSignedIn) { clearAllSessionCache(); }` — only watches `isSignedIn`, not `userId` |
| **Prod impact** | If a user switches Clerk accounts without a sign-out transition (multi-session / account picker), `sessionStorage` retains the prior user's cached premium desk, play, and commentary payloads (TTL up to 12h via `useMergedDesk` / `useSpxPlay`). The next account may briefly see stale market data from the previous session on the same browser tab. |
| **Fix** | Track `userId` from `useAuth()`; call `clearAllSessionCache()` when `userId` changes while signed in, in addition to the existing sign-out path. |
| **Test case** | Sign in as premium User A, load `/dashboard` (desk cache populated). Switch to User B via Clerk account menu without explicit sign-out. User B must not see User A's cached desk/play entries in sessionStorage. |

---

### MED-2 — Middleware enforces auth only; tier gating is per-page (defense-in-depth gap)

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **File:line** | `src/middleware.ts:13-16` |
| **Bug quote** | `if (isProtectedRoute(req)) { auth().protect(); }` — no tier check |
| **Prod impact** | Any signed-in **free** user passes middleware for `/docs(.*)`, `/dashboard(.*)`, etc. Tier enforcement depends entirely on each page calling `requireTier("premium")`. Verified gap (dependency read): `/docs/system-analysis`, `/docs/api-probe`, and `/docs/claude-api-analysis` have **no** `requireTier` — free authenticated users can read internal architecture, API inventory, and probe results. Not a paywall bypass for live market data, but information disclosure and a footgun for future routes added without tier checks. |
| **Fix** | Add premium tier enforcement in middleware for product routes (or a shared `/docs` layout with `requireTier("premium")`). At minimum, add `requireTier` to the three ungated docs pages. |
| **Test case** | Create a free-tier Clerk test user. Confirm middleware allows `/docs/system-analysis` (200) without redirect to `/upgrade`. After fix, expect redirect to `/upgrade`. |

---

### MED-3 — Engine proxy allows any signed-in user (free tier), not premium-only

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **File:line** | `src/app/api/engine/[...path]/route.ts:24` *(Batch 03 file; verified per audit instructions)* |
| **Bug quote** | `const gate = await authorizeCronOrTierApi(req, "free");` |
| **Prod impact** | Prior CRITICAL (unauthenticated credentialed proxy) is **fixed** — route now requires auth + path allowlist + POST disabled. Remaining gap: any signed-in free user can proxy credentialed requests to allowlisted engine paths (`nighthawk/plays`, `heatmap`) using server `DASHBOARD_API_SECRET`. If those endpoints return premium content, this is a paywall bypass. |
| **Fix** | Change minimum tier to `"premium"`: `authorizeCronOrTierApi(req, "premium")` (or `authorizeMarketDeskApi`). |
| **Test case** | Free-tier session: `GET /api/engine/nighthawk/plays` must return 403. Premium session: 200 with data. Unauthenticated: 401. |

---

### LOW-1 — `past_due` / `canceling` Whop statuses grant premium (grace policy)

| Field | Detail |
|-------|--------|
| **Severity** | LOW (business-policy) |
| **File:line** | `src/lib/whop.ts:7-13`, `src/lib/whop.ts:51-52` |
| **Bug quote** | `PREMIUM_MEMBERSHIP_STATUSES` includes `"past_due"`, `"canceling"`, `"trialing"` |
| **Prod impact** | Users whose payment failed or who canceled retain premium until Whop marks membership inactive. Intentional grace period, but extends access beyond active billing if not desired. |
| **Fix** | Confirm product policy. To tighten: restrict to `["active", "trialing", "completed"]` only. |
| **Test case** | Whop membership in `past_due` → sync → Clerk metadata `tier: "premium"`. After tightening, expect `"free"`. |

---

### LOW-2 — Membership sync may scan broad Whop list when `WHOP_COMPANY_ID` unset

| Field | Detail |
|-------|--------|
| **Severity** | LOW |
| **File:line** | `src/lib/membership.ts:76`, `src/lib/membership.ts:86-91` |
| **Bug quote** | `const userIds = companyId ? await findWhopUserIdsByEmail(...) : [];` then iterates `whop.memberships.list(membershipParams)` filtering by email in-loop |
| **Prod impact** | Misconfigured deploy (missing `WHOP_COMPANY_ID`) turns each sync/webhook into an unscoped membership iteration — slow responses and Whop API load. Does not grant incorrect tiers (still filters by email). |
| **Fix** | Fail fast in `syncWhopMembershipForEmail` if `WHOP_COMPANY_ID` is missing. |
| **Test case** | Unset `WHOP_COMPANY_ID`, call `POST /api/membership/sync` → expect 500 with clear config error, not a long hang. |

---

### LOW-3 — Clerk session may lag after membership sync (stale tier in JWT)

| Field | Detail |
|-------|--------|
| **Severity** | LOW (UX / perceived auth bug) |
| **File:line** | `src/components/SyncMembershipButton.tsx:24-25`, `src/lib/auth-access.ts:11-14` |
| **Bug quote** | Sync updates Clerk `publicMetadata.tier` server-side; `SyncMembershipButton` calls `router.refresh()` only |
| **Prod impact** | Paying user syncs successfully but Clerk session JWT may still carry old tier until token refresh/re-login. APIs using `requireTierApi` re-fetch from Clerk server (OK), but client-side `useAuth` metadata and any JWT-cached checks may briefly show stale tier. |
| **Fix** | After sync, call Clerk's `session.reload()` or redirect through sign-in refresh. UNVERIFIED whether `router.refresh()` suffices for Clerk v5+. |
| **Test case** | New payer syncs tier → immediately hit premium API and page without re-login; both must succeed. |

---

## Prior audit reconciliation (`complete-repo-bugs/AUDIT-Payments-Auth.md`)

| # | Original finding | Status |
|---|------------------|--------|
| 1 | Unauthenticated engine proxy (`api/engine/[...path]/route.ts`) | **FIXED** — auth gate, path allowlist (`nighthawk/plays`, `heatmap`), traversal block, POST returns 405. **Residual:** MED-3 (free-tier access). |
| 2 | `NEXT_PUBLIC_ENGINE_WS_KEY` in client bundle (`lib/api.ts`) | **FIXED** — `createFlowSocket()` removed; no client reference remains (verified `lib/api.ts:610-613`). **Ops:** rotate key and remove env vars from Railway (prior bundles may have leaked it). *Out of Batch 01 scope.* |
| 3 | Whop webhook accepts unsigned payloads if secret unset | **CLEARED** — `@whop/sdk` throws `'Webhook key must not be null in order to unwrap'` (`node_modules/@whop/sdk/resources/webhooks.mjs:13-14`); route catch returns 400. Webhooks fail closed when secret unset (operational misconfig, not bypass). |
| 4 | Cron secret via query string (`market-api-auth.ts:9`) | **STILL APPLIES** — `isCronAuthorized` accepts `?secret=`. Low-severity log/history leak vector. *File not in Batch 01; tracked for Batch 03/06.* |

---

## Second Pass (edge cases)

| Edge case | Result |
|-----------|--------|
| Forged Whop webhook body without valid signature | Rejected at unwrap → 400. Tier never taken from payload; handler calls `syncWhopMembershipForEmail` (Whop API is source of truth). **Not bypassable.** |
| `POST /api/membership/sync` with another user's email | Uses caller's primary email only (`api/membership/sync/route.ts:12-13`). Cannot grant self premium without Whop entitlement on that email. |
| Attacker sets Clerk `publicMetadata.tier` manually | Only server-side `updateClerkMembershipMetadata` writes tier; APIs re-read from Clerk server, not client JWT alone. **Not bypassable from browser.** UNVERIFIED: Clerk Dashboard admin manual override (ops, not app bug). |
| Unverified email on Clerk account + victim's email | If Clerk allows unverified primary email, attacker could sync victim's Whop tier. **UNVERIFIED** — depends on Clerk instance email-verification policy (not configured in repo). |
| Multiple Clerk users sharing one email | `findClerkUsersByEmail` updates all matches (`membership.ts:100-107`). Intentional for duplicate accounts; limit 10. |
| `WHOP_*_PRODUCT_IDS` / `PLAN_IDS` all unset | `resolveTierFromMembership` returns `null` → everyone `"free"`. Fail-closed (locks out payers, does not leak premium). |
| `parseTier("pro")` / `parseTier("elite")` legacy values | Maps to `"premium"` (`tiers.ts:9`). Backward-compatible. |
| Path traversal on engine proxy | `normalizeEnginePath` rejects `..` (`route.ts:17`). Non-allowlisted paths → 404. |
| Sign-out clears session cache | `SessionCacheGuard` mounted in root layout (`layout.tsx:40`); clears `blackout:*` keys + `largo-terminal-session` + `blackout_desk_v1`. **Works for normal sign-out.** |
| `/upgrade` page access | Public (not in middleware matcher). Checkout links are public Whop URLs — expected. |
| Admin route via middleware | `/admin(.*)` requires auth in middleware; page adds `requireAdmin()` (Batch 06). Layered correctly. |

---

## Files read in full (13/13)

1. `src/app/sign-in/[[...sign-in]]/page.tsx`
2. `src/app/sign-up/[[...sign-up]]/page.tsx`
3. `src/app/upgrade/page.tsx`
4. `src/components/SessionCacheGuard.tsx`
5. `src/components/SyncMembershipButton.tsx`
6. `src/lib/auth-access.ts`
7. `src/lib/clerk-theme.ts`
8. `src/lib/membership.ts`
9. `src/lib/session-cache.ts`
10. `src/lib/tiers.ts`
11. `src/lib/whop-checkout.ts`
12. `src/lib/whop.ts`
13. `src/middleware.ts`

### Dependencies opened (logic-dependent)

- `src/app/layout.tsx` — SessionCacheGuard mount
- `src/app/api/membership/sync/route.ts` — sync endpoint auth contract
- `src/app/api/webhook/whop/route.ts` — Whop webhook verification path
- `src/app/api/engine/[...path]/route.ts` — prior CRITICAL fix verification
- `src/lib/market-api-auth.ts` — tier/cron gate helpers
- `src/lib/engine.ts` — credentialed fetch (referenced by engine route)
- `node_modules/@whop/sdk/resources/webhooks.mjs` — unwrap null-key behavior
- `src/hooks/useMergedDesk.ts`, `src/hooks/useSpxPlay.ts` — session cache TTL/consumers (session-leak analysis)

---

## Cleared as not-a-bug

- **`sign-in` / `sign-up` pages** — thin Clerk wrappers; no custom auth logic to bypass.
- **`clerk-theme.ts`** — appearance tokens only; no security surface.
- **`whop-checkout.ts`** — public checkout URLs (`NEXT_PUBLIC_*`); expected to be public.
- **`tiers.ts`** — `parseTier` defaults unknown values to `"free"`; `tierAtLeast` ordering correct.
- **`auth-access.ts`** — `requireAuth` / `requireTier` redirect pattern is sound; tier read from Clerk server metadata.
- **`membership.ts` + `whop.ts`** — tier resolved from live Whop membership lists, not webhook payload fields; deactivation → empty list → `"free"`.
- **`api/membership/sync/route.ts`** — requires `auth()`; uses caller's own primary email only.
- **Whop webhook handler** — signature required when `WHOP_WEBHOOK_SECRET` set; null secret fails closed via SDK throw.
- **Middleware API routes** — intentionally not Clerk-gated; API routes self-authorize (documented cross-batch pattern).
- **Engine route POST** — explicitly disabled (405); closes mutation/SSRF vector from prior audit.

---

## Files NOT read

| File | Reason |
|------|--------|
| `src/lib/api.ts` (full) | Partial read (lines 600–613) for WS-key fix verification only; full file is Batch 02/07 |
| `src/lib/admin-access.ts` | Admin gating; Batch 06 scope |
| `src/components/Nav.tsx` | UI; no auth logic in Batch 01 |
| `src/app/docs/system-analysis/page.tsx` etc. | Frontend docs pages; opened only via grep for tier-gate gap (MED-2) |
| `src/hooks/usePulseStream.ts`, `src/components/desk/*.tsx` | Session cache consumers; partial read for leak analysis |

---

## Summary counts

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 3 |
| LOW | 3 |
| **Total findings** | **6** |

**Files read in full:** 13 (batch) + 8 dependencies = 21 total touched
