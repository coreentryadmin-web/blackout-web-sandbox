# BlackOut — CTO-Level Deep Audit (2026-06-29)

> **Audit-only pass.** No source files changed. Branch `cursor/cto-deep-audit-7635`, cut fresh from
> `origin/main` @ `64395d5`. Every finding cites `file:line` or a route, and was **adversarially
> verified** against current code (not the stale 2026-06-24 `BLACKOUT_FULL_AUDIT.md`, most of whose
> Critical/High items — Clerk/Next CVEs, ticker validation, off-warm-set GEX, dead GEX crons — are
> already RESOLVED on `main` and are explicitly listed under "Verified clean / regressions closed").

## Executive summary

The platform is in materially better shape than the historical master audit implies: the dependency
CVEs are gone (`npm audit` = **0**), the auth/tier model is consistently enforced and fail-closed, SQL
is parameterized, per-user routes are IDOR-safe, and the cache-reader discipline (incl. the previously
"risky" `gex-heatmap` ticker path) is now hardened with input validation + an overlay allowlist.

The dominant *current* risk is **not** architecture — it is a small cluster of **unauthenticated
endpoints that serve premium SPX desk content**, plus one **paid feature that is silently dead in prod
because its writer cron service was never provisioned**. Both are the same failure mode the team has hit
before (`/api/signals/open`, the unprovisioned regime cron) and both are concentrated, not pervasive.

**Overall risk grade: B− (GO with a small must-fix set).** One P0 data-exposure cluster, one P1
degraded-feature, two P2 hardening items. Verification suite is fully green.

### Mandated command results (run, not eyeballed)
| Command | Result |
|---|---|
| `npm install` | ✅ "up to date, 0 to install". Lockfile is functionally **in sync**; a re-run only rewrites benign `libc:["glibc"]` metadata hints (npm-version normalization), no version/tree change. |
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run build` | ✅ exit 0 (Next 15.5.19) |
| `npm test` | ✅ 385/385 pass |
| `npm run lint` | ✅ exit 0 (warnings only: `tailwindcss/enforces-shorthand`, one `jsx-a11y` tablist focus) |
| `npm run lint:brand` | ✅ no grey-family classes |
| `npm run lint:css` | ✅ clean |
| `npm audit` | ✅ **0 vulnerabilities** (historical Clerk GHSA + 14 Next advisories cleared) |

---

## P0 — user-facing breakage / data-integrity / money / data-leak

| # | Title | Evidence (file:line) | Impact & blast radius | Recommended fix | Confidence |
|---|---|---|---|---|---|
| **P0-1** | **Unauthenticated exposure of premium SPX desk content** across three GET routes | `src/app/api/coaching/alerts/route.ts:9-33`; `src/app/api/brief/premarket/route.ts:9-32`; `src/app/api/platform/intel/route.ts:16-199` | All three `GET` handlers run **no** auth (`auth()`/`requireTierApi`/`isCronAuthorized` absent — verified by reading each). They return paid SPX content: `coaching/alerts` → `spxPrice, callWall, putWall, vwap, alert_text, for_longs/for_shorts` (directional coaching); `brief/premarket` → premarket brief `content, spxPrice, callWall, putWall, kingStrike, netGex, gexBias`; `platform/intel` → all of the above **plus** 30-day signal win-rate stats by source/regime **plus** a live `signalRecommendation` ("REDUCE SIZE / NORMAL SIZE …"). `coaching/alerts` is a **live** premium feature (consumed by `src/components/nights-watch/NightsWatchPanel.tsx:1189`) yet world-readable. **This is the exact class as the previously-fixed `/api/signals/open` leak (P1-B).** Blast radius: any anonymous internet client can poll paid SPX levels/coaching/brief/track-stats; competitive scraping + refund/trust risk. | Gate each with `authorizeMarketDeskApi(req)` (premium **or** cron), exactly like sibling desk routes. `platform/intel` is described as cron-internal ("every cron reads this at startup") → at minimum `isCronAuthorized`; better `authorizeCronOrTierApi`. | **High** (code gap is certain) / live severity **Med-High** (depends on writer crons populating the tables — see Requires-operator) |

**Adversarial check performed:** `anomalies`/`regime` GET are *also* unauthenticated but carry explicit
"intentionally public — market-wide, no paid data" annotations (`anomalies/route.ts:1-4`,
`regime/route.ts:1-3`) and return only raw market-wide regime/anomaly rows. The three P0-1 routes have
**no such annotation** and return materially richer premium content (levels, walls, coaching calls,
brief narrative, win-rate stats) — so they are **not** in the documented-public class.

---

## P1 — feature broken or degraded

| # | Title | Evidence | Impact & blast radius | Recommended fix | Confidence |
|---|---|---|---|---|---|
| **P1-1** | **Regime + flow-anomaly writer cron is built but its Railway service is not provisioned** | Route `src/app/api/cron/market-regime-detector/route.ts` + registry `src/lib/cron-registry.ts:217-220` + `railway.market-regime-detector.toml` all exist, **but** the service is absent from the live project. **Live-verified this session** via project-scoped `railway status` for `BlackoutTrades.com`: 22 services, none named `Market-Regime-Detector`. | `market_regime` + `flow_anomalies` are never written → `FlowAnomalyBanner` on the paid `/flows` page never renders, `platform/intel`/`nighthawk-morning-confirm` default `currentRegime="UNKNOWN"`. Violates the "every user-visible value is live/correct/grounded" hard rule (shows blank/UNKNOWN where a live regime should be). | Operator action: create the cron service from the existing `.toml` (Config-as-code) with `CRON_SECRET`; confirm first run writes `market_regime`. **No code change.** | **High** (live-verified) |

---

## P2 — incorrect-but-not-obvious / hardening

| # | Title | Evidence (file:line) | Impact & blast radius | Recommended fix | Confidence |
|---|---|---|---|---|---|
| **P2-1** | **Fail-OPEN cron-write guards** (5 instances, audit listed only 3) | `src/app/api/market/anomalies/route.ts:40`; `src/app/api/market/regime/route.ts:48`; `src/app/api/track-record/publish/route.ts:9`; **`src/app/api/coaching/alerts/route.ts:38`**; **`src/app/api/brief/store/route.ts:9`** | Pattern `if (cronSecret && auth !== \`Bearer ${cronSecret}\`)` short-circuits when `CRON_SECRET` is unset/empty → the POST becomes an **unauthenticated public DB writer** (could inject coaching alerts / briefs / regime / anomalies that feed the desk). Dormant in prod (`CRON_SECRET` set), so defense-in-depth today. The 2 bolded instances are **net-new** vs OPEN-ISSUES P3-3 (which named only 3). | Flip to fail-closed: `if (!cronSecret || auth !== …)`. | **High** |
| **P2-2** | **Options WS off-hours `code=1006` reconnect loop** | `src/lib/ws/options-socket.ts` — `scheduleReconnect()` (~:291) and the pool watchdog's `ensureConnected()` (~:310) are **not** RTH-gated, while the stall watchdog `reconnectIfStalled()` **is** (`:456`, `inOptionsMarketHours`). | Off-hours the server drops the idle socket → reconnect → drop, churning ~every 60s with an unbounded `consecutiveFailures` counter. Benign while market closed (no quotes; marks fall back to REST), **but** masks a genuine RTH failure (Night's Watch live position marks would silently degrade). **Observed live** in `blackout-web` prod logs this session (`connected (2 contracts)` → `reconnect code=1006 failures=23`). | Gate the reconnect/open path on `inOptionsMarketHours` like the stall watchdog; keep RTH behavior identical. (Matches OPEN-ISSUES P2-D — validate at Monday RTH before merging any fix.) | **High** |

