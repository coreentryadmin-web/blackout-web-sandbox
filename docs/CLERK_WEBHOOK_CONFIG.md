# Clerk Webhook Configuration — blackouttrades.com

> Configured 2026-06-27. Reference this before touching webhook or auth sync settings.

---

## Overview

Clerk fires webhook events (via Svix) to our endpoint whenever users are created, updated, or deleted. We use this to keep a `users` table in Postgres in sync with Clerk — required for per-user features (Night's Watch P&L, position tracking, tier gating).

**Svix has automatic retry with exponential backoff for up to 5 days.** No cron job is needed for reliability — if delivery fails, Svix retries automatically. You can also manually replay from the Clerk dashboard.

---

## Endpoint

| Field | Value |
|---|---|
| Registered URL | `https://blackouttrades.com/api/webhook/clerk` |
| Canonical handler | `src/app/api/webhooks/clerk/route.ts` |
| Alias route | `src/app/api/webhook/clerk/route.ts` (re-exports canonical) |
| Method | POST |
| Auth | Svix signature verification (HMAC-SHA256) |

**Why two routes:** Clerk dashboard registered the singular path (`/api/webhook/clerk`). Our canonical handler lives at the plural path (`/api/webhooks/clerk`). The alias re-exports the handler so both paths work identically. Do not delete either.

---

## Subscribed Events

| Event | What we do |
|---|---|
| `user.created` | INSERT into `users` table (clerk_user_id, email, first_name, last_name) |
| `user.updated` | UPDATE email/name in `users` table |
| `user.deleted` | Currently logged only (no hard delete — preserves position history) |

---

## Environment Variables

| Variable | Where set | Notes |
|---|---|---|
| `CLERK_WEBHOOK_SECRET` | AWS Secrets Manager → blackout-web → Production | `whsec_...` from Clerk dashboard Signing Secret |

To rotate the secret: go to Clerk → Configure → Webhooks → endpoint → Signing Secret → Rotate. Then update AWS Secrets Manager immediately.

---

## Security

- Signature verified on every request using the `svix` npm package
- **Fail-closed on invalid signature** → returns 400 (Svix will retry)
- **Fail-open on DB errors** → returns 200 (prevents Svix from infinite retry on a schema/constraint issue)
- Timestamp tolerance: 5 minutes (Svix default — prevents replay attacks)

---

## Cloudflare Configuration

Svix delivery IPs are data center IPs that Cloudflare's managed WAF would normally block. We added a WAF skip rule:

**Rule:** Skip managed WAF rules for requests to `/api/webhook*`
**Expression:** `(http.request.uri.path contains "/api/webhook")`
**Phase:** `http_request_firewall_custom`
**Reason:** The webhook endpoint is already protected by Svix signature verification — WAF is redundant here and blocks legitimate Svix deliveries.

This is documented in `docs/CLOUDFLARE_CONFIG.md` under Active Rulesets.

---

## Users Table Schema

Auto-migrated on cold boot via `runMigrations()` in `src/lib/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  clerk_user_id     TEXT UNIQUE NOT NULL,
  email             TEXT,
  first_name        TEXT,
  last_name         TEXT,
  whop_user_id      TEXT,
  tier              TEXT DEFAULT 'free',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users(clerk_user_id);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
```

---

## Troubleshooting

### All deliveries failing
1. Check AWS Secrets Manager: `CLERK_WEBHOOK_SECRET` must be set and match the Clerk dashboard signing secret
2. Check the route is deployed: `curl -X POST https://blackouttrades.com/api/webhook/clerk` → should return `400 Missing svix headers` (not 404, not 500)
3. Check Cloudflare WAF skip rule is active (see above)
4. Check ECS logs: `aws logs tail /ecs/blackout-web --follow | grep clerk-webhook`

### 500 errors
- `CLERK_WEBHOOK_SECRET` is not set in AWS Secrets Manager. Set it and redeploy.

### Succeeded but users not appearing in DB
- Check `users` table migration ran: connect to Postgres and `SELECT * FROM users LIMIT 5`
- Check for DB constraint errors in ECS logs

### Need to backfill missed events
1. Go to Clerk → Configure → Developers → Webhooks → click the endpoint
2. Click **Replay** (top right) → **"Recover failed messages since [date]"**
3. Watch ECS logs: `aws logs tail /ecs/blackout-web --follow | grep clerk-webhook`
4. Svix retries failed deliveries automatically for up to 5 days — no manual action needed for recent failures

### Rotating the signing secret
1. Clerk dashboard → Webhooks → endpoint → Signing Secret → Rotate secret
2. Immediately update the secret in AWS Secrets Manager and force a new ECS deployment
3. Old secret stops working on next ECS redeploy (~80s)

---

## Why No Cron

Svix (Clerk's webhook delivery engine) handles reliability automatically:
- **Automatic retry:** exponential backoff, retries for up to 5 days on non-2xx responses
- **Manual replay:** dashboard UI to replay any time range of failures
- **Delivery stats:** visible in the Clerk dashboard per-endpoint

A sync cron would be redundant and create double-write race conditions. If you ever need a one-time reconciliation after a long outage (>5 days), use the Replay feature in the Clerk dashboard.

---

## Maintenance Notes

- **Never proxy Clerk DNS records through Cloudflare** — breaks auth (separate from webhook, but related)
- **If you add new user fields** (e.g. `whop_user_id`, `tier`): add a column via migration in `runMigrations()` AND update the `user.updated` handler to sync those fields
- **If you delete a user in Clerk** and want to cascade-delete their data: add a `user.deleted` handler in `src/app/api/webhooks/clerk/route.ts` — currently logs only
