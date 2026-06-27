# Vercel Migration Plan — blackouttrades.com

Migration of the Next.js app from Railway to Vercel while keeping all backend services on Railway.

---

## Overview

| Component | Stays on Railway | Moves to Vercel |
|-----------|-----------------|-----------------|
| Next.js app (SSR/RSC/API routes) | No | **Yes** |
| Postgres database | **Yes** | No |
| Redis (cache + pub/sub) | **Yes** | No |
| All cron services (blackout-cron clone) | **Yes** | No |
| WebSocket services (UW WS, flow-ingest) | **Yes** | No |
| Static assets (via CDN) | No | **Yes** (Vercel Edge Network) |

---

## 1. What Moves to Vercel

- The entire `blackout-web` Next.js application
- All `/app` routes (pages + API routes)
- Server components, server actions
- Edge middleware (`src/middleware.ts`)
- Static asset serving via Vercel's global CDN

**What does NOT move:**
- Postgres — stays on Railway, accessed via `DATABASE_URL` (the `.railway.internal` private URL won't be reachable from Vercel; use `DATABASE_PUBLIC_URL` or set up Railway's TCP proxy)
- Redis — same issue; use Railway's public TCP proxy URL
- Cron services — Railway crons remain; they call `/api/cron/*` on the Vercel URL
- Any background workers

---

## 2. What Stays on Railway

- `Postgres` service — database
- `Redis` service — caching + pub/sub
- `blackout-cron` service — all cron jobs (they hit the Vercel app URL)
- Any Railway-managed WebSocket/streaming services

> **DB connectivity from Vercel:** Railway's `.railway.internal` private network is only reachable within Railway. From Vercel (external), use:
> - `DATABASE_PUBLIC_URL` (the `thomas.proxy.rlwy.net:27432` TCP proxy) — this is what's already in `.env.local`
> - Set `DATABASE_URL` in Vercel to the `DATABASE_PUBLIC_URL` value

---

## 3. Environment Variables to Copy to Vercel

All values live in Railway service variables + your `.env.local`. Copy **every key** below to Vercel's **Production** environment (Settings → Environment Variables):

### Auth
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`

### Database (use PUBLIC URLs — internal URLs don't work from Vercel)
- `DATABASE_URL` → set to Railway's `DATABASE_PUBLIC_URL` value (`postgresql://...@thomas.proxy.rlwy.net:27432/railway`)
- `DATABASE_PUBLIC_URL` → same value

### Redis (use public proxy URL)
- `REDIS_URL` → set to Railway's Redis public proxy URL

### Market Data APIs
- `POLYGON_API_KEY`
- `POLYGON_TEST_KEY`
- `UW_API_KEY`
- `POLYGON_API_BASE` (if set)

### App Config
- `NEXT_PUBLIC_SITE_URL` → `https://blackouttrades.com`
- `CRON_SECRET`
- `LAUNCHED_TOOLS` (if set)

### Push / VAPID
- `VAPID_PRIVATE_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_SUBJECT`
- `GEX_ALERTS_PUSH`

### Optional / AI
- `ANTHROPIC_API_KEY` (if set)
- `DAILY_AI_SPEND_KILL_USD` (if armed)

### Do NOT copy
- `RAILWAY_TOKEN` — Railway-specific, not needed on Vercel
- `RAILWAY_*` auto-injected vars — Railway injects these; set what's needed explicitly on Vercel

---

## 4. vercel.json Config

See `vercel.json` at the repo root (created alongside this doc). Key settings:

```json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "src/app/api/**/*.ts": { "maxDuration": 30 }
  },
  "headers": [...],
  "rewrites": [...]
}
```

- **Region `iad1`** (US East, N. Virginia) — collocated with Railway's US East infra, minimizes DB latency.
- **Function timeout 30s** — covers Largo AI calls; adjust per-route if needed (max 300s on Pro).
- All cron routes (`/api/cron/*`) should have `maxDuration: 60` (they do long DB work).

---

## 5. Custom Domain Setup (blackouttrades.com on Vercel)

### Step 1 — Add domain to Vercel
1. Vercel dashboard → your project → **Settings → Domains**.
2. Add `blackouttrades.com` and `www.blackouttrades.com`.
3. Vercel shows you either an A record IP or a CNAME.

### Step 2 — Update Cloudflare DNS (if using Cloudflare)
If Cloudflare is already set up (recommended — do Cloudflare first):
- Set the A/CNAME for `@` and `www` to Vercel's provided values.
- Keep Cloudflare proxy **on** (orange cloud) for CDN + WAF.
- Cloudflare → Vercel → Railway DB/Redis.

### Step 3 — SSL
- Vercel auto-provisions a Let's Encrypt cert.
- If Cloudflare proxy is on, set Cloudflare SSL mode to **Full (strict)** (Vercel's cert is valid).

### Step 4 — Update NEXT_PUBLIC_SITE_URL
Set `NEXT_PUBLIC_SITE_URL=https://blackouttrades.com` in Vercel env.

### Step 5 — Update Clerk Allowed Origins
In Clerk dashboard → your app → **Domains**: ensure `blackouttrades.com` and `www.blackouttrades.com` are listed.

### Step 6 — Update Railway cron target URL
If your cron jobs hard-code the Railway app URL (e.g. `blackouttrades.up.railway.app`), update `SITE_URL` / `CRON_TARGET_URL` in the Railway cron service env to `https://blackouttrades.com`.

---

## 6. Railway DB Access from Vercel

The critical change: Vercel cannot reach `postgres.railway.internal`. Use the public proxy:

```
DATABASE_URL=postgresql://postgres:<PASSWORD>@thomas.proxy.rlwy.net:27432/railway
```

This is already in your `.env.local` as `DATABASE_PUBLIC_URL`. The app's `src/lib/db.ts` reads `DATABASE_URL` — set it to the public proxy value in Vercel.

**SSL note:** Railway's TCP proxy requires SSL. Ensure `pg` connection config has `ssl: { rejectUnauthorized: false }` or pass `?sslmode=require` in the URL. Check `src/lib/db.ts` for existing SSL config.

---

## 7. Estimated Migration Time & Risk

| Phase | Time | Risk |
|-------|------|------|
| Deploy to Vercel (staging URL) | 30 min | Low — no DNS change |
| Smoke test all API routes on staging | 1–2 hrs | Low |
| DB connectivity fix (public proxy URL) | 15 min | Low |
| Switch DNS (Cloudflare → Vercel) | 5 min + TTL propagation | **Medium** — brief DNS flap |
| Validate crons still hit correct URL | 15 min | Low |
| Total | ~3–4 hours | **Medium overall** |

**Biggest risks:**
1. `DATABASE_URL` using internal Railway hostname → easy fix, swap to public proxy URL.
2. Redis URL using `.railway.internal` → same fix.
3. Cron services calling old Railway app URL → update `SITE_URL` in cron service env.
4. Cold start latency on Vercel Hobby (no reserved instances) — upgrade to Vercel Pro for always-warm functions if needed.

**Rollback:** DNS TTL is low; switching back to Railway takes < 5 min.

---

## 8. Vercel-Specific Optimizations Available Post-Migration

- **Fluid compute** (Vercel Pro) — streaming response support, better for SSE endpoints.
- **Edge Config** — ultra-low-latency feature flags (replace current `LAUNCHED_TOOLS` env var).
- **Vercel Analytics** — Core Web Vitals per-route.
- **Vercel Speed Insights** — real user monitoring.
- **Incremental Static Regeneration (ISR)** — for semi-static pages like `/` landing.
