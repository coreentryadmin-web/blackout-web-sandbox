import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const files = execSync("git ls-files", { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();

/** Audit order: highest-stakes first (per forensic audit workflow). */
const batches = [
  {
    id: "01",
    slug: "Payments-Auth",
    name: "Payments & Auth",
    desc: "Clerk sessions, Whop webhooks/checkout, VIP tiers, membership sync, middleware gating, session cache",
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
    slug: "Market-Data-Providers",
    name: "Market Data Providers",
    desc: "Polygon, Unusual Whales, WebSocket stores, flow ingest, GEX/gamma, rate limits, provider probes (Finnhub removed)",
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
      "src/lib/flow-data-freshness.ts",
      "src/lib/flow-events.ts",
      "src/lib/flow-persist.ts",
      "scripts/probe-polygon.mjs",
      "scripts/probe-polygon-ws.mjs",
      "scripts/probe-uw-multiplex.mjs",
      "scripts/probe-uw-ws-auth.mjs",
      "scripts/probe-uw-ws-urls.mjs",
    ],
  },
  {
    id: "03",
    slug: "API-Routes",
    name: "API Routes",
    desc: "All HTTP handlers under src/app/api — admin, cron, market, engine, webhooks, membership",
    patterns: ["src/app/api/**"],
  },
  {
    id: "04",
    slug: "Night-Hawk",
    name: "Night Hawk",
    desc: "Edition builder, scoring, outcomes, agents, dossier pipeline, Night Hawk pages/components/embeds, worker",
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
    slug: "Largo-AI",
    name: "Largo AI",
    desc: "Largo store, tool defs, intent routing, Anthropic provider, Largo desk/terminal UI",
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
    slug: "SPX-Desk-Admin",
    name: "SPX Desk + Admin",
    desc: "SPX play engine, lotto, desk merge/live, signals, SPX hooks/UI, admin dashboards, telemetry, cron ops",
    patterns: [
      "src/lib/spx-**",
      "src/lib/play-engine-health.ts",
      "src/lib/play-engine-heartbeat.ts",
      "src/lib/engine.ts",
      "src/lib/admin-**",
      "src/lib/api-telemetry.ts",
      "src/lib/api-telemetry-persist.ts",
      "src/lib/api-telemetry-redis.ts",
      "src/lib/api-telemetry-types.ts",
      "src/lib/api-tracked-fetch.ts",
      "src/lib/cron-registry.ts",
      "src/lib/cron-run.ts",
      "src/lib/db.ts",
      "src/lib/redis-pubsub.ts",
      "src/lib/server-cache.ts",
      "src/lib/shared-cache.ts",
      "src/lib/market-api-auth.ts",
      "src/lib/market-health.ts",
      "src/lib/api.ts",
      "src/lib/platform/flow-service.ts",
      "src/lib/platform/index.ts",
      "src/lib/platform/spx-service.ts",
      "src/lib/platform/types.ts",
      "src/hooks/**",
      "src/components/SpxDashboard.tsx",
      "src/components/admin/**",
      "src/app/admin/page.tsx",
      "src/components/desk/BenzingaNewsRail.tsx",
      "src/components/desk/BenzingaNewsTicker.tsx",
      "src/components/desk/DeskHeroTicker.tsx",
      "src/components/desk/DeskPanel.tsx",
      "src/components/desk/EngineStatusBar.tsx",
      "src/components/desk/FlowAlertStream.tsx",
      "src/components/desk/GexDealerPanel.tsx",
      "src/components/desk/LevelLadder.tsx",
      "src/components/desk/SpxChart.tsx",
      "src/components/desk/SpxCommentaryRail.tsx",
      "src/components/desk/SpxDeskPanels.tsx",
      "src/components/desk/SpxLiveStrip.tsx",
      "src/components/desk/SpxSniperBackdrop.tsx",
      "src/components/desk/SpxSniperHeader.tsx",
      "src/components/desk/SpxStructureBlocks.tsx",
      "src/components/desk/SpxTechnicalsPanel.tsx",
      "src/components/desk/SpxTradeAlerts.tsx",
      "scripts/analyze-api-usage.mjs",
      "scripts/e2e-spx-probe.mjs",
    ],
  },
  {
    id: "07",
    slug: "Frontend-Config",
    name: "Frontend + Config/Deploy",
    desc: "App shell, landing/marketing, general pages, embeds, internal docs site, build/deploy config, public assets",
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
      "src/app/docs/**",
      "src/components/AuthBackground.tsx",
      "src/components/BrandImage.tsx",
      "src/components/FlowFeed.tsx",
      "src/components/Heatmap.tsx",
      "src/components/HeroBanner.tsx",
      "src/components/LandingChrome.tsx",
      "src/components/Nav.tsx",
      "src/components/PageBanner.tsx",
      "src/components/ScrollProgressBar.tsx",
      "src/components/landing/**",
      "src/components/platform/**",
      "src/components/docs/**",
      "src/components/embeds/DashboardEmbeds.tsx",
      "src/components/embeds/EmbedFrame.tsx",
      "src/components/embeds/FlowsEmbeds.tsx",
      "src/components/embeds/FlowVolumeChart.tsx",
      "src/components/embeds/HeatmapEmbeds.tsx",
      "src/components/embeds/LiveFlowTape.tsx",
      "src/components/embeds/LiveMarketPulse.tsx",
      "src/components/embeds/TradingViewWidget.tsx",
      "src/lib/images.ts",
      "src/lib/site.ts",
      "src/lib/platform-meta-keys.ts",
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
      "scripts/generate-uw-docs-catalog.mjs",
      "scripts/build-audit-plan.mjs",
      "audits/AUDIT-PLAN.md",
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

const today = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push("# Blackout Web — End-to-End Forensic Audit Plan");
lines.push("");
lines.push("> **Scope:** 100% of tracked repo files (`git ls-files`). Each file belongs to exactly one batch.");
lines.push(`> **Generated:** ${today} · **Total files:** ${files.length}`);
lines.push("> **Repo:** `C:\\Users\\raidu\\blackout-web`");
lines.push("");
lines.push("## Workflow");
lines.push("");
lines.push("1. Audit batches **in order** (highest-stakes first).");
lines.push("2. Per batch: **Step 2** (full read audit) → write `audits/AUDIT-<slug>.md` → **Step 3** (edge-case second pass, append to same file).");
lines.push("3. Mark batch checkbox done in this file when Step 2 + Step 3 complete.");
lines.push("4. After all batches: **Step 4** completeness check → `audits/AUDIT-SUMMARY.md`.");
lines.push("");
lines.push("## Cross-batch rules");
lines.push("");
lines.push("- **API Routes (03):** audit HTTP contract (auth, params, errors, caching). Business logic lives in the owning lib/UI batch.");
lines.push("- **db.ts (06):** schema/queries audited in SPX Desk + Admin; consumers in other batches note integration bugs only.");
lines.push("- **Finnhub:** removed from codebase — no files to audit.");
lines.push("");
lines.push("## Coverage confirmation");
lines.push("");
lines.push(`- [x] All ${files.length} tracked files assigned`);
lines.push("- [x] No duplicate assignments");
lines.push("- [x] No unclassified leftovers");
lines.push("");
lines.push("## Batch checklist (audit order)");
lines.push("");

for (const batch of batches) {
  lines.push(
    `- [ ] **Batch ${batch.id} — ${batch.name}** → \`audits/AUDIT-${batch.slug}.md\` (${batch.files.length} files)`
  );
}

lines.push("");
lines.push("## Leftover / unclassified files");
lines.push("");
lines.push("**None.** All tracked files assigned above.");
lines.push("");
lines.push("---");
lines.push("");

for (const batch of batches) {
  lines.push(`## Batch ${batch.id} — ${batch.name}`);
  lines.push("");
  lines.push(`**Output file:** \`audits/AUDIT-${batch.slug}.md\``);
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
console.log(`Total: ${files.length}, Batches: ${batches.length}`);
