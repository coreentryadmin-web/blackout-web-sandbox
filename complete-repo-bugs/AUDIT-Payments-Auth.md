# Audit — Payments & Auth + Security

Method: every file below read in full; dependencies opened and verified.

---

## 🔴 CRITICAL 1 — Unauthenticated credentialed proxy to internal engine

**File:** `src/app/api/engine/[...path]/route.ts` (entire file, lines 6–47)
**Dependency:** `src/lib/engine.ts:18` (`fetchEngine`)

**Bug:** The route has **zero authentication**. `GET`/`POST` forward an
attacker-controlled path (`path.join("/")`), query string, and raw POST body to
the internal engine. `fetchEngine` then **attaches the server's secret**:
```
src/lib/engine.ts:20  const url = `${ENGINE_BASE}${path}${sep}key=${ENGINE_KEY}`;
src/lib/engine.ts:26  headers: { "X-Blackout-Key": ENGINE_KEY, ... }
```
where `ENGINE_KEY = process.env.DASHBOARD_API_SECRET`.

**How it fails in production:** Any anonymous internet user can call
`GET /api/engine/<anything>?<anything>` or `POST /api/engine/<anything>` and the
server proxies it to the engine **using your privileged engine credentials**.
This is public → fully-credentialed engine access:
- Reads any engine data (premium SPX signals, plays, internal state) — paywall bypass.
- If the engine has any mutating/admin endpoints, the public can invoke them.
- Unlimited public calls = your engine load + downstream API costs (DoS/cost vector).

**Fix:** Gate the route before proxying. At minimum require a signed-in premium
user (or admin), and ideally an allowlist of permitted engine sub-paths so it
can't proxy arbitrary endpoints:
```ts
const gate = await authorizeMarketDeskApi(req); // from lib/market-api-auth
if (gate instanceof Response) return gate;
// + validate `path[0]` against an allowlist of safe read-only engine routes
```

**Test case:** Unauthenticated `curl -X POST $SITE/api/engine/whatever` must
return 401, not proxy. Authenticated non-premium → 403. Premium → only allowlisted
paths succeed.

---

## 🔴 HIGH 2 — Engine WebSocket key shipped to the browser

**File:** `src/lib/api.ts:616` — `const key = process.env.NEXT_PUBLIC_ENGINE_WS_KEY ?? "";`
**Also:** `NEXT_PUBLIC_ENGINE_WS_URL`

**Bug:** `NEXT_PUBLIC_*` env vars are inlined into the client JS bundle. The engine
WebSocket key is therefore **public** — anyone can view-source / read the bundle,
extract the key, and connect directly to `NEXT_PUBLIC_ENGINE_WS_URL`.

**How it fails:** If that WS streams the premium market data users pay for (SPX
pulse, flow, signals) or accepts commands, this is a **paywall bypass / data
exfiltration** — a free user (or non-user) gets the premium real-time feed.

**Fix:** Don't authenticate the browser→engine WS with a static shared key.
Issue a short-lived per-user token from a server route (after a premium check)
that the WS server validates, or proxy the WS through the Next server behind
`authorizeMarketDeskApi`. Remove the `NEXT_PUBLIC_` key.

**Test case:** Confirm the premium WS rejects a connection using only public
bundle values once a real user isn't entitled.

---

## 🟠 MEDIUM 3 — Whop webhook accepts unsigned payloads if secret unset

**File:** `src/app/api/webhook/whop/route.ts:8` —
`webhookKey: process.env.WHOP_WEBHOOK_SECRET ?? null`

**Bug:** If `WHOP_WEBHOOK_SECRET` is unset in prod, `webhookKey` is `null`. Depending
on SDK behavior, `whop.webhooks.unwrap` may then **skip signature verification**,
so a forged `membership.activated` POST for any email would be processed.

**Mitigation already present:** the handler re-syncs entitlement from Whop as the
source of truth (`syncWhopMembershipForEmail`), so a forged event can't directly
grant premium unless the email genuinely has a paid membership. Impact is therefore
limited to forced re-syncs / load, not direct entitlement grants. Still, verify.

**Fix:** Fail closed — if `WHOP_WEBHOOK_SECRET` is missing, return 500 and refuse
to process, rather than passing `null`.

**Test case:** With secret unset, an unsigned POST must be rejected.

---

## 🟡 LOW 4 — Cron secret accepted via query string

**Files:** `lib/market-api-auth.ts:9`, `api/cron/flow-ingest/route.ts:9`
`const q = req.nextUrl.searchParams.get("secret")`

**Bug:** Cron secret can be passed as `?secret=...`. Query strings land in access
logs, proxies, and browser history — a leak vector for a long-lived shared secret.
Comparison is also non-constant-time (`=== secret`), though network jitter makes
timing attacks impractical.

**Fix:** Accept the secret via `Authorization` header only; drop the query param.

---

## ✅ Checked & CLEARED (not bugs)

- `lib/membership.ts` — `syncWhopMembershipForEmail` resolves tier from real Whop
  memberships (source of truth), not webhook payload. Deactivation →
  `resolveTierFromMemberships([])` → `"free"` (whop.ts:71): downgrade works.
- `api/membership/sync/route.ts` — requires `auth()`, uses the caller's OWN primary
  email only; cannot grant self premium (Whop is source of truth). Safe.
- `lib/admin-access.ts` — `requireAdmin` (pages, redirects) and `requireAdminApi`
  (401/403) both enforce role==admin OR email allowlist. `admin/me` via
  `getAdminStatus` returns only the caller's own status; no leak. Solid.
- `lib/market-api-auth.ts` — `requireTierApi` checks userId + tier from Clerk
  metadata; cron path via shared secret. Sound.
- `middleware.ts` — Clerk protects page routes; API routes self-authorize (verified
  in API-Routes batch). Intentional, acceptable.
- `.gitignore` — covers `.env.local` / `.env*.local`. (Verify `.env.local` was never
  committed historically; a bare `.env` would NOT be ignored — add it.)
- Whop tier resolution is fail-closed: if `WHOP_*_PRODUCT_IDS`/`PLAN_IDS` are unset,
  everyone resolves to `free` (locks out paying users rather than leaking premium).
  Business-config risk, not a security bug. Note: `past_due` and `canceling` statuses
  grant premium (intentional grace period — confirm that's desired).

## Files read in full
middleware.ts, lib/auth-access.ts, lib/admin-access.ts, lib/market-api-auth.ts,
lib/membership.ts, lib/whop.ts, lib/engine.ts, api/webhook/whop/route.ts,
api/membership/sync/route.ts, api/cron/flow-ingest/route.ts,
api/engine/[...path]/route.ts, api/admin/me/route.ts.

## Not yet read in this batch
lib/whop-checkout.ts, lib/tiers.ts (parseTier/tierAtLeast — referenced, behavior
inferred but not line-read), api/checkout/* (if present). Queue for follow-up.
