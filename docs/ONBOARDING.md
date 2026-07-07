# BlackOut Platform — Engineering Onboarding & Architecture Map

> **Audience:** any engineer or AI assistant (Cursor, Claude) coming to this codebase fresh.
> **Goal:** understand the whole system — product, code, data, APIs, infra — and know *where to
> look* and *what to look for* before touching anything.
> **Repo root:** `blackout-platform/blackout-web` (this is canonical — `BO-AAI/` and any root
> `blackout-web/` are **stale duplicates, never edit them**).
> Live site: **https://www.blackouttrades.com**

---

## 0. Read this first — the five rules that override everything

These are hard guardrails. Violating them breaks production, trust, or the brand.

1. **NEVER disclose the tech stack on any public surface.** Marketing pages, in-app copy, API
   responses, page metadata, error messages — none may name the data providers, databases, hosting,
   AI vendor, or auth/billing vendors. Say *what a feature does*, not *how it's built*. (Internal
   docs like this one are fine to be fully technical.)
2. **Every value must be live, correct, and grounded.** No hardcoded, mocked, fabricated, or
   hallucinated numbers anywhere a user can see them. Every price/level/stat is dynamic,
   auto-updating, and verifiable against the live source of truth. If you can't ground it, don't
   show it — show an honest empty/stale state instead.
3. **No grey text.** `text-grey-*`, `text-zinc-*`, `text-neutral-*` are banned — on the near-black
   background (`#040407`) they're unreadable. Use `text-cyan-400` / `text-sky-300` / `text-white`.
4. **Institutional design bar.** Benchmark against Bloomberg/TradingView/Stripe/Linear, not Discord.
   No military copy, fake LIVE badges, text-glow on prices, scanlines, or emoji padlocks. See
   [DESIGN_BENCHMARK.md](../DESIGN_BENCHMARK.md) and `.cursor/rules/institutional-design.mdc`.
5. **Default to commit + push to `main`.** Railway auto-deploys `main`. Branch only for
   deploy-risky work, and say why. Every push restarts the build (~80s deploy lag).

---

## 1. What BlackOut is

A real-time options-trading intelligence platform for index (SPX) and equity traders. It surfaces
institutional-grade positioning, flow, and AI analysis that retail traders normally can't see. The
product is a set of **tools** (each gated by subscription tier):

| Tool | What it does | Primary code |
|---|---|---|
| **SPX Slayer** (the "desk") | Live SPX 0DTE trade desk — confluence scoring, AI-approved play entries, levels, signals | `src/components/desk/`, `src/lib/spx-play-engine.ts` |
| **HELIX Flows** | Real-time options order-flow tape (unusual/large premium sweeps & blocks) | `src/lib/flow-*.ts`, `src/lib/ws/uw-socket.ts` |
| **Heat Maps** | GEX/VEX/DEX/CHARM dealer-positioning heatmaps (gamma walls, flip points) | `src/components/desk/GexHeatmap.tsx`, `src/lib/providers/gex-*.ts` |
| **Night Hawk** | Evening swing-play scanner — generates a nightly "edition" of ranked plays | `src/lib/nighthawk/` (38 files) |
| **Night's Watch** | Per-user options *position manager* — tracks & values open positions live | `src/lib/nights-watch/`, `src/components/nights-watch/` |
| **Largo** | AI analyst (chat/tool-using agent) grounded in all the platform's live data | `src/lib/largo/` (12 files) |
| **0DTE Command** | Always-on multi-ticker 0DTE scanner (tab on Night Hawk) | `src/lib/zerodte/`, `api/market/zerodte/board`, `api/cron/zerodte-warm` |
| **Vector** | SPX structure chart with GEX/VEX walls and session replay | `src/features/vector/`, `api/market/vector/*` |

---

## 2. Tech stack (internal only — see Rule #1)