---

## P3 — tech debt / quality

| # | Title | Evidence (file:line) | Note | Confidence |
|---|---|---|---|---|
| **P3-1** | `platform/intel` uses untyped `any[]` row casts | `src/app/api/platform/intel/route.ts:76,78,82,84` | Type-safety holes on a route that also shapes the (currently ungated) response. Type the rows. | High |
| **P3-2** | Zero-writer / dead tables (carried, **not** re-verified here) | OPEN-ISSUES P2-B/P3-2: `spx_signal_log`, `spx_pulse_snapshots`, `spx_watch_setups` | Could not confirm row counts without prod DB → **operator-verify**, not asserted. | Low |
| **P3-3** | Build-time lint disabled | `next.config.mjs` (`eslint.ignoreDuringBuilds`) historically true | Confirm whether CI gates the deploy; if not, a lint regression can ship. Carried from historical audit — verify against current CI. | Low |

---

## Crown-jewel: the 5 things most likely RIGHT NOW to lose money or expose paid/private data

1. **`coaching/alerts` GET — world-readable premium SPX coaching.** `src/app/api/coaching/alerts/route.ts:9`. It's a *live* feature (NightsWatchPanel consumes it) returning directional long/short calls + live walls + VWAP with **no auth**. Blast: anonymous scrape of paid desk output. **Highest because it is both live and unauthenticated.**
2. **`platform/intel` GET — world-readable intel aggregate.** `src/app/api/platform/intel/route.ts:16`. Leaks premarket brief levels + 30-day win-rate stats + a live trade-sizing recommendation unauthenticated. Blast: the richest single paid-content endpoint.
3. **`brief/premarket` GET — world-readable premarket brief.** `src/app/api/brief/premarket/route.ts:9`. SPX levels + `kingStrike/netGex/gexBias` + narrative, no auth.
4. **Regime cron unprovisioned → degraded paid features.** `cron-registry.ts:217` + missing Railway service (live-verified). Blast: blank/UNKNOWN regime on the paid `/flows` banner and Night Hawk morning confirm — a trust hit, not a leak.
5. **Fail-open cron-write guards.** `coaching/alerts:38`, `brief/store:9`, `anomalies:40`, `regime:48`, `track-record/publish:9`. Blast: if `CRON_SECRET` is ever unset (deploy/env slip), these become public writers that can inject the very numbers the SPX desk renders — a data-integrity/money-misleading path.

