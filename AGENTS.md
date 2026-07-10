# AGENTS.md

## Cursor Cloud specific instructions

**This repo (`blackout-web-sandbox`, branch `blackout-web-sandbox`) is the AWS staging app.**

### Branch policy (standing — user 2026-07-10)

**Never touch `main`.** Do not push, merge, open PRs to, checkout for commits, or deploy from
`main` in this repo or `coreentryadmin-web/blackout-web`. All agent work lands on
**`blackout-web-sandbox`** only → ECS staging. Prod/Railway `main` changes require an explicit
user request in that session.

Do not merge staging experiments to `coreentryadmin-web/blackout-web` `main` (Railway prod) unless
explicitly requested. Staging deploys via `.github/workflows/ecr-push-staging.yml` → ECR `:staging` →
ECS `blackout-staging-web` at `https://staging.blackouttrades.com`.

BLACKOUT (`blackout-web`) is a single **Next.js 15 (App Router) / TypeScript** app with an iOS
Capacitor shell at **`apps/blackout-ios/`** (one repo — no separate `blackout-ios` GitHub repo).
The ~20 `railway.*.toml` files at the repo root are production cron *trigger* services that just call
`/api/cron/*`; they are not separate apps and are not needed locally. Commands live in `package.json`
(`dev`, `build`, `start`, `test`, `lint`, `lint:brand`, `lint:css`) and CI is `.github/workflows/ci.yml`.

### BIE Live Desk AI (replaces Claude on `/api/market/spx/commentary`)

- **Deterministic brief** via `composeSpxDeskBrief()` — SIGNALS, DEALERS (GEX/VEX/DEX/CHARM), WALLS, CHART, NIGHT HAWK, cross-tool ENGINE/LOTTO/POWER HOUR, material **INTEL edges** (same `spx-odte-intel-feed` as Playbook terminal), Voyage precedent, UW **CROSSCHK**.
- **Unified data plane** `loadBiePlatformContext()` (`src/lib/bie/platform-context.ts`) — one parallel fan-out across SPX desk, matrix intel, Night Hawk (RDS), HELIX tape, market-regime snapshot, play-engine cross-state, and `bie_knowledge` retrieval (Voyage embeddings in RDS). BIE does **not** open raw Redis/SQL; it uses the same platform service readers dashboards and Largo tools use (those readers already sit on ElastiCache + RDS).
- **Intel loader** `loadSpxBriefIntel()` reads shared `getGexPositioning("SPX")` + heatmap cache + NH edition diffs (zero extra UW RPS). Commentary cache stores `positioning` + `heatmapSlice` + `nighthawk` per 5-min window for matrix/NH diffs.
- **Staging:** `claudeEnabled()` false on `staging.*` unless `STAGING_CLAUDE=1` — Largo routes SPX asks through BIE first. `classifyBieStagingFallback()` + market-context last resort so Largo never hard-errors on staging.
- **Kill Claude spend path:** SPX commentary + play approval + flow-brief + GEX explain + Largo router hits are BIE-first. Remaining Claude: Largo fallback (non-SPX reasoning), NH edition synthesis, play critic/explainer, Haiku follow-ups.
- **Staging proof:** `npm run validate:staging-bie` — probes commentary (THESIS), flow-brief, gex-explain, Largo (`source=blackout-intelligence`); does not touch prod.
- **Synthesis layer** `synthesizeSpxDeskIntel()` — THESIS, MECHANIC (γ/vanna/δ/charm), ALIGNMENT (engine/NH/lotto vs read), FRICTION (opposing factors), watch triggers. SPX-scoped "why" questions route to `spx_desk_read` instead of Claude.
- **Latency:** `getCachedBiePlatformContext()` (8s desk / 20s market SWR) + Largo answer cache (12s) + commentary 5-min shared window. Cold path parallelizes desk/matrix/cross; Voyage precedent capped at 1.5s (optional).