- **Framework:** Next.js 15.5 (App Router) + React 18 + TypeScript 5, Tailwind 3.4.
- **Auth:** Clerk (`@clerk/nextjs` 7.5). Webhooks via `svix`.
- **Billing/entitlements:** Whop.
- **Database:** PostgreSQL (`pg` 8.21) on Railway.
- **Cache / pub-sub / live snapshots:** Redis (`ioredis` 5.11) on Railway.
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`) — model defaults to latest Claude (Opus/Sonnet).
- **Realtime data:** WebSockets (`ws` 8.18) to market-data providers.
- **Hosting/CI:** Railway (auto-deploy on `main` push), 5 replicas (iad×3, US-West×2).
- **Edge/CDN:** Cloudflare (marketing pages force-static + edge-cached, auto-purge on deploy).
- **Data providers:** a flow/options-positioning provider + a market-data/options-chain provider.
  GEX walls come 100% from the options-chain provider's chain (no fallback). See
  [API_INTEGRATION_MAP.md](API_INTEGRATION_MAP.md) and [BLACKOUT_API_REFERENCE.md](BLACKOUT_API_REFERENCE.md).

---

## 3. Repo geography — where everything lives

```
blackout-web/
├── src/
│   ├── middleware.ts            # Clerk auth + route protection (look here for "why am I 401")
│   ├── app/
│   │   ├── (site)/              # ALL user-facing pages (route group, shared shell)
│   │   │   ├── layout.tsx       # ← the REAL app shell (NOT PlatformShell.tsx — that's DEAD)
│   │   │   ├── dashboard/  flows/  heatmap/  nighthawk/  terminal/  vector/
│   │   │   ├── track-record/  upgrade/  admin/
│   │   │   └── learn/           # interactive docs per tool (getting-started, glossary, …)
│   │   ├── api/                 # ~120 route handlers (see §5)
│   │   ├── layout.tsx           # root layout
│   │   └── globals.css
│   ├── components/              # React UI, grouped by tool (desk/ spx/ nighthawk/ vector/ …)
│   │   └── ui/                  # shared primitives (FreshnessChip lives here)
│   └── lib/                     # ALL business logic — the brain of the platform (see §4)
├── docs/                        # single source of truth for all docs (see §14)
│   └── api-audit/               # autonomous auditor output + OPEN-ISSUES.md
├── scripts/                     # cron workers, doc generators, brand linter
├── railway.<service>.toml       # one file per background/cron service (see §10)
├── .cursor/rules/               # Cursor AI rules (auto-loaded)
├── next.config.mjs              # headers, redirects, image config
└── DESIGN_BENCHMARK.md          # the UI bar
```

**`src/lib/` is where the real work is.** Key files & subdirs:

| Path | Responsibility |
|---|---|
| `db.ts` | Postgres pool (note the idle-error handler at `:113` — do not remove) + query helpers |
| `make-redis.ts` | Redis client factory (`family:0` IPv6 fix + reconnect — do not remove) |
| `spx-play-engine.ts` | The SPX desk decision engine — confluence → AI approval → open/evaluate play |
| `spx-play-config.ts` | All SPX desk tunables (env-overridable flags & thresholds) |
| `middleware.ts` (in `app/`) | Auth gating |
| `market-api-auth.ts`, `tool-access.ts`, `tool-access-server.ts` | Tier/launch gating (see §8) |
| `membership.ts`, `whop-checkout.ts`, `tier-cache.ts` | Billing & entitlements |
| `providers/` (38) | Every external data source adapter (`polygon.ts`, `unusual-whales.ts`, `gex-positioning.ts`, `spx-desk.ts`, rate limiters, cross-validation) |
| `ws/` (12) | WebSocket clients & leader-election (`polygon-socket.ts`, `uw-socket.ts`, `options-socket.ts`, `init-data-sockets.ts`) |
| `nighthawk/` (38) | Night Hawk scanner, scorer, edition generation, grounding |
| `nights-watch/` (12) | Position manager valuation & context |
| `largo/` (12) | AI analyst agent + tools |
| `correctness/` (11) | The data-correctness verifiers (the auto-auditor's engine) |
| `flow-*.ts` | HELIX flow ingest, dedup, fanout, freshness, liveness |
| `api-telemetry*.ts`, `api-tracked-fetch.ts` | Provider call tracking & rate quotas |
| `admin-*.ts` | The admin dashboard's data layer |

---

## 4. THE core mental model — the data pipeline

Almost every bug and every new feature touches this flow. Internalize it:

```
  External providers (REST + WebSocket)
            │   (rate-limited; ONE WS per key via Redis leader election)
            ▼
  WRITERS:  ws/*-socket.ts  +  cron jobs (api/cron/*)
            │   write live snapshots & rows
            ▼
  STORE:    Redis (hot snapshots, e.g. spx:pulse:snapshot)  +  Postgres (durable rows/outcomes)
            │
            ▼
  READERS:  api/market/*  →  these are CACHE-READERS, not provider-callers
            │
            ▼
  UI:       components/* fetch the reader APIs, render with FreshnessChip for live state
```

### 4a. The cache-reader rule (the single most important scaling rule)
Per-user / per-request endpoints must **read from the shared cache** (Redis snapshot written by a WS
leader or a cron), **never call the upstream provider directly per request**. The flow/positioning
provider is rate-limited to ~2 requests/sec *cluster-wide*; if N replicas × M users each hit it,
you red-line the provider and break the whole platform. Pattern: a **single** WS leader (Redis SETNX
lock, e.g. `polygon:indices:leader`, see `ws/polygon-socket.ts:117`) or a cron warms the cache;
everyone else reads it. When you add a feature that needs live data, wire it to the existing
cache-reader, don't add a new provider call. See [reference: API limits & scaling] in the codebase
notes and `src/lib/providers/*-rate-limiter.ts`.

### 4b. GEX is single-sourced
Gamma walls (call wall / put wall / flip) come **100%** from the options-chain provider's chain —
there is no second path. Consume positioning anywhere via `getGexPositioning()` /
`/api/market/gex-positioning` (contract in [HEATMAP_DATA_CONTRACT.md](HEATMAP_DATA_CONTRACT.md)).
Don't add a parallel GEX computation — converge on the shared reader.

---

## 5. API surface map (`src/app/api/`)

~120 route handlers. By group:

| Group | Routes | What's there |
|---|---|---|
| `market/` | 34+ | The live data readers — `spx/pulse`, `spx/desk`, `spx/signals`, `flows`, `gex-positioning`, `gex-heatmap`, `nighthawk/edition`, `zerodte/board`, `vector/*`, `news`, `dark-pool`, `regime`, `indices`, `quote`, `largo` |
| `cron/` | 21 | Background jobs (see §10) — hit by Railway cron services via Bearer `CRON_SECRET` |
| `admin/` | 20 | Admin dashboard data (health, cron-health, spx-analytics, route-errors, incidents) — admin-gated |
| `account/` | 5 | User account |
| `signals/` | 3 | SPX signal feed |
| `webhook(s)/` | 3 | Clerk webhooks (`webhooks/clerk` is canonical; `webhook/clerk` re-exports it) |
| `track-record/`, `push/`, `engine/`, `brief/` | 2 each | Outcomes, web-push, engine control, daily brief |
| `health/`, `ready/`, `platform/`, `nighthawk/`, `membership/`, `docs/`, `public/`, `coaching/` | 1 each | misc |

**Watch for:** real route paths are nested — e.g. SPX pulse is `/api/market/spx/pulse` (NOT
`/api/market/spx-pulse`), flows is `/api/market/flows` (NOT `/api/flows`). Several older audit
scripts use stale paths; trust the directory tree.

---

## 6. The tools in depth — where to look per tool

### SPX Slayer / the desk
- Engine: `src/features/spx/lib/spx-play-engine.ts` (entry decision = confluence score + AI approval on the index).
  Plays open with an **index-plan fallback ticket** even when the option chain is thin — the chain is
  a sizing aid, not a gate. The "require chain" veto is **opt-in** via `SPX_OPTION_CHAIN_REQUIRED`
  (default false — leave it unset in prod or plays stop opening).
- Config/tunables: `src/features/spx/lib/spx-play-config.ts`.
- Data: `src/features/spx/lib/spx-desk.ts`, shared `src/lib/providers/spx-session.ts`, `gamma-desk.ts`.
- UI + hooks: `src/features/spx/` (components, lib, hooks colocated).
- Outcomes/track record: `api/market/spx/outcomes`, `api/track-record/`, `correctness/track-record-verifier.ts`.

### HELIX Flows
- Ingest: `src/lib/ws/uw-socket.ts` (WS) + `api/cron/flow-ingest` + `providers/flow-ingest.ts`.
- Processing: `flow-dedup.ts`, `flow-fanout.ts`, `flow-events.ts`, `flow-liveness.ts`, `flow-data-freshness.ts`.
- Reader: `api/market/flows`. UI: `src/features/helix/` (`/flows`).

### Heat Maps (GEX)
- Source: `providers/gex-positioning.ts`, `polygon-options-gex.ts`, `gex-intraday-adjust.ts`, `gex-cross-validation.ts`.
- Reader: `api/market/gex-positioning`, `api/market/gex-heatmap`. Contract: [HEATMAP_DATA_CONTRACT.md](HEATMAP_DATA_CONTRACT.md).
- UI: `src/features/thermal/` (`/heatmap`).

### Night Hawk
- Logic: `src/features/nighthawk/lib/` (scanner, scorer, positioning, grounding). Edition generation runs via `api/cron/nighthawk-edition`.
- Crons: `nighthawk-edition` (generate), `nighthawk-morning-confirm`, `nighthawk-outcomes`.
- Reader: `api/market/nighthawk/edition`. Grounding rules: [NIGHTHAWK_GROUNDING.md](NIGHTHAWK_GROUNDING.md).
- UI: `src/features/nighthawk/components/`. **0DTE Command** (always-on scanner tab) shares the Night Hawk page — reader: `api/market/zerodte/board`, warm cron: `zerodte-warm`.

### Night's Watch
- Logic: `src/lib/nights-watch/` (position-context, position-detail, valuation). Cron: `nights-watch-warm`.
- UI: `src/components/nights-watch/`. Doc: [NIGHTS_WATCH.md](NIGHTS_WATCH.md).
- **Valuation must be a cache-reader** to scale per-user — see §4a.

### Largo (AI analyst)
- Agent + tools: `src/lib/largo/`. Provider: `providers/polygon-largo.ts`, `anthropic.ts`.
- UI shell: `src/features/largo/` (`/terminal`).
- Spend guardrails: `ai-spend-ledger.ts`, `ai-spend.ts` (cross-replica ledger; kill-switch is opt-in
  via `DAILY_AI_SPEND_KILL_USD`).

### Vector
- Chart + replay: `src/features/vector/` (components + lib colocated).
- Readers: `api/market/vector/*`. Launch-gated like Largo (`LAUNCHED_TOOLS=vector`).

---

## 7. Auth, tiers & launch gating

- **Authentication:** Clerk, enforced in `src/middleware.ts`. Unauthenticated hits to protected
  data routes return **401** (this is correct, not a bug).
- **Entitlements:** Whop subscription → tier. `membership.ts`, `tier-cache.ts`, `whop-checkout.ts`.
- **Tool/tier gating:** `tool-access.ts` / `tool-access-server.ts` / `market-api-auth.ts`. Use the
  existing `require*Api` helpers in new routes — every data route must be gated.
- **Launch gating:** tools can be hidden behind "Launching Soon" via the `LAUNCHED_TOOLS` env
  (additive CSV); admins bypass. SPX Slayer + HELIX are live; others may be gated. Logic in
  `tool-access.ts`. Note: internal consumers should call the *function* (e.g. `getGexPositioning()`),
  not the gated HTTP route.
- **Admin:** `admin-access.ts` / `requireAdminApi`. Admin is role-based (not Clerk Organizations,
  which are deliberately off — this is B2C).
- **User provisioning:** Clerk `user.created` webhook → upsert into `users` table
  (`api/webhooks/clerk/route.ts:50`).

---

## 8. Background jobs / crons

21 cron route handlers in `api/cron/`, each triggered by a Railway cron **service** defined by a
`railway.<name>.toml` at repo root. Auth is **Bearer `CRON_SECRET`**. The dispatcher/registry is
`cron-dispatch.ts` / `cron-registry.ts`; health is tracked (`admin-cron-health.ts`) and watched by
`cron-staleness-watchdog`.

Key jobs: `spx-evaluate` (desk heartbeat), `spx-signal-observe`, `flow-ingest`, `gex-eod-snapshot`,
`heatmap-warm`, `zerodte-warm`, `nighthawk-edition`, `nights-watch-warm`, `market-regime-detector`,
`data-correctness` (the auto-auditor), `data-integrity`, `uw-cache-refresh`, `membership-reconcile`,
`db-cleanup`.

**Gotcha:** a cron only runs if its Railway *service* is actually provisioned. A `.toml` + route
existing is not enough — the service must be added in Railway. (E.g. `market-regime-detector` has
been seen with code present but service unprovisioned → its writer never runs.) Verify with
`railway status`, not just the file tree.

---

## 9. Infrastructure & deploy flow

- **Railway**, project `BlackoutTrades.com`, `production` env, service `blackout-web`, 5 replicas.
- **Deploy:** push to `main` → Railway auto-builds (~80s lag) → each push restarts the build. Poll
  the homepage chunk hash to confirm a new deploy actually went live (stale deploys cause false
  "bug" alarms).
- **Cloudflare** in front: marketing pages are force-static + edge-cached (~2h), auto-purged on
  deploy via `cf-purge-on-deploy.ts` (needs `CF_API_TOKEN` + `CF_ZONE_ID`). Don't force SSL Strict;
  Rocket Loader / Bot Fight are off on purpose. See [CLOUDFLARE_CONFIG.md](CLOUDFLARE_CONFIG.md).
- **Prod access from a dev machine:** Railway CLI + a project `RAILWAY_TOKEN` in `.env.local`.
  `railway status`, `railway variables --json` (names only — never print values),
  `railway logs --tail N`. Postgres/Redis reachable via the **public** proxy URL
  (`DATABASE_PUBLIC_URL`); `.railway.internal` is not reachable locally.
- **Env vars that must exist in prod:** `UW_API_KEY`, `POLYGON_API_KEY` (+`POLYGON_API_BASE`),
  `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `DATABASE_URL`,
  `REDIS_URL`, `VAPID_PRIVATE_KEY`, `CF_API_TOKEN`/`CF_ZONE_ID`. (Note: the UW key is `UW_API_KEY`,
  not `UNUSUAL_WHALES_API_KEY`.)

---

## 10. Data-correctness system (how the platform polices itself)

- `src/lib/correctness/` (11 verifiers) powers `api/cron/data-correctness`, which audits **every
  numeric surface** each RTH cycle (8 verifiers, honest "confirmed vs consistency" model). See
  [DATA_CORRECTNESS.md](DATA_CORRECTNESS.md).
- A separate autonomous **chief-auditor** scheduled task runs every 4h and writes
  `docs/api-audit/deep-audit-*.md` + maintains `docs/api-audit/OPEN-ISSUES.md` (the master list of
  unfixed findings — **read this first to see current known problems**).

---

## 11. WHERE TO LOOK — quick lookup

| I want to… | Look here |
|---|---|
| Understand current known bugs | `docs/api-audit/OPEN-ISSUES.md` |
| Change how an SPX play opens/scores | `src/lib/spx-play-engine.ts` + `spx-play-config.ts` |
| Fix "endpoint returns 401" | `src/middleware.ts` + `market-api-auth.ts`/`tool-access.ts` (likely correct auth-gating) |
| Add/repair a data feed | `src/lib/providers/<source>.ts` + the matching `ws/*-socket.ts` |
| Make a feature live for users | wire it to the **cache-reader** (`api/market/*`), respect §4a |
| Touch GEX/walls | `providers/gex-positioning.ts` + `getGexPositioning()` (single source) |
| Change the app shell/nav | `src/app/(site)/layout.tsx` (NOT `PlatformShell.tsx` — dead) |
| Add a cron | new `api/cron/<x>` route + `railway.<x>.toml` + **provision the Railway service** |
| Debug a slow/red deploy | `railway status` (deploy layer) before app logs; check lockfile sync |
| Gate a tool behind launch | `tool-access.ts` + `LAUNCHED_TOOLS` env |
| Change UI without breaking the bar | `DESIGN_BENCHMARK.md` + `.cursor/rules/institutional-design.mdc` + use `FreshnessChip` |
| Find DB/Redis client setup | `src/lib/db.ts` / `src/lib/make-redis.ts` (don't remove the error handlers) |
| See all API integrations | `docs/API_INTEGRATION_MAP.md`, `docs/BLACKOUT_API_REFERENCE.md` |
| Full system audit | `docs/BLACKOUT_FULL_AUDIT.md` |

---

## 12. Known gotchas (will bite you)

- **`PlatformShell.tsx` is DEAD** — the real shell is `src/app/(site)/layout.tsx`.
- **Stale duplicate trees** — only edit `blackout-platform/blackout-web`; ignore `BO-AAI/` and any
  root `blackout-web/`.
- **Lockfile desync red-lines EVERY service** — a `package.json`/`package-lock.json` mismatch fails
  `npm ci` on every Railway service at once (app + crons). Fix by `npm install` to re-sync, not by
  reverting. Triage the deploy layer first.
- **A cron `.toml` ≠ a running cron** — the Railway service must be provisioned (see §8).
- **next/og `ImageResponse` CSS is restricted** — no two-length radial sizes, no Fragments; these
  500 at runtime but pass the build. See `reference: Satori/OG limits` in codebase notes.
- **Redis is IPv6-internal** — `family:0` in `make-redis.ts` is required; removing it causes
  ETIMEDOUT fail-open cascades.
- **Real endpoint paths are nested** (`/api/market/spx/pulse`, not `/api/market/spx-pulse`).

---

## 13. Running locally

```bash
npm install            # re-syncs lockfile if needed
npm run dev            # next dev
npm run build          # production build (catches most issues)
npx tsc --noEmit       # typecheck (should be 0 errors)
npm test               # tsx --test src/**/*.test.ts
npm run lint:brand     # brand/tech-stack-disclosure linter (scripts/check-brand.mjs)
```
You need a `.env.local` with provider keys, Clerk keys, `DATABASE_URL`/`REDIS_URL` (or the public
Railway proxy URLs), and `RAILWAY_TOKEN` for prod inspection. Never commit secrets.

---

## 14. The docs index (`docs/`)

Single source of truth — don't scatter `.md` elsewhere.

- **Architecture/integration:** `API_INTEGRATION_MAP.md`, `BLACKOUT_API_REFERENCE.md`, `BLACKOUT_FULL_AUDIT.md`
- **Per-tool:** `HEATMAP_DATA_CONTRACT.md`, `NIGHTHAWK_GROUNDING.md`, `NIGHTS_WATCH.md`, `NIGHT_HAWK_AUDIT_*.md`
- **Data integrity:** `DATA_CORRECTNESS.md`
- **Infra:** `CLOUDFLARE_CONFIG.md`/`CLOUDFLARE_SETUP.md`, `CLERK_WEBHOOK_CONFIG.md`, `PGBOUNCER-SETUP.md`, `SDLC_AUTOMATION_PLAN.md`
- **Live health:** `docs/api-audit/OPEN-ISSUES.md` (current findings), `docs/api-audit/deep-audit-*.md`

---

*Keep this file current. When you add a tool, a provider, a cron, or change the data flow, update
the relevant section here so the next engineer (or AI) onboards from truth, not memory.*
