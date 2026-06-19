import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const files = execSync("git ls-files", { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();

const batches = [
  {
    id: "01",
    name: "Payments, Auth & Membership",
    desc: "Clerk auth, Whop webhooks/checkout, VIP tiers, membership sync, session cache, middleware gating",
    patterns: [
      "src/middleware.ts",
      "src/lib/auth-access.ts",
      "src/lib/membership.ts",
      "src/lib/tiers.ts",
      "src/lib/whop.ts",
      "src/lib/whop-checkout.ts",
      "src/lib/clerk-theme.ts",
      "src/lib/session-cache.ts",
      "src/components/SessionCacheGuard.tsx",
      "src/components/SyncMembershipButton.tsx",
      "src/app/sign-in/**",
      "src/app/sign-up/**",
      "src/app/upgrade/page.tsx",
    ],
  },
  {
    id: "02",
    name: "Market Data Providers & WebSockets",
    desc: "Polygon, Unusual Whales, flow ingest, GEX/gamma, SPX provider adapters, WS stores, rate limits, provider probe scripts",
    patterns: [
      "src/lib/providers/config.ts",
      "src/lib/providers/flow-ingest.ts",
      "src/lib/providers/gamma-desk.ts",
      "src/lib/providers/gap-proxy.ts",
      "src/lib/providers/macro-events.ts",
      "src/lib/providers/polygon.ts",
      "src/lib/providers/polygon-largo.ts",
      "src/lib/providers/polygon-options-gex.ts",
      "src/lib/providers/provider-policy.ts",
      "src/lib/providers/spx-commentary.ts",
      "src/lib/providers/spx-desk.ts",
      "src/lib/providers/spx-session.ts",
      "src/lib/providers/spx-signal-log.ts",
      "src/lib/providers/unusual-whales.ts",
      "src/lib/providers/uw-rate-limiter.ts",
      "src/lib/providers/web-search.ts",
      "src/lib/ws/**",
      "src/lib/live-api-integrations.ts",
      "src/lib/api-provider-catalog.ts",
      "src/lib/api-rate-quotas.ts",
      "src/lib/greek-exposure-summary.ts",
      "src/lib/group-greek-flow-summary.ts",
      "src/lib/market-internals.ts",
      "src/lib/vix-term-utils.ts",
      "scripts/probe-polygon.mjs",
      "scripts/probe-polygon-ws.mjs",
      "scripts/probe-uw-multiplex.mjs",
      "scripts/probe-uw-ws-auth.mjs",
      "scripts/probe-uw-ws-urls.mjs",
    ],
  },
  {
    id: "03",
    name: "API Routes",
    desc: "All HTTP handlers under src/app/api (admin, cron, market, engine, webhooks, membership)",
    patterns: ["src/app/api/**"],
  },
  {
    id: "04",
    name: "Night Hawk Engine & UI",
    desc: "Edition builder, scoring, outcomes, dossier pipeline, Night Hawk pages/components/embeds, worker script",
    patterns: [
      "src/lib/nighthawk/**",
      "src/lib/platform/nighthawk-service.ts",
      "scripts/nighthawk-worker.ts",
      "src/app/nighthawk/page.tsx",
      "src/components/nighthawk/**",
      "src/components/NightHawkFeed.tsx",
      "src/components/desk/NightHawkRadar.tsx",
      "src/components/embeds/NightHawkEmbeds.tsx",
      "src/components/embeds/NightHawkRadar.tsx",
    ],
  },
  {
    id: "05",
    name: "Largo AI & Terminal",
    desc: "Largo store, tool defs, intent routing, terminal UI, desk Largo panels",
    patterns: [
      "src/lib/providers/anthropic.ts",
      "src/lib/largo/**",
      "src/lib/largo-terminal.ts",
      "src/components/desk/LargoMessageBody.tsx",
      "src/components/desk/LargoTerminal.tsx",
      "src/components/desk/LargoThinkingState.tsx",
      "src/components/LargoTerminal.tsx",
      "src/components/embeds/LargoWorkspace.tsx",
    ],
  },
  {
    id: "06",
    name: "SPX Desk, Play Engine & Lotto",
    desc: "SPX play engine, lotto, desk merge/live loaders, signals, commentary, SPX hooks and desk UI",
    patterns: [
      "src/lib/spx-**",
      "src/lib/play-engine-health.ts",
      "src/lib/play-engine-heartbeat.ts",
      "src/lib/engine.ts",
      "src/hooks/**",
      "src/components/SpxDashboard.tsx",
      "src/components/desk/BenzingaNewsRail.tsx",
      "src/components/desk/BenzingaNewsTicker.tsx",
      "src/components/desk/DeskHeroTicker.tsx",
      "src/components/desk/DeskPanel.tsx",
      "src/components/desk/EngineStatusBar.tsx",
      "src/components/desk/FlowAlertStream.tsx",
      "src/components/desk/GexDealerPanel.tsx",
      "src/components/desk/LevelLadder.tsx",
      "src/components/desk/SectorThermal.tsx",
      "src/components/desk/SpxChart.tsx",
      "src/components/desk/SpxCommentaryRail.tsx",
      "src/components/desk/SpxDeskPanels.tsx",
      "src/components/desk/SpxLiveStrip.tsx",
      "src/components/desk/SpxSniperBackdrop.tsx",
      "src/components/desk/SpxSniperHeader.tsx",
      "src/components/desk/SpxStructureBlocks.tsx",
      "src/components/desk/SpxTechnicalsPanel.tsx",
      "src/components/desk/SpxTradeAlerts.tsx",
    ],
  },
  {
    id: "07",
    name: "Admin, Telemetry & Cron Ops",
    desc: "Admin access/dashboards, API telemetry, incidents, cron health registry, SPX admin surfaces",
    patterns: [
      "src/lib/admin-**",
      "src/lib/api-telemetry.ts",
      "src/lib/api-telemetry-persist.ts",
      "src/lib/api-telemetry-redis.ts",
      "src/lib/api-telemetry-types.ts",
      "src/lib/api-tracked-fetch.ts",
      "src/lib/cron-registry.ts",
      "src/lib/cron-run.ts",
      "src/app/admin/page.tsx",
      "src/components/admin/**",
      "scripts/analyze-api-usage.mjs",
    ],
  },
  {
    id: "08",
    name: "Data Layer, Cache & Platform Services",
    desc: "PostgreSQL schema/queries, Redis pubsub, shared caches, platform service layer, flow pipeline",
    patterns: [
      "src/lib/db.ts",
      "src/lib/redis-pubsub.ts",
      "src/lib/server-cache.ts",
      "src/lib/shared-cache.ts",
      "src/lib/flow-data-freshness.ts",
      "src/lib/flow-events.ts",
      "src/lib/flow-persist.ts",
      "src/lib/market-api-auth.ts",
      "src/lib/market-health.ts",
      "src/lib/api.ts",
      "src/lib/platform/flow-service.ts",
      "src/lib/platform/index.ts",
      "src/lib/platform/spx-service.ts",
      "src/lib/platform/types.ts",
    ],
  },
  {
    id: "09",
    name: "Frontend — App Shell, Landing & General Pages",
    desc: "Root layout, landing/marketing, nav, dashboard/terminal/flows/heatmap pages, platform shell, shared UI chrome",
    patterns: [
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/globals.css",
      "src/app/dashboard/page.tsx",
      "src/app/terminal/page.tsx",
      "src/app/flows/page.tsx",
      "src/app/heatmap/page.tsx",
      "src/app/apple-icon.png",
      "src/app/icon.png",
      "src/components/AuthBackground.tsx",
      "src/components/BrandImage.tsx",
      "src/components/CustomCursor.tsx",
      "src/components/FlowFeed.tsx",
      "src/components/Heatmap.tsx",
      "src/components/HeroBanner.tsx",
      "src/components/LandingChrome.tsx",
      "src/components/Nav.tsx",
      "src/components/PageBanner.tsx",
      "src/components/ScrollProgressBar.tsx",
      "src/components/landing/**",
      "src/components/platform/**",
      "src/lib/images.ts",
      "src/lib/site.ts",
      "src/lib/platform-meta-keys.ts",
    ],
  },
  {
    id: "10",
    name: "Frontend — Embeds & Market Widgets",
    desc: "TradingView embeds, live flow tape, market pulse, flow volume charts (shared embed layer)",
    patterns: [
      "src/components/embeds/DashboardEmbeds.tsx",
      "src/components/embeds/EmbedFrame.tsx",
      "src/components/embeds/FlowsEmbeds.tsx",
      "src/components/embeds/FlowVolumeChart.tsx",
      "src/components/embeds/HeatmapEmbeds.tsx",
      "src/components/embeds/LiveFlowTape.tsx",
      "src/components/embeds/LiveMarketPulse.tsx",
      "src/components/embeds/TradingViewWidget.tsx",
    ],
  },
  {
    id: "11",
    name: "Internal Docs Site",
    desc: "In-app documentation pages for Polygon, UW, SPX analysis, API probes, provider reference catalogs",
    patterns: [
      "src/app/docs/**",
      "src/components/docs/**",
      "src/lib/polygon-docs-**",
      "src/lib/uw-docs-catalog.ts",
      "src/lib/uw-docs-nav.ts",
      "src/lib/cursor-api-analysis-data.ts",
      "src/lib/cursor-api-analysis-meta.ts",
      "src/lib/docs-probe-report.json",
      "src/lib/docs-probe-report.ts",
      "src/lib/docs-usage-summary.json",
      "scripts/probe-docs-endpoints.mjs",
      "scripts/summarize-docs-usage.mjs",
      "scripts/generate-spx-playbook-docx.mjs",
      "scripts/uw-docs-index.md",
    ],
  },
  {
    id: "12",
    name: "Config, Deploy, Scripts & Static Assets",
    desc: "Build/deploy config, root tooling scripts, public assets, project metadata",
    patterns: [
      ".gitignore",
      "CURSOR_IMPL.md",
      "next.config.mjs",
      "next-env.d.ts",
      "package.json",
      "package-lock.json",
      "postcss.config.mjs",
      "tailwind.config.ts",
      "tsconfig.json",
      "railway.toml",
      "public/**",
      "scripts/generate-icons.cjs",
      "scripts/e2e-spx-probe.mjs",
      "scripts/generate-uw-docs-catalog.mjs",
    ],
  },
];

function pathMatches(path, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (pattern.includes("**")) {
    const re = new RegExp(
      `^${pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*")}$`
    );
    return re.test(path);
  }
  return path === pattern;
}

const assigned = new Map();
const duplicates = [];

for (const batch of batches) {
  batch.files = [];
  for (const f of files) {
    if (batch.patterns.some((p) => pathMatches(f, p))) {
      if (assigned.has(f)) {
        duplicates.push({ file: f, a: assigned.get(f), b: batch.id });
      } else {
        assigned.set(f, batch.id);
        batch.files.push(f);
      }
    }
  }
  batch.files.sort();
}

const unassigned = files.filter((f) => !assigned.has(f));

if (duplicates.length) {
  console.error("DUPLICATES:", duplicates);
  process.exit(1);
}
if (unassigned.length) {
  console.error("UNASSIGNED:", unassigned);
  process.exit(1);
}

const lines = [];
lines.push("# Blackout Web — End-to-End Forensic Audit Plan");
lines.push("");
lines.push("> **Scope:** 100% of tracked repo files (`git ls-files`). Each file belongs to exactly one batch.");
lines.push(`> **Generated:** ${new Date().toISOString().slice(0, 10)} · **Total files:** ${files.length}`);
lines.push("");
lines.push("## How to use");
lines.push("");
lines.push("1. Work batches in order (or parallelize independent batches).");
lines.push("2. Check off each batch when its forensic audit is complete.");
lines.push("3. Record findings in `audits/batch-XX-findings.md` (create per batch as you go).");
lines.push("4. Cross-batch dependencies (e.g. API routes calling lib code) — note in findings, audit the implementation in the owning batch.");
lines.push("");
lines.push("## Coverage confirmation");
lines.push("");
lines.push(`- [x] All ${files.length} tracked files assigned`);
lines.push("- [x] No duplicate assignments");
lines.push("- [x] No unclassified leftovers");
lines.push("");
lines.push("## Batch checklist");
lines.push("");

for (const batch of batches) {
  lines.push(`- [ ] **Batch ${batch.id} — ${batch.name}** (${batch.files.length} files)`);
}

lines.push("");
lines.push("---");
lines.push("");

for (const batch of batches) {
  lines.push(`## Batch ${batch.id} — ${batch.name}`);
  lines.push("");
  lines.push(`**Focus:** ${batch.desc}`);
  lines.push("");
  lines.push(`**File count:** ${batch.files.length}`);
  lines.push("");
  lines.push("### Files");
  lines.push("");
  for (const f of batch.files) {
    lines.push(`- \`${f}\``);
  }
  lines.push("");
}

mkdirSync(join(root, "audits"), { recursive: true });
const outPath = join(root, "audits", "AUDIT-PLAN.md");
writeFileSync(outPath, lines.join("\n"), "utf8");

console.log(`Wrote ${outPath}`);
console.log(`Total: ${files.length}, Assigned: ${assigned.size}, Batches: ${batches.length}`);