> Honest caveat on #1-3: the **code-level** exposure is certain (routes are unauthenticated). The
> **live** blast radius depends on whether the writer crons are populating `coaching_alerts` /
> `platform_briefs` / `market_regime` in prod right now — see "Requires live/operator verification".

---

## Verified clean (coverage you can trust — actively checked, genuinely fine)

- **Entitlement gating across all 52 routes** in `api/market|grid|signals|account|track-record`: each
  uses `authorizeMarketDeskApi` / `requireTierApi` / `authorizeCronOrTierApi` / `isCronAuthorized` /
  `requireAdminApi`, and **returns on the guard `Response`** (`if (x instanceof Response) return x`).
  Spot-read `spx/desk:10-12`, `account/positions/[id]:38-40,164-166`, `account/personal-alerts:19-21`,
  `gex-heatmap:239-240`.
- **Shared guards are fail-CLOSED.** `market-api-auth.ts`: `isCronAuthorized` returns false when secret
  unset + constant-time `timingSafeEqual` (`:7-16`); `requireTierApi` → 401/403/503, never grants
  (`:26-52`); `resolveUserTier` (`tier-cache.ts:61-79`) **never** returns a default tier on Clerk
  failure (throws `TierUnavailableError` → 503). `admin-access.ts:resolveAdminApi` → 401/403.
- **IDOR-safe.** Per-user queries scope by trusted `auth()` `userId` (`account/positions/[id]` queries
  are `(userId, id)`); personal Discord webhook stored in Clerk `privateMetadata`, never returned
  (only a redacted host) — `account/personal-alerts/route.ts:1-8,32-35`.
- **`/api/signals/open` is now gated** (`isCronAuthorized`) — the historical P1-B leak is closed.
- **SPX option-chain veto is opt-in.** `spx-play-config.ts:417-419` (`playOptionChainRequired()` =
  `flag(env, false)`; `flag` defaults to fallback when unset, `:8-12`). Manage-open exit triggers use
  correct directional signs (`spx-play-engine.ts:190-191`: long `price<=stop` / short `price>=stop`).
- **`gex-heatmap` is a real cache-reader.** Ticker validated `/^[A-Z0-9.\-]{1,8}$/` → 400
  (`:250-252`); UW overlays gated to an allowlist (`isHeatmapOverlayAllowed`, `:212`) + dropped when
  the UW breaker is open (`:213`); matrix served from shared in-memory+Redis cache; `?force=1`
  throttled server-side per-ticker 8s (`:257-266`). The old "off-warm-set / unvalidated ticker"
  Highs are **resolved**.
- **Clerk webhook verifies signatures.** `api/webhook/clerk/route.ts` is a thin re-export of the
  canonical `api/webhooks/clerk` handler (svix-verified).
- **Infra-as-code mostly consistent.** Every cron route has a matching `railway.*.toml` **except**
  `nighthawk-edition`, which is **intentionally** triggered by `railway.nighthawk-playbook.toml`
  (`startCommand … hit-cron.mjs /api/cron/nighthawk-edition`, provisioned live as "NightHawk-Playbook").
  `gex-alerts` + `gex-eod-snapshot` now **have** tomls — the historical "dead GEX crons" High is
  **resolved**.
- **Dependencies:** `npm audit` = 0; the historical Clerk authorization-bypass CVE + 14 Next
  advisories are cleared (Next 15.5.19 / `@clerk/nextjs` ^7.5.8).

## Requires live / operator verification (flagged, not guessed)

- **Live blast radius of P0-1**: are `coaching_alerts`, `platform_briefs` (premarket), and
  `market_regime` actually populated in prod now? (Determines whether the unauthenticated routes leak
  real data today vs. empty `{}`.) Query row counts / latest timestamps in prod.
- **P1-1**: confirm/provision the `Market-Regime-Detector` Railway service (verified absent via
  project-token `railway status` this session).
- **Carried systemic risks from the 2026-06-24 audit not re-verifiable from the repo**: Redis-down
  fail-open cascade behavior, PgBouncer presence + `PG_POOL_MAX`, pinned web `numReplicas` +
  replica-aware `UW_MAX_RPS`, hard AI spend kill-switch, SSE pulse capacity at 500. These need a prod
  load test / config inspection.
- **Real provider rate-limit behavior** and **secret values** — out of scope for a repo audit.

## Method note

Branch rebased on `origin/main` @ `64395d5`. Read: `docs/ONBOARDING.md`,
`.cursor/rules/architecture.mdc`, `docs/api-audit/OPEN-ISSUES.md`, `docs/BLACKOUT_FULL_AUDIT.md`,
`docs/API_INTEGRATION_MAP.md`, `docs/DATA_CORRECTNESS.md`. Ran the full build/test/lint suite + `npm
audit`. Enumerated all `api/*` routes and mapped each to its guard; read the guard implementations and
a sample of handlers; traced the SPX veto + exit-sign math; compared every `railway.*.toml` to its cron
route; and cross-checked claims against a live project-scoped `railway status`. No source files were
modified.
