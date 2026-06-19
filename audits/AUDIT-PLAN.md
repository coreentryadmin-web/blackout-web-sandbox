# Blackout Web — End-to-End Forensic Audit Plan

> **Scope:** 100% of tracked repo files (`git ls-files`). Each file belongs to exactly one batch.
> **Generated:** 2026-06-19 · **Total files:** 367

## How to use

1. Work batches in order (or parallelize independent batches).
2. Check off each batch when its forensic audit is complete.
3. Record findings in `audits/batch-XX-findings.md` (create per batch as you go).
4. Cross-batch dependencies (e.g. API routes calling lib code) — note in findings, audit the implementation in the owning batch.

## Coverage confirmation

- [x] All 367 tracked files assigned
- [x] No duplicate assignments
- [x] No unclassified leftovers

## Batch checklist

- [ ] **Batch 01 — Payments, Auth & Membership** (13 files)
- [ ] **Batch 02 — Market Data Providers & WebSockets** (31 files)
- [ ] **Batch 03 — API Routes** (43 files)
- [ ] **Batch 04 — Night Hawk Engine & UI** (41 files)
- [ ] **Batch 05 — Largo AI & Terminal** (17 files)
- [ ] **Batch 06 — SPX Desk, Play Engine & Lotto** (65 files)
- [ ] **Batch 07 — Admin, Telemetry & Cron Ops** (34 files)
- [ ] **Batch 08 — Data Layer, Cache & Platform Services** (14 files)
- [ ] **Batch 09 — Frontend — App Shell, Landing & General Pages** (35 files)
- [ ] **Batch 10 — Frontend — Embeds & Market Widgets** (8 files)
- [ ] **Batch 11 — Internal Docs Site** (41 files)
- [ ] **Batch 12 — Config, Deploy, Scripts & Static Assets** (26 files)

## Subsystem map (quick reference)

| Subsystem | Batch(es) | Notes |
|-----------|-----------|-------|
| Payments & Auth | 01 | Clerk + Whop; no Stripe in repo |
| Market Data Providers | 02 | Polygon, UW, WS; **Finnhub removed** (no files) |
| API Routes | 03 | All `src/app/api/**`; thin handlers — audit logic in owning lib batch |
| Night Hawk | 04 | `lib/nighthawk` + UI + worker; API routes in 03 |
| Largo AI | 05 | `lib/largo`, Anthropic provider, terminal UI |
| SPX Desk + Play Engine | 06 | Largest batch; admin SPX surfaces in 07 |
| Admin & Ops | 07 | Dashboards, telemetry, cron registry |
| Data / Platform | 08 | `db.ts`, Redis, caches, platform services |
| Frontend (general) | 09, 10 | Pages/shell vs shared embed widgets |
| Internal docs | 11 | In-app provider/API reference site |
| Config & deploy | 12 | Railway, Next config, public assets, scripts |

## Cross-batch audit rules

When a route in **Batch 03** imports from `lib/nighthawk`, `lib/largo`, `lib/spx-*`, etc.:
- Audit the **HTTP contract** (auth, params, errors, caching) in Batch 03.
- Audit **business logic** in the owning lib/UI batch.

**Batch 01** middleware may gate routes audited in 03 — verify tier checks in both places.

**Batch 02** provider modules are consumed by 04, 05, 06, 08 — note integration bugs in findings, fix in the implementation batch.

## Audit tooling (not in `git ls-files` yet)

| File | Batch | Purpose |
|------|-------|---------|
| `scripts/build-audit-plan.mjs` | 12 | Regenerates this plan from `git ls-files` |
| `audits/AUDIT-PLAN.md` | — | This checklist (meta) |

Regenerate after file moves: `node scripts/build-audit-plan.mjs`

## Leftover / unclassified files

**None.** All 367 tracked files are assigned to exactly one batch above.

**Removed from codebase (not applicable):** `src/lib/providers/finnhub.ts` and Finnhub env vars — already deleted; no audit batch needed.

---

## Batch 01 — Payments, Auth & Membership

**Focus:** Clerk auth, Whop webhooks/checkout, VIP tiers, membership sync, session cache, middleware gating

**File count:** 13

### Files