### Running / building
- Dev server: `npm run dev` → http://localhost:3000 (Next.js dev, hot reload). This is the only service.
- **SPX Slayer left rail:** `SpxGexMatrixHeatmap` — SPX **0DTE matrix** from `/api/market/gex-heatmap?ticker=SPX`, **GEX/VEX lens toggles**, live spot row in the ladder. Poll **8s RTH / 20s off-hours**; server cache **`SPX_GEX_HEATMAP_CACHE_SEC`** default **8** (other tickers stay `GEX_HEATMAP_CACHE_SEC` **20**). Bootstrap seeds matrix SWR via `/api/market/spx/bootstrap`.
- **Live Desk AI + play approval (BIE, no Claude):** `POST /api/market/spx/commentary` composes via `src/lib/bie/spx-desk-brief.ts` (desk + `computeSpxConfluence`, optional Voyage precedents). Right-rail play gate uses `findSimilarPrecedents` in `spx-play-claude.ts` — **zero Anthropic** on these SPX paths; Largo Terminal remains the only Claude surface.
- **Staging = BIE-only by default:** `src/lib/ai-env.ts` — when `NEXT_PUBLIC_SITE_URL` contains `staging.`, `claudeEnabled()` is false and `anthropicText` / `anthropicToolLoop` no-op. Largo still works via BIE router (`spx_desk_read`, `spx_structure`, `market_context`, etc.). Override with `STAGING_CLAUDE=1` for A/B tests.
- **BlackOut Thermal (`/heatmap`):** full `GexHeatmap.tsx` matrix shares **`src/lib/gex-heatmap-display.ts`** cell format/color scale with the SPX rail (GEX/VEX/DEX/CHARM lenses). Both surfaces read `cross_validation` from `/api/market/gex-heatmap` when preset tickers diverge from UW.
- The WebSocket market-data managers are **not** a separate process — they boot lazily inside the Node
  server on the first `/api/market/*` request (`src/lib/ws/init-data-sockets.ts`).
- Blocking CI checks are `npx tsc --noEmit` and `npm run lint:brand`. `npm run lint` (ESLint/jsx-a11y)
  and `npm run lint:css` (stylelint) are **non-blocking** in CI (they emit warnings, `continue-on-error`).
- Tests: `npm test` (`node --test` via `tsx`, files `src/**/*.test.ts`). No DB/env needed for tests.

### iOS app (Capacitor shell)
- **Location:** `apps/blackout-ios/` — loads `https://blackouttrades.com` in WKWebView; `appendUserAgent: BlackOutiOSApp`.
- **Web detection:** `src/app/layout.tsx` adds `html.ios-app`; CSS hides in-app pricing (App Store 3.1.1).
- **Validate config:** `npm run validate:ios-config`
- **Cloud build:** root `codemagic.yaml` → connect **`coreentryadmin-web/blackout-web`** in Codemagic, workflow **`ios-release`**.
- **Setup:** `apps/blackout-ios/APP_STORE.md` (Apple ID `6787797476`, bundle `com.blackout-trades.app`).
- **Mobile UI E2E (Playwright):** `npm run test:ios-ui-e2e` — iPhone viewport + `BlackOutiOSApp` UA, Clerk temp-user auth, clicks every bottom tab + primary segment/control, screenshots → `/opt/cursor/artifacts/ios-ui-e2e/`. Requires `CLERK_SECRET_KEY` + publishable key. Static guards: `npm run validate:ios-mobile-desk`. Full native chrome (`ios-native-shell`) is validated once PR #557 is deployed.

