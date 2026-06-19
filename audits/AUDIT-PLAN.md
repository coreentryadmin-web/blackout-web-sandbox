# Blackout Web — End-to-End Forensic Audit Plan

> **Scope:** 100% of tracked repo files (`git ls-files`). Each file belongs to exactly one batch.
> **Generated:** 2026-06-19 · **Total files:** 376
> **Repo:** `C:\Users\raidu\blackout-web`

## Workflow

1. Audit batches **in order** (highest-stakes first).
2. Per batch: **Step 2** (full read audit) → write `audits/AUDIT-<slug>.md` → **Step 3** (edge-case second pass, append to same file).
3. Mark batch checkbox done in this file when Step 2 + Step 3 complete.
4. After all batches: **Step 4** completeness check → `audits/AUDIT-SUMMARY.md`.

## Cross-batch rules

- **API Routes (03):** audit HTTP contract (auth, params, errors, caching). Business logic lives in the owning lib/UI batch.
- **db.ts (06):** schema/queries audited in SPX Desk + Admin; consumers in other batches note integration bugs only.
- **Finnhub:** removed from codebase — no files to audit.

## Coverage confirmation

- [x] All 376 tracked files assigned
- [x] No duplicate assignments
- [x] No unclassified leftovers

## Batch checklist (audit order)

- [x] **Batch 01 — Payments & Auth** → `audits/AUDIT-Payments-Auth.md` (13 files)
- [x] **Batch 02 — Market Data Providers** → `audits/AUDIT-Market-Data-Providers.md` (34 files)
- [x] **Batch 03 — API Routes** → `audits/AUDIT-API-Routes.md` (43 files)
- [x] **Batch 04 — Night Hawk** → `audits/AUDIT-Night-Hawk.md` (48 files)
- [x] **Batch 05 — Largo AI** → `audits/AUDIT-Largo-AI.md` (17 files)
- [x] **Batch 06 — SPX Desk + Admin** → `audits/AUDIT-SPX-Desk-Admin.md` (111 files)
- [x] **Batch 07 — Frontend + Config/Deploy** → `audits/AUDIT-Frontend-Config.md` (110 files)

## Re-audit checklist (post-fix verification)

> **Re-audited:** 2026-06-19 · **Output:** `audits/REAUDIT-*.md` + `audits/REAUDIT-SUMMARY.md`

- [x] **Batch 01 — Payments & Auth** → `audits/REAUDIT-Payments-Auth.md` — 3/3 MED fixed; LOW policy items open
- [x] **Batch 02 — Market Data Providers** → `audits/REAUDIT-Market-Data-Providers.md` — B2-01 fixed; B2-02/B2-03 open
- [x] **Batch 03 — API Routes** → `audits/REAUDIT-API-Routes.md` — H1 + M1 + M2 fixed
- [x] **Batch 04 — Night Hawk** → `audits/REAUDIT-Night-Hawk.md` — M1/M2 + low items open
- [x] **Batch 05 — Largo AI** → `audits/REAUDIT-Largo-AI.md` — prefetch/tool-loop items open
- [x] **Batch 06 — SPX Desk + Admin** → `audits/REAUDIT-SPX-Desk-Admin.md` — **all C+H fixed**; M1/M6/M7/M17 + admin ops open
- [x] **Batch 07 — Frontend + Config** → `audits/REAUDIT-Frontend-Config.md` — F1/F3/F4 fixed; F2/F5 open

## Leftover / unclassified files

**None** among tracked files (`git ls-files`).

**Untracked (out of plan scope until added to git):**
- `complete-repo-bugs/` — scratch audit drafts (8 files); not in `git ls-files`

**Separate repo (not this audit):**
- Discord/engine service: `C:\Users\raidu\BO-AAI\BlackOut-Uw-Alerts` (`BlackOut-Uw-Alerts` on GitHub)

---

## Batch 01 — Payments & Auth

**Output file:** `audits/AUDIT-Payments-Auth.md`

**Focus:** Clerk sessions, Whop webhooks/checkout, VIP tiers, membership sync, middleware gating, session cache

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

## Batch 02 — Market Data Providers

**Output file:** `audits/AUDIT-Market-Data-Providers.md`