- `src/app/sign-in/[[...sign-in]]/page.tsx`
- `src/app/sign-up/[[...sign-up]]/page.tsx`
- `src/app/upgrade/page.tsx`
- `src/components/SessionCacheGuard.tsx`
- `src/components/SyncMembershipButton.tsx`
- `src/lib/auth-access.ts`
- `src/lib/clerk-theme.ts`
- `src/lib/membership.ts`
- `src/lib/session-cache.ts`
- `src/lib/tiers.ts`
- `src/lib/whop-checkout.ts`
- `src/lib/whop.ts`
- `src/middleware.ts`

## Batch 02 — Market Data Providers & WebSockets

**Focus:** Polygon, Unusual Whales, flow ingest, GEX/gamma, SPX provider adapters, WS stores, rate limits, provider probe scripts

**File count:** 31

### Files

- `scripts/probe-polygon-ws.mjs`
- `scripts/probe-polygon.mjs`
- `scripts/probe-uw-multiplex.mjs`
- `scripts/probe-uw-ws-auth.mjs`
- `scripts/probe-uw-ws-urls.mjs`
- `src/lib/api-provider-catalog.ts`
- `src/lib/api-rate-quotas.ts`
- `src/lib/greek-exposure-summary.ts`
- `src/lib/group-greek-flow-summary.ts`
- `src/lib/live-api-integrations.ts`
- `src/lib/market-internals.ts`
- `src/lib/providers/config.ts`
- `src/lib/providers/flow-ingest.ts`
- `src/lib/providers/gamma-desk.ts`
- `src/lib/providers/gap-proxy.ts`
- `src/lib/providers/macro-events.ts`
- `src/lib/providers/polygon-largo.ts`
- `src/lib/providers/polygon-options-gex.ts`
- `src/lib/providers/polygon.ts`
- `src/lib/providers/provider-policy.ts`
- `src/lib/providers/spx-commentary.ts`
- `src/lib/providers/spx-desk.ts`
- `src/lib/providers/spx-session.ts`
- `src/lib/providers/spx-signal-log.ts`
- `src/lib/providers/unusual-whales.ts`
- `src/lib/providers/uw-rate-limiter.ts`
- `src/lib/providers/web-search.ts`
- `src/lib/vix-term-utils.ts`
- `src/lib/ws/init-data-sockets.ts`
- `src/lib/ws/polygon-socket.ts`
- `src/lib/ws/uw-socket.ts`

## Batch 03 — API Routes

**Focus:** All HTTP handlers under src/app/api (admin, cron, market, engine, webhooks, membership)

**File count:** 43

### Files

- `src/app/api/admin/analytics/spx/route.ts`
- `src/app/api/admin/apis/dashboard/route.ts`
- `src/app/api/admin/apis/events/[id]/route.ts`
- `src/app/api/admin/apis/rescan/route.ts`
- `src/app/api/admin/apis/stream/route.ts`
- `src/app/api/admin/cron-health/route.ts`
- `src/app/api/admin/health/route.ts`
- `src/app/api/admin/incidents/route.ts`
- `src/app/api/admin/me/route.ts`
- `src/app/api/admin/nighthawk/analytics/route.ts`
- `src/app/api/admin/nighthawk/publish-preview/route.ts`
- `src/app/api/admin/spx/dashboard/route.ts`
- `src/app/api/cron/flow-ingest/route.ts`
- `src/app/api/cron/largo-cleanup/route.ts`
- `src/app/api/cron/nighthawk-edition/route.ts`
- `src/app/api/cron/nighthawk-outcomes/route.ts`
- `src/app/api/cron/spx-evaluate/route.ts`
- `src/app/api/engine/[...path]/route.ts`
- `src/app/api/engine/health/route.ts`
- `src/app/api/market/flows/route.ts`
- `src/app/api/market/flows/stream/route.ts`
- `src/app/api/market/health/route.ts`
- `src/app/api/market/heatmap/route.ts`
- `src/app/api/market/indices/route.ts`
- `src/app/api/market/largo/query/route.ts`
- `src/app/api/market/largo/session/route.ts`
- `src/app/api/market/lotto/today/route.ts`
- `src/app/api/market/news/route.ts`
- `src/app/api/market/nighthawk/edition/route.ts`
- `src/app/api/market/nighthawk/hunt/route.ts`
- `src/app/api/market/nighthawk/play-explain/route.ts`
- `src/app/api/market/platform/snapshot/route.ts`
- `src/app/api/market/spx/commentary/route.ts`
- `src/app/api/market/spx/desk/route.ts`
- `src/app/api/market/spx/flow/route.ts`
- `src/app/api/market/spx/merged/route.ts`
- `src/app/api/market/spx/outcomes/route.ts`
- `src/app/api/market/spx/play/route.ts`
- `src/app/api/market/spx/pulse/route.ts`
- `src/app/api/market/spx/pulse/stream/route.ts`
- `src/app/api/market/spx/signals/route.ts`
- `src/app/api/membership/sync/route.ts`
- `src/app/api/webhook/whop/route.ts`

