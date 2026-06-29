# AGENTS.md

## Cursor Cloud specific instructions

BLACKOUT (`blackout-web`) is a single **Next.js 15 (App Router) / TypeScript** app — not a monorepo.
The ~20 `railway.*.toml` files at the repo root are production cron *trigger* services that just call
`/api/cron/*`; they are not separate apps and are not needed locally. Commands live in `package.json`
(`dev`, `build`, `start`, `test`, `lint`, `lint:brand`, `lint:css`) and CI is `.github/workflows/ci.yml`.

### Running / building
- Dev server: `npm run dev` → http://localhost:3000 (Next.js dev, hot reload). This is the only service.
- The WebSocket market-data managers are **not** a separate process — they boot lazily inside the Node
  server on the first `/api/market/*` request (`src/lib/ws/init-data-sockets.ts`).
- Blocking CI checks are `npx tsc --noEmit` and `npm run lint:brand`. `npm run lint` (ESLint/jsx-a11y)
  and `npm run lint:css` (stylelint) are **non-blocking** in CI (they emit warnings, `continue-on-error`).
- Tests: `npm test` (`node --test` via `tsx`, files `src/**/*.test.ts`). No DB/env needed for tests.

### Local environment / secrets
- The app **degrades gracefully** with no env vars: the landing page, `/sign-in`, `/sign-up`,
  `/track-record`, and `/api/health` all work, and every external integration (Postgres, Redis,
  Unusual Whales, Massive/Polygon, Anthropic, Whop, Discord, Sentry, web-push) is guarded and inert
  when its key is absent. There is no `.env.example`.
- Put local config in `.env.local` (gitignored). Next.js auto-loads it.

### Auth (Clerk) — no real keys needed locally
- With no Clerk keys set, `@clerk/nextjs` runs in **keyless development mode**: on first run it
  provisions a temporary dev instance and writes keys to a local `.clerk/` dir (gitignored — do not
  commit it). Full sign-up / sign-in works locally without any secret.
- To sign up in dev, use a Clerk **test email** (any address containing `+clerk_test`, e.g.
  `you+clerk_test@example.com`) and the dev verification code **`424242`** — this bypasses real email.
- The `users` table is populated **only** by the Clerk webhook (`/api/webhooks/clerk`), which does not
  fire in keyless mode, so the table stays empty after a local sign-up even though the Clerk session is
  fully authenticated. This is expected, not a bug.
- Free-tier authenticated users are intentionally redirected from `/dashboard` to `/upgrade` (tier
  gating via Whop). Premium tools (`/flows`, `/terminal`, `/heatmap`, `/nighthawk`) require both a
  paid tier and market-data API keys (`UW_API_KEY`, `POLYGON_API_KEY`/`MASSIVE_API_KEY`), so they
  cannot be fully exercised locally without those third-party keys.

### Production edge (Cloudflare) — security headers / CSP are NOT served from `next.config.mjs`
- Production is fronted by **Cloudflare**, and the security **response headers are delivered by a
  Cloudflare Transform Rule** ("Add security headers to all responses") in the
  `http_response_headers_transform` ruleset — **not** by the `headers()` block in `next.config.mjs`.
  Editing CSP / HSTS / X-Frame-Options etc. in `next.config.mjs` has **no effect in production**
  (the live values differ from the code: e.g. the CF rule sets `X-XSS-Protection`, which isn't in
  the code at all, and HSTS at 1y vs the code's 2y).
- The `Content-Security-Policy` specifically is served by a **separate** Transform Rule (scoped to
  non-`/embed` paths) whose value mirrors `baseCsp` in `next.config.mjs`. To change prod security
  headers, edit the Cloudflare Transform Rules (dash: Rules → Transform Rules → Modify Response
  Header, or the Rulesets API) — keep the code's `baseCsp` in sync as the source of truth for the value.

### Postgres (optional, for persistence testing)
- The app runs fine without a DB (`/api/health` returns `db: "skipped"`). Postgres is only needed to
  exercise persistence (flows, SPX plays, nighthawk, positions, telemetry, etc.).
- There is **no migration command** — the schema is auto-created via `ensureSchema()` on the first
  `dbQuery()` (e.g. hitting `GET /api/track-record` creates all ~20 tables).
- A local Postgres 16 cluster is available in the VM. Start it and point the app at it:
  - `sudo pg_ctlcluster 16 main start`
  - In `.env.local`: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/blackout` and
    `DATABASE_SSL=0` (SSL auto-disables for localhost anyway). The `blackout` DB and `postgres`
    password were created during setup.

### Autonomous RTH resume (Cloud Agent — do NOT wait for user)

**User preference:** continue at market open without being asked. Never prompt for permission.

On **every weekday** Cloud Agent session when **America/New_York ≥ 09:00**:

1. Read and execute `docs/ops/RTH-OPEN-RUNBOOK.md` **before** other work.
2. Run `npm run validate:rth-open` (wraps `validate:deploy` + RTH session checks).
3. If anything fails → fix → commit → push → poll Railway deploy → re-run until GREEN.
4. After **09:35 ET**, confirm `spx-evaluate` cron + options-socket `authenticated` in Railway logs.

**Cursor scheduled task (recommended):** Mon–Fri **09:32 AM ET** — prompt: *Run RTH-OPEN-RUNBOOK autonomously; npm run validate:rth-open; fix failures; do not ask me.*

Off-hours / weekends: RTH script skips automatically; still run `npm run validate:deploy` after pushes to `main`.