**Focus:** Polygon, Unusual Whales, WebSocket stores, flow ingest, GEX/gamma, rate limits, provider probes (Finnhub removed)

**File count:** 34

### Files

- `scripts/probe-polygon-ws.mjs`
- `scripts/probe-polygon.mjs`
- `scripts/probe-uw-multiplex.mjs`
- `scripts/probe-uw-ws-auth.mjs`
- `scripts/probe-uw-ws-urls.mjs`
- `src/lib/api-provider-catalog.ts`
- `src/lib/api-rate-quotas.ts`
- `src/lib/flow-data-freshness.ts`
- `src/lib/flow-events.ts`
- `src/lib/flow-persist.ts`
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

**Output file:** `audits/AUDIT-API-Routes.md`

**Focus:** All HTTP handlers under src/app/api — admin, cron, market, engine, webhooks, membership

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

## Batch 04 — Night Hawk

**Output file:** `audits/AUDIT-Night-Hawk.md`

**Focus:** Edition builder, scoring, outcomes, agents, dossier pipeline, Night Hawk pages/components/embeds, worker

**File count:** 48

### Files

- `scripts/nighthawk-worker.ts`
- `src/app/nighthawk/page.tsx`
- `src/components/NightHawkFeed.tsx`
- `src/components/desk/NightHawkRadar.tsx`
- `src/components/embeds/NightHawkEmbeds.tsx`
- `src/components/embeds/NightHawkRadar.tsx`
- `src/components/nighthawk/AgentFilterFields.tsx`
- `src/components/nighthawk/AgentPowerModal.tsx`
- `src/components/nighthawk/AgentSidebar.tsx`
- `src/components/nighthawk/DayTradeAgentWorkspace.tsx`
- `src/components/nighthawk/DayTradeSignalCard.tsx`
- `src/components/nighthawk/NightHawkRadarBackdrop.tsx`
- `src/components/nighthawk/PlayDetailModal.tsx`
- `src/components/nighthawk/PlaybookBoard.tsx`
- `src/components/nighthawk/PlaybookPlayRow.tsx`
- `src/lib/nighthawk/agent-config.ts`
- `src/lib/nighthawk/agents/day-trade-agent.ts`
- `src/lib/nighthawk/agents/day-trade-filters.ts`
- `src/lib/nighthawk/agents/day-trade-types.ts`
- `src/lib/nighthawk/agents/index.ts`
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

## Batch 05 — Largo AI

**Output file:** `audits/AUDIT-Largo-AI.md`

**Focus:** Largo store, tool defs, intent routing, Anthropic provider, Largo desk/terminal UI

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

## Batch 06 — SPX Desk + Admin

**Output file:** `audits/AUDIT-SPX-Desk-Admin.md`

**Focus:** SPX play engine, lotto, desk merge/live, signals, SPX hooks/UI, admin dashboards, telemetry, cron ops

**File count:** 111

### Files

- `scripts/analyze-api-usage.mjs`
- `scripts/e2e-spx-probe.mjs`
- `src/app/admin/page.tsx`
- `src/components/SpxDashboard.tsx`
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
- `src/lib/api.ts`
- `src/lib/cron-registry.ts`
- `src/lib/cron-run.ts`
- `src/lib/db.ts`
- `src/lib/engine.ts`
- `src/lib/market-api-auth.ts`
- `src/lib/market-health.ts`
- `src/lib/platform/flow-service.ts`
- `src/lib/platform/index.ts`
- `src/lib/platform/spx-service.ts`
- `src/lib/platform/types.ts`
- `src/lib/play-engine-health.ts`
- `src/lib/play-engine-heartbeat.ts`
- `src/lib/redis-pubsub.ts`
- `src/lib/server-cache.ts`
- `src/lib/shared-cache.ts`
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

## Batch 07 — Frontend + Config/Deploy

**Output file:** `audits/AUDIT-Frontend-Config.md`

**Focus:** App shell, landing/marketing, general pages, embeds, internal docs site, build/deploy config, public assets

**File count:** 110

### Files