## Batch 04 — Night Hawk Engine & UI

**Focus:** Edition builder, scoring, outcomes, dossier pipeline, Night Hawk pages/components/embeds, worker script

**File count:** 41

### Files

- `scripts/nighthawk-worker.ts`
- `src/app/nighthawk/page.tsx`
- `src/components/NightHawkFeed.tsx`
- `src/components/desk/NightHawkRadar.tsx`
- `src/components/embeds/NightHawkEmbeds.tsx`
- `src/components/embeds/NightHawkRadar.tsx`
- `src/components/nighthawk/AgentPowerModal.tsx`
- `src/components/nighthawk/AgentSidebar.tsx`
- `src/components/nighthawk/NightHawkRadarBackdrop.tsx`
- `src/components/nighthawk/PlayDetailModal.tsx`
- `src/components/nighthawk/PlaybookBoard.tsx`
- `src/components/nighthawk/PlaybookPlayRow.tsx`
- `src/lib/nighthawk/agent-config.ts`
- `src/lib/nighthawk/analytics.ts`
- `src/lib/nighthawk/candidates.ts`
- `src/lib/nighthawk/claude-edition.ts`
- `src/lib/nighthawk/constants.ts`
- `src/lib/nighthawk/data-sources.ts`
- `src/lib/nighthawk/dossier.ts`
- `src/lib/nighthawk/edition-builder.ts`
- `src/lib/nighthawk/fetch-timeout.ts`
- `src/lib/nighthawk/flow-streak.ts`
- `src/lib/nighthawk/format.ts`
- `src/lib/nighthawk/hunt-builder.ts`
- `src/lib/nighthawk/hunt-mode.ts`
- `src/lib/nighthawk/index-dossier.ts`
- `src/lib/nighthawk/market-wide.ts`
- `src/lib/nighthawk/option-chain-prompt.ts`
- `src/lib/nighthawk/play-constraints.ts`
- `src/lib/nighthawk/play-critic.ts`
- `src/lib/nighthawk/play-explainer.ts`
- `src/lib/nighthawk/play-outcomes.ts`
- `src/lib/nighthawk/positioning.ts`
- `src/lib/nighthawk/publish-preview.ts`
- `src/lib/nighthawk/scorer.ts`
- `src/lib/nighthawk/session.ts`
- `src/lib/nighthawk/spx-gap.ts`
- `src/lib/nighthawk/technicals.ts`
- `src/lib/nighthawk/types.ts`
- `src/lib/nighthawk/vol-metrics.ts`
- `src/lib/platform/nighthawk-service.ts`

## Batch 05 — Largo AI & Terminal

**Focus:** Largo store, tool defs, intent routing, terminal UI, desk Largo panels

**File count:** 17

### Files

- `src/components/LargoTerminal.tsx`
- `src/components/desk/LargoMessageBody.tsx`
- `src/components/desk/LargoTerminal.tsx`
- `src/components/desk/LargoThinkingState.tsx`
- `src/components/embeds/LargoWorkspace.tsx`
- `src/lib/largo-terminal.ts`
- `src/lib/largo/flow-strike-stacks.ts`
- `src/lib/largo/intent-keywords.ts`
- `src/lib/largo/largo-live-feed.ts`
- `src/lib/largo/largo-store.ts`
- `src/lib/largo/question-intent.ts`
- `src/lib/largo/run-tool.ts`
- `src/lib/largo/spx-desk-cache.ts`
- `src/lib/largo/system-prompt.ts`
- `src/lib/largo/technicals.ts`
- `src/lib/largo/tool-defs.ts`
- `src/lib/providers/anthropic.ts`

