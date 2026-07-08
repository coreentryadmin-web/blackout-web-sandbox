# Staging / platform performance — RTH session notes

Living analysis for making BlackOut faster (code, AWS, Cloudflare). Updated during RTH monitoring.

## Executive summary

**The app is fast at the API layer** (warm paths 25–60ms on staging). **Perceived slowness is front-end weight**: monolithic CSS, Clerk on every page, client-heavy landing, and staging-specific cache policy.

---

## Layer 1 — Cloudflare (highest ROI, low code risk)

| Issue | Impact | Fix |
|-------|--------|-----|
| Rule #1 caches `/_next/static` 1y; stale HTML after deploy → 404 chunks | Broken UI on staging | ✅ PR #19: staging `no-store` on HTML; allow edge cache on `/_next/*` |
| **Manual gap**: no hostname bypass for `staging.blackouttrades.com` | Repeat deploy pain | **Dashboard**: Cache Rule → Bypass cache when `host eq staging.blackouttrades.com` for `/_next/static` mismatch window OR rely on auto-purge (`CF_PURGE_DEPLOY_ID`) |
| Prod HTML not edge-cached aggressively | OK on prod | Keep; staging intentionally `no-store` on documents |
| **Argo Smart Routing** (optional) | -10–30% TTFB globally | Enable on Cloudflare for `blackouttrades.com` + staging subdomain |
| **Polish / Mirage** (images) | Hero LCP | Enable image optimization at CF for `/_next/image` on staging |

---

## Layer 2 — AWS staging topology

| Issue | Impact | Fix |
|-------|--------|-----|
| ECS Fargate 3 tasks, single region | OK for staging | Consider **2 tasks + warmer** off-hours to cut cost; keep 3 RTH |
| RDS in VPC — no public path | Can't audit Postgres from VM | ✅ cron API fallback; use staleness-watchdog + in-VPC compare |
| **No CloudFront in front of ALB** | TLS at CF → ALB → ECS; extra hop | Optional: CloudFront origin = ALB with cache policies per path |
| ElastiCache Redis colocated | Good | Ensure `cache.t4g.small` enough RTH; watch `evicted_keys` |
| EventBridge → Lambda → ECS crons | 27 rules, 440 invocations/2h at open | ✅ staleness-watchdog reports 0 problems |
| **UW_MAX_RPS=1** on staging | Slower cold GEX/flows vs prod | Intentional; prod keeps budget |

---

## Layer 3 — JavaScript (biggest user-facing win)

| Source | Size on `/` | Action |
|--------|-------------|--------|
| Clerk (`clerk-js` + `ui`) | **~415 KB** | **Defer to auth + (site) routes only** — marketing layout without ClerkProvider |
| Shared React chunks | ~590 KB | Unavoidable baseline; shrink with less client components |
| BIE hero (`BieBrainBanner`) | ~150 KB | Static SVG/video OR lazy below fold |
| Framer Motion | ~80 KB | CSS animations on marketing |
| Root layout: SWR, Onboarding, PWA, iOS hooks | ~50 KB | Mount only on `(site)` |
| Next Link prefetch to `/dashboard`, `/flows` | ~50 KB leaked chunks | `prefetch={false}` on marketing footer |

**Target landing:** 400–500 KB JS (from 1.2 MB today).

---

## Layer 4 — CSS (13,800-line `globals.css`)

| Issue | Impact | Action |
|-------|--------|--------|
| Single compiled ~464 KB chunk | Every page loads desk+admin+tool CSS | Split **`marketing.css`** + **`desk.css`**; import desk only in `(site)/layout` |
| 12 `ios-native-*.css` on all pages | ~100 KB source | ✅ moved to `(site)` only (PR #19) |
| Tool-specific tailwind in one `@layer` | Can't tree-shake custom CSS | Extract `.flow-*`, `.spx-*`, `.admin-*` blocks to route CSS modules over time |

**Wrong first move:** 6 separate CSS files per tool. **Right first move:** marketing vs desk split (~300 KB saved on `/`).

---

## Layer 5 — Next.js / code patterns

| Pattern | Fix |
|---------|-----|
| `ClerkProvider dynamic` on root | Split layouts: marketing static, app dynamic |
| `force-static` landing under heavy `(site)` shell | ✅ `(marketing)` route group (PR #19) |
| RSC prefetch storm on tool links | `prefetch={false}` + `TOOL_LINK_PREFETCH = false` already on Nav |
| Image optimizer cold path (hero 650ms staging) | Pre-generate hero WebP at build; `priority` + fixed `sizes` |
| WebSocket lazy init | Already lazy on first `/api/market/*` — good |
| `maxDuration` on slow crons | data-correctness ~7s — ensure Lambda timeout ≥ 30s |

---

## Layer 6 — Monitoring (this session)

- `staging-cron-watch.mjs` — staleness watchdog every 3 min
- `staging-continuous-monitor.mjs` — live probes every 5 min
- EventBridge: **27 rules**, Lambda **440 invocations / 2h**, **1 error** (transient)
- Staleness snapshot at open: **0 problems, 0 RTH stale**

---

## Recommended execution order

1. **Merge PR #19** (cache + lean landing + monitors)
2. **Phase A perf** (1–2 days): Clerk deferral, marketing/desk CSS split, prefetch off
3. **Cloudflare dashboard**: staging cache bypass rule OR confirm auto-purge on deploy
4. **Phase B** (optional remodel): static marketing shell, sub-second LCP

---

## Session log

| Time (ET) | Cron watch | Notes |
|-----------|------------|-------|
| 09:31 | 27/27 staleness GREEN | Live 50/50; cold latency at bell expected |
| 09:39 | Full audit 25/27* | *data-correctness + largo-cleanup false FAIL on burst audit (Lambda); direct invoke 200 OK |