### Ops auto-fix (cron/errors → agent)
- **`npm run ops:collect`** — scan prod Postgres + live watchdog; JSON action items (exit 1 if any).
- **`.github/workflows/ops-auto-fix.yml`** — every 20 min + on audit failures → GitHub issue (`ops-auto-fix` label) + Cursor Cloud Agent.
- Runbook: `docs/ops/OPS-AUTO-FIX.md`. Cloud agents: fix action items before other work; do not ask the user.

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
- **Gotcha — keyless mode only applies when NO Clerk keys are set.** If this cloud environment has
  **production** Clerk keys injected as secrets (`CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  present in env), `@clerk/nextjs` uses them and they are **domain-locked to `blackouttrades.com`** —
  localhost sign-in then fails hard (`"Production Keys are only allowed for domain on the requesting
  URL"`, and protected pages 404/redirect to `accounts.blackouttrades.com`). There are no dev keys, so
  **you cannot render an authed/premium page on localhost in that case.** To test authed/premium/
  launch-gated UI (e.g. `/nighthawk`), test **against production**: mint a one-time Clerk `sign_in_token`
  via the Backend API for a user whose `public_metadata` is `{ "role": "admin", "tier": "premium" }`
  (`role:"admin"` bypasses per-tool launch gates; `tier` drives `requireTierApi`), open
  `https://blackouttrades.com/sign-in?__clerk_ticket=<token>`, then **DELETE the test user afterward**
  (`DELETE /v1/users/{id}`) — it is a real user on the prod Clerk instance.

### Staging auth (Clerk satellite — ECS)
- **Staging uses production Clerk keys** on `staging.blackouttrades.com` → must run as a **satellite**
  of `blackouttrades.com` (not just `allowedRedirectOrigins`). Config lives in `src/lib/clerk-env.ts`.
- Clerk Dashboard: `staging.blackouttrades.com` is registered as satellite with FAPI **proxy**
  `https://staging.blackouttrades.com/__clerk` (no separate `clerk.staging` CNAME required).
- Staging build bakes `NEXT_PUBLIC_CLERK_IS_SATELLITE=true`, `NEXT_PUBLIC_CLERK_PROXY_URL`, and absolute
  primary sign-in/sign-up URLs (`https://blackouttrades.com/sign-in`). Middleware enables `frontendApiProxy`.
- **Primary prod app** (`blackout-web` on Railway) must set `allowedRedirectOrigins` including staging so
  post-auth redirect back to staging works (`clerkAllowedRedirectOrigins()` in prod `layout.tsx`).
- OAuth / new sign-ups complete on **primary** (`blackouttrades.com`) then sync back to staging; embedded
  `/sign-in` on staging still renders for identifier entry but satellite handshake uses the proxy path.

### Premium tool launch gate (LAUNCHED_TOOLS)
- Non-admin premium users only see tools where `isToolLaunched()` is true (SPX Slayer + HELIX by default;
  others need `LAUNCHED_TOOLS=heatmap,nighthawk,largo,grid` on Railway `blackout-web`).
- **Check without Railway:** `/admin` → **Tool launch status** panel, or `GET /api/admin/launch-status`
  (admin-gated). Same snapshot is on `GET /api/admin/health` as `launch_status`.
- **Ops guardrails (no secret values):** `/admin` → Operations → **System Vitals** shows
  `ops_config` from `GET /api/admin/health`: AI kill-switch armed?, Discord webhooks set?,
  PgBouncer/pooler hint from `DATABASE_URL` host. Arming `DAILY_AI_SPEND_KILL_USD` and enabling
  PgBouncer remain manual Railway steps — the dashboard only reports posture.

### Railway (Cursor Cloud agents)
- **Tokens:** Account-wide token → `RAILWAY_API_TOKEN` (buckets, `environment edit`, multi-region).
  Project token → `RAILWAY_TOKEN` + `RAILWAY_PROJECT_ID` for variables/redeploy/logs.
  If both are set and `RAILWAY_API_TOKEN` is invalid, the CLI fails — **`unset RAILWAY_API_TOKEN`**
  before project-scoped ops, or fix the account token in Cursor secrets.
- **One-shot audit setup:** `npm run railway:audit-apply` (`scripts/railway-audit-apply.mjs`) — regions,
  all cron TOMLs, internal `CRON_TARGET_BASE_URL`, `CRON_WATCHDOG_SELF_HEAL`, CRON_SECRET sync.
- **Manifest check:** `npm run validate:railway-crons` — registry ↔ TOML ↔ Railway service map (23 jobs).
- **GHA:** `railway-audit-apply.yml` (Sun 06:00 UTC + TOML push), `cron-audit-query.yml` (hourly RTH).
- Production: `blackout-web` **iad=3, us-west2=2**; **PgBouncer iad=2, us-west2=1** (colocated with Postgres/web);
  healthcheck **`/api/ready`** (90s); crons → `CRON_TARGET_BASE_URL=http://blackout-web.railway.internal:8080`.
- **Postgres PITR:** bucket `Postgres-PITR`; restore drill runbook `docs/ops/PITR-RESTORE-DRILL.md`.
- **23 crons** incl. `Socket-Health-Cron` → `/api/cron/socket-health` (`railway.socket-health.toml`) and `Market-Regime-Detector` → `/api/cron/market-regime-detector` (`railway.market-regime-detector.toml`). If the regime detector service is missing in Railway, run `node scripts/railway-ops-provision.mjs` (also bootstraps `provider-health-reconcile`).
- PgBouncer: **session mode** (not transaction) — see `docs/PGBOUNCER-SETUP.md`.
- **Still manual:** set `DISCORD_OPS_WEBHOOK_URL` / `DISCORD_PLAY_WEBHOOK_URL` on `blackout-web` for ops alerts.
- `railway scale` may return Unauthorized on project tokens — patch via `environment edit` `deploy.multiRegionConfig`.

### UW WebSocket → cache / HELIX (2 RPS budget)
- Multiplex channels in `src/lib/live-api-integrations.ts` (`UW_WS_CHANNELS`). Ticker-scoped joins:
  `option_trades:SPX,SPY`, `lit_trades:SPY`, `net_flow:SPX,SPY,QQQ,IWM` (override via
  `UW_WS_*_TICKERS` env vars).
- High-premium `option_trades` prints persist to HELIX via `persistAndPublishFlowAlert` (same path as
  `flow_alerts`).
- `uw-ws-cache-bridge.ts` seeds Redis from WS stores; `uw-cache-refresh` cron skips REST tasks when the
  matching channel is fresh (`market_tide`, `net_flow`, `option_trades`).

### Massive LULD halt feed (second source vs UW `trading_halts`)
- Opt-in: set `STOCKS_WS_ENABLED=1` (or `LULD_WS_ENABLED=1`) on Railway. Uses the same
  `POLYGON_API_KEY` / `MASSIVE_API_KEY` as indices/options.
- Subscribes to `LULD.SPY` by default (`LULD_WS_TICKERS` override). SPY LULD halts proxy to SPX/SPXW
  play gates via `LULD_INDEX_PROXIES` in `live-api-integrations.ts`.
- Halt feed considered stale only when **both** UW and LULD are down (when LULD is enabled). Admin:
  Operations → **Massive LULD** tile; cron `GET /api/cron/socket-health` includes `stocks_luld`.

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

### Postgres (staging RDS — prod snapshot + live ingest)
- Staging RDS holds a **point-in-time Postgres copy** from Railway prod (see `blackout-infra/scripts/migrate-railway-postgres-to-staging-rds.mjs`). Re-sync weekly or before big tests.
- **New live data** (UW flows, SPX plays, etc.) lands on staging independently via the same WS + crons — not streamed from prod. Staging uses **`UW_MAX_RPS=1`** and narrowed `UW_WS_*_TICKERS` so prod keeps the UW budget.
- `PG_STATEMENT_TIMEOUT_MS=0` required for RDS Proxy (`apply-staging-env-overrides.mjs` in blackout-infra).

### Staging validation commands
| Command | When |
|---------|------|
| `npm run validate:staging` | Full harness (warm, deploy, latency) |
| `npm run validate:staging-bie` | BIE-only intelligence layer (commentary, Largo, flow-brief, gex-explain) |
| `npm run validate:staging-rth` | Weekday RTH — sockets, flow-ingest, spx/play |
| `npm run validate:staging-live` | Cron + Clerk admin/member probes |
| `npm run validate:latency-compare` | Staging vs prod latency |
| `npm run ops:collect:staging` | Staging ops action items (no Railway) |
| `npm run validate:staging-vector-e2e` | Vector Playwright against staging |

Set `STAGING_VALIDATE_BROWSER=1` on `validate:staging` to include browser paint checks. GHA: `staging-validate.yml`, `staging-rth-check.yml` (weekdays).

After `ecr-push-staging.yml` merges to `blackout-web-sandbox`, roll ECS so tasks pick up `:staging`:
`aws ecs update-service --cluster blackout-staging-cluster --service blackout-staging-web --force-new-deployment`

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

### Merge policy (standing — user 2026-07-10)

**Never merge to `main`.** Open PRs only to **`blackout-web-sandbox`**. After CI is green, auto-merge
into `blackout-web-sandbox` (not `main`). Workflow:

1. Branch (`fix/*` or `cursor/*`) → commit → push → open PR to **`blackout-web-sandbox`**
2. Run local verification (tsc/test as applicable)
3. Enable auto-merge into `blackout-web-sandbox`: `gh pr merge <n> --auto --squash --delete-branch`
4. Poll ECS staging deploy → `npm run validate:staging` (or `validate:staging-bie`)

Do not ask the user for merge approval on staging. Do **not** enable auto-merge to `main`.

Full policy + exceptions: **`CLAUDE.md`** § Merge authorization (staging-only unless user overrides).

### Autonomous RTH resume (Cloud Agent — do NOT wait for user)

**User preference:** continue at market open without being asked. Never prompt for permission.

On **every weekday** Cloud Agent session when **America/New_York ≥ 09:00**:

1. Read and execute `docs/ops/RTH-OPEN-RUNBOOK.md` **before** other work.
2. Run `npm run validate:rth-open` (wraps `validate:deploy` + RTH session checks).
3. If anything fails → fix → branch → PR → **auto-merge to `blackout-web-sandbox` once CI is green**
   → poll ECS staging deploy → re-run until GREEN. **Do not merge or push to `main`.**
4. After **09:35 ET**, confirm `spx-evaluate` cron + options-socket `authenticated` in Railway logs.

**Cursor scheduled task (recommended):** Mon–Fri **09:32 AM ET** — prompt: *Run RTH-OPEN-RUNBOOK autonomously; npm run validate:rth-open; fix failures; do not ask me.*

**SPX all-day agent (matrix + trade alerts + every button + cross-tool):** see **`docs/ops/SPX-RTH-ALL-DAY-AGENT.md`**. Auto-starts **6:30 AM PT** weekdays. Runs **`npm run validate:spx-rth`** + **`npm run validate:spx-e2e`**. Post-close fix **~1:05 PM PT**. Workflow: **`.github/workflows/spx-rth-all-day-agent.yml`**.

Off-hours / weekends: RTH script skips automatically; still run `npm run validate:staging` after
pushes to `blackout-web-sandbox` (not `main`).