## Batch 06 — SPX Desk, Play Engine & Lotto

**Focus:** SPX play engine, lotto, desk merge/live loaders, signals, commentary, SPX hooks and desk UI

**File count:** 65

### Files

- `src/components/SpxDashboard.tsx`
- `src/components/desk/BenzingaNewsRail.tsx`
- `src/components/desk/BenzingaNewsTicker.tsx`
- `src/components/desk/DeskHeroTicker.tsx`
- `src/components/desk/DeskPanel.tsx`
- `src/components/desk/EngineStatusBar.tsx`
- `src/components/desk/FlowAlertStream.tsx`
- `src/components/desk/GexDealerPanel.tsx`
- `src/components/desk/LevelLadder.tsx`
- `src/components/desk/SectorThermal.tsx`
- `src/components/desk/SpxChart.tsx`
- `src/components/desk/SpxCommentaryRail.tsx`
- `src/components/desk/SpxDeskPanels.tsx`
- `src/components/desk/SpxLiveStrip.tsx`
- `src/components/desk/SpxSniperBackdrop.tsx`
- `src/components/desk/SpxSniperHeader.tsx`
- `src/components/desk/SpxStructureBlocks.tsx`
- `src/components/desk/SpxTechnicalsPanel.tsx`
- `src/components/desk/SpxTradeAlerts.tsx`
- `src/hooks/useLiveSpxTape.ts`
- `src/hooks/useMergedDesk.ts`
- `src/hooks/usePulseStream.ts`
- `src/hooks/useSpxLotto.ts`
- `src/hooks/useSpxPlay.ts`
- `src/hooks/useStablePlayConfirmations.ts`
- `src/hooks/useStableValue.ts`
- `src/lib/engine.ts`
- `src/lib/play-engine-health.ts`
- `src/lib/play-engine-heartbeat.ts`
- `src/lib/spx-commentary-limits.ts`
- `src/lib/spx-commentary-offline-copy.ts`
- `src/lib/spx-desk-live.ts`
- `src/lib/spx-desk-loader.ts`
- `src/lib/spx-desk-merge.ts`
- `src/lib/spx-lotto-catalyst.ts`
- `src/lib/spx-lotto-copy.ts`
- `src/lib/spx-lotto-engine.ts`
- `src/lib/spx-lotto-options.ts`
- `src/lib/spx-lotto-outcomes.ts`
- `src/lib/spx-lotto-store.ts`
- `src/lib/spx-market-session.ts`
- `src/lib/spx-play-chain.ts`
- `src/lib/spx-play-claude.ts`
- `src/lib/spx-play-config.ts`
- `src/lib/spx-play-confirmations.ts`
- `src/lib/spx-play-conflicts.ts`
- `src/lib/spx-play-engine.ts`
- `src/lib/spx-play-gates.ts`
- `src/lib/spx-play-idle.ts`
- `src/lib/spx-play-intel.ts`
- `src/lib/spx-play-lotto.ts`
- `src/lib/spx-play-memory-id.ts`
- `src/lib/spx-play-mtf.ts`
- `src/lib/spx-play-notify.ts`
- `src/lib/spx-play-options.ts`
- `src/lib/spx-play-outcomes.ts`
- `src/lib/spx-play-session-guards.ts`
- `src/lib/spx-play-session-time.ts`
- `src/lib/spx-play-store.ts`
- `src/lib/spx-play-technicals.ts`
- `src/lib/spx-play-telemetry.ts`
- `src/lib/spx-play-thesis.ts`
- `src/lib/spx-play-watch.ts`
- `src/lib/spx-signals.ts`
- `src/lib/spx-sniper-backdrops.ts`

## Batch 07 — Admin, Telemetry & Cron Ops

**Focus:** Admin access/dashboards, API telemetry, incidents, cron health registry, SPX admin surfaces

**File count:** 34

### Files