- `.gitignore`
- `CURSOR_IMPL.md`
- `audits/AUDIT-PLAN.md`
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
- `scripts/build-audit-plan.mjs`
- `scripts/generate-icons.cjs`
- `scripts/generate-spx-playbook-docx.mjs`
- `scripts/generate-uw-docs-catalog.mjs`
- `scripts/probe-docs-endpoints.mjs`
- `scripts/summarize-docs-usage.mjs`
- `scripts/uw-docs-index.md`
- `src/app/apple-icon.png`
- `src/app/dashboard/page.tsx`
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
- `src/components/docs/PolygonDocsNav.tsx`
- `src/components/docs/PolygonRestEndpointTable.tsx`
- `src/components/docs/UwDocsNav.tsx`
- `src/components/docs/UwEndpointTable.tsx`
- `src/components/embeds/DashboardEmbeds.tsx`
- `src/components/embeds/EmbedFrame.tsx`
- `src/components/embeds/FlowVolumeChart.tsx`
- `src/components/embeds/FlowsEmbeds.tsx`
- `src/components/embeds/HeatmapEmbeds.tsx`
- `src/components/embeds/LiveFlowTape.tsx`
- `src/components/embeds/LiveMarketPulse.tsx`
- `src/components/embeds/TradingViewWidget.tsx`
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
- `src/lib/cursor-api-analysis-data.ts`
- `src/lib/cursor-api-analysis-meta.ts`
- `src/lib/docs-probe-report.json`
- `src/lib/docs-probe-report.ts`
- `src/lib/docs-usage-summary.json`
- `src/lib/images.ts`
- `src/lib/platform-meta-keys.ts`
- `src/lib/polygon-docs-benzinga-rest.ts`
- `src/lib/polygon-docs-indices-rest.ts`
- `src/lib/polygon-docs-nav.ts`
- `src/lib/polygon-docs-options-rest.ts`
- `src/lib/polygon-docs-rest-types.ts`
- `src/lib/polygon-docs-stocks-rest.ts`
- `src/lib/site.ts`
- `src/lib/uw-docs-catalog.ts`
- `src/lib/uw-docs-nav.ts`
- `tailwind.config.ts`
- `tsconfig.json`

---

## Phase 2 — Re-audit (2026-06-19)

**Trigger:** Phase 1 fixes complete (~35 files); build passes (`npm run build`).

**Method:** Forensic re-read of every original finding ID in `AUDIT-*.md`; file:line verification; hunt for regressions and new bugs.

### Re-audit outputs

| Batch | Re-audit file | Status |
|-------|---------------|--------|
| 01 Payments & Auth | [`REAUDIT-payments-auth.md`](./REAUDIT-payments-auth.md) | ✅ |
| 02 Market Data Providers | [`REAUDIT-market-data-providers.md`](./REAUDIT-market-data-providers.md) | ✅ |
| 03 API Routes | [`REAUDIT-api-routes.md`](./REAUDIT-api-routes.md) | ✅ |
| 04 Night Hawk | [`REAUDIT-night-hawk.md`](./REAUDIT-night-hawk.md) | ✅ |
| 05 Largo AI | [`REAUDIT-largo-ai.md`](./REAUDIT-largo-ai.md) | ✅ |
| 06 SPX Desk + Admin | [`REAUDIT-spx-desk-admin.md`](./REAUDIT-spx-desk-admin.md) | ✅ |
| 07 Frontend + Config | [`REAUDIT-frontend-config.md`](./REAUDIT-frontend-config.md) | ✅ |
| Summary | [`REAUDIT-SUMMARY.md`](./REAUDIT-SUMMARY.md) | ✅ |

### Re-audit result (aggregate)

| Status | Count |
|--------|------:|
| ✅ FIXED | 30 |
| ⚠️ PARTIAL | 4 |
| ❌ OPEN | 67 |
| 🆕 NEW | 2 |

**Key verifications:** C1/C2, B06-H1–H8, H1, H2, NH-M1 (partial), B2-01, B5-01/02, MED-1, API-M1, docs layout — see summary matrix in `REAUDIT-SUMMARY.md`.

**Phase 3 candidates:** B2-02 (halt gate), F2 (public playbook), B2-03 (desk WS merge), DB constraints (B06-M1/M6/M7), Railway liveness (API-NEW-1).