- `scripts/analyze-api-usage.mjs`
- `src/app/admin/page.tsx`
- `src/components/admin/AdminAnalyticsDashboard.tsx`
- `src/components/admin/AdminApiCallTimeline.tsx`
- `src/components/admin/AdminApiDashboard.tsx`
- `src/components/admin/AdminApiEventDetail.tsx`
- `src/components/admin/AdminApiLiveFeed.tsx`
- `src/components/admin/AdminCronDashboard.tsx`
- `src/components/admin/AdminHealthBanner.tsx`
- `src/components/admin/AdminNightHawkDashboard.tsx`
- `src/components/admin/AdminSpxDashboard.tsx`
- `src/components/admin/AdminSpxTerminal.tsx`
- `src/components/admin/AdminUi.tsx`
- `src/lib/admin-access.ts`
- `src/lib/admin-api-dashboard.ts`
- `src/lib/admin-audit.ts`
- `src/lib/admin-critical-alerts.ts`
- `src/lib/admin-cron-health.ts`
- `src/lib/admin-endpoint-registry.ts`
- `src/lib/admin-health.ts`
- `src/lib/admin-incidents.ts`
- `src/lib/admin-route-errors.ts`
- `src/lib/admin-spx-analytics.ts`
- `src/lib/admin-spx-config-snapshot.ts`
- `src/lib/admin-spx-dashboard.ts`
- `src/lib/admin-spx-issues.ts`
- `src/lib/admin-spx-terminal.ts`
- `src/lib/api-telemetry-persist.ts`
- `src/lib/api-telemetry-redis.ts`
- `src/lib/api-telemetry-types.ts`
- `src/lib/api-telemetry.ts`
- `src/lib/api-tracked-fetch.ts`
- `src/lib/cron-registry.ts`
- `src/lib/cron-run.ts`

## Batch 08 — Data Layer, Cache & Platform Services

**Focus:** PostgreSQL schema/queries, Redis pubsub, shared caches, platform service layer, flow pipeline

**File count:** 14

### Files

- `src/lib/api.ts`
- `src/lib/db.ts`
- `src/lib/flow-data-freshness.ts`
- `src/lib/flow-events.ts`
- `src/lib/flow-persist.ts`
- `src/lib/market-api-auth.ts`
- `src/lib/market-health.ts`
- `src/lib/platform/flow-service.ts`
- `src/lib/platform/index.ts`
- `src/lib/platform/spx-service.ts`
- `src/lib/platform/types.ts`
- `src/lib/redis-pubsub.ts`
- `src/lib/server-cache.ts`
- `src/lib/shared-cache.ts`

## Batch 09 — Frontend — App Shell, Landing & General Pages

**Focus:** Root layout, landing/marketing, nav, dashboard/terminal/flows/heatmap pages, platform shell, shared UI chrome

**File count:** 35

### Files

- `src/app/apple-icon.png`
- `src/app/dashboard/page.tsx`
- `src/app/flows/page.tsx`
- `src/app/globals.css`
- `src/app/heatmap/page.tsx`
- `src/app/icon.png`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/terminal/page.tsx`
- `src/components/AuthBackground.tsx`
- `src/components/BrandImage.tsx`
- `src/components/CustomCursor.tsx`
- `src/components/FlowFeed.tsx`
- `src/components/Heatmap.tsx`
- `src/components/HeroBanner.tsx`
- `src/components/LandingChrome.tsx`
- `src/components/Nav.tsx`
- `src/components/PageBanner.tsx`
- `src/components/ScrollProgressBar.tsx`
- `src/components/landing/FadeInImage.tsx`
- `src/components/landing/FaqSection.tsx`
- `src/components/landing/FeaturesGrid.tsx`
- `src/components/landing/FloatingPanel.tsx`
- `src/components/landing/HeroSection.tsx`
- `src/components/landing/HeroToolsRail.tsx`
- `src/components/landing/LandingCta.tsx`
- `src/components/landing/LandingFooter.tsx`
- `src/components/landing/MarqueeStrip.tsx`
- `src/components/landing/OverlapShowcase.tsx`
- `src/components/landing/PricingSection.tsx`
- `src/components/platform/PlatformEmpty.tsx`
- `src/components/platform/PlatformShell.tsx`
- `src/lib/images.ts`
- `src/lib/platform-meta-keys.ts`
- `src/lib/site.ts`

## Batch 10 — Frontend — Embeds & Market Widgets

**Focus:** TradingView embeds, live flow tape, market pulse, flow volume charts (shared embed layer)

**File count:** 8

### Files

- `src/components/embeds/DashboardEmbeds.tsx`
- `src/components/embeds/EmbedFrame.tsx`
- `src/components/embeds/FlowVolumeChart.tsx`
- `src/components/embeds/FlowsEmbeds.tsx`
- `src/components/embeds/HeatmapEmbeds.tsx`
- `src/components/embeds/LiveFlowTape.tsx`
- `src/components/embeds/LiveMarketPulse.tsx`
- `src/components/embeds/TradingViewWidget.tsx`

## Batch 11 — Internal Docs Site

**Focus:** In-app documentation pages for Polygon, UW, SPX analysis, API probes, provider reference catalogs

**File count:** 41

### Files

- `scripts/generate-spx-playbook-docx.mjs`
- `scripts/probe-docs-endpoints.mjs`
- `scripts/summarize-docs-usage.mjs`
- `scripts/uw-docs-index.md`
- `src/app/docs/api-probe/page.tsx`
- `src/app/docs/claude-api-analysis/page.tsx`
- `src/app/docs/cursor-api-analysis/layout.tsx`
- `src/app/docs/cursor-api-analysis/live-probe/page.tsx`
- `src/app/docs/cursor-api-analysis/page.tsx`
- `src/app/docs/polygon/layout.tsx`
- `src/app/docs/polygon/page.tsx`
- `src/app/docs/polygon/rest/benzinga/page.tsx`
- `src/app/docs/polygon/rest/indices/page.tsx`
- `src/app/docs/polygon/rest/options/page.tsx`
- `src/app/docs/polygon/rest/stocks/page.tsx`
- `src/app/docs/polygon/websocket/indices/page.tsx`
- `src/app/docs/polygon/websocket/options/page.tsx`
- `src/app/docs/polygon/websocket/stocks/page.tsx`
- `src/app/docs/spx-sniper/cursor-spx-slayer-analysis/page.tsx`
- `src/app/docs/spx-sniper/page.tsx`
- `src/app/docs/system-analysis/page.tsx`
- `src/app/docs/unusual-whales/endpoints/page.tsx`
- `src/app/docs/unusual-whales/layout.tsx`
- `src/app/docs/unusual-whales/page.tsx`
- `src/components/docs/PolygonDocsNav.tsx`
- `src/components/docs/PolygonRestEndpointTable.tsx`
- `src/components/docs/UwDocsNav.tsx`
- `src/components/docs/UwEndpointTable.tsx`
- `src/lib/cursor-api-analysis-data.ts`
- `src/lib/cursor-api-analysis-meta.ts`
- `src/lib/docs-probe-report.json`
- `src/lib/docs-probe-report.ts`
- `src/lib/docs-usage-summary.json`
- `src/lib/polygon-docs-benzinga-rest.ts`
- `src/lib/polygon-docs-indices-rest.ts`
- `src/lib/polygon-docs-nav.ts`
- `src/lib/polygon-docs-options-rest.ts`
- `src/lib/polygon-docs-rest-types.ts`
- `src/lib/polygon-docs-stocks-rest.ts`
- `src/lib/uw-docs-catalog.ts`
- `src/lib/uw-docs-nav.ts`

## Batch 12 — Config, Deploy, Scripts & Static Assets

**Focus:** Build/deploy config, root tooling scripts, public assets, project metadata

**File count:** 26 (25 tracked + 1 audit tooling script)

### Files

- `.gitignore`
- `CURSOR_IMPL.md`
- `next-env.d.ts`
- `next.config.mjs`
- `package-lock.json`
- `package.json`
- `postcss.config.mjs`
- `public/docs/SPX-Sniper-Playbook.docx`
- `public/icon-192.png`
- `public/images/.gitkeep`
- `public/images/blackout-largo.png`
- `public/images/dashboard-bg.png`
- `public/images/hero-banner.png`
- `public/images/og-image.png`
- `public/images/spx-sniper-bot.png`
- `public/spx-sniper/spx-sniper-bg-night.webp`
- `public/spx-sniper/spx-sniper-bg-sunset.webp`
- `public/spx-sniper/spx-sniper-bg-winter.webp`
- `public/spx-sniper/spx-sniper-vivid-neon.webp`
- `railway.toml`
- `scripts/e2e-spx-probe.mjs`
- `scripts/generate-icons.cjs`
- `scripts/generate-uw-docs-catalog.mjs`
- `scripts/build-audit-plan.mjs` *(audit plan generator; add to git when committing)*
- `tailwind.config.ts`
- `tsconfig.json`
