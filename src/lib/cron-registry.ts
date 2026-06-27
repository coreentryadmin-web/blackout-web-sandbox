export type CronJobKind = "http" | "worker";

export type CronJobDefinition = {
  key: string;
  name: string;
  kind: CronJobKind;
  path?: string;
  schedule_label: string;
  /** Minutes without a successful run before marked stale. */
  stale_after_min: number;
  weekdays_only?: boolean;
  market_hours_only?: boolean;
  description: string;
};

export const CRON_JOBS: CronJobDefinition[] = [
  {
    key: "flow-ingest",
    name: "Flow Ingest",
    kind: "http",
    path: "/api/cron/flow-ingest",
    schedule_label: "~Every 2 min (market hours)",
    stale_after_min: 15,
    market_hours_only: true,
    description: "UW flow alerts → Postgres + live feed",
  },
  {
    key: "spx-evaluate",
    name: "SPX Engine",
    kind: "http",
    path: "/api/cron/spx-evaluate",
    schedule_label: "~Every 5 min (7AM–4PM ET)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description: "SPX play + lotto evaluation tick",
  },
  {
    key: "largo-cleanup",
    name: "Largo Cleanup",
    kind: "http",
    path: "/api/cron/largo-cleanup",
    schedule_label: "Weekly",
    stale_after_min: 10 * 24 * 60,
    description: "Purge stale Largo chat sessions",
  },
  {
    key: "nighthawk-outcomes",
    name: "Night Hawk Outcomes",
    kind: "http",
    path: "/api/cron/nighthawk-outcomes",
    schedule_label: "4:30 PM ET weekdays",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Resolve play target/stop vs next-day prices",
  },
  {
    key: "nighthawk-playbook",
    name: "Night Hawk Edition",
    kind: "worker",
    schedule_label: "5:30 PM ET weekdays",
    // Lowered 36h → 4h (#77 hardening D): the edition fires every 15 min across the evening window
    // and now dispatches fire-and-forget, so a published edition should land within a couple hours of
    // 5:30 PM ET. A 36h ceiling meant a fully dark night went unflagged until the NEXT evening; 4h
    // catches a missed/stuck build the same night.
    stale_after_min: 240,
    weekdays_only: true,
    description: "Full dossier pipeline → Claude plays → publish",
  },
  {
    key: "uw-cache-refresh",
    name: "UW Cache Refresh",
    kind: "http",
    path: "/api/cron/uw-cache-refresh",
    schedule_label: "Every 2 min",
    stale_after_min: 10,
    market_hours_only: true,
    description: "Pre-warm Redis cache for UW market-wide + index-ticker signals to stay under 120/min plan cap",
  },
  {
    key: "nights-watch-warm",
    name: "Night's Watch Warm",
    kind: "http",
    path: "/api/cron/nights-watch-warm",
    schedule_label: "~Every 60s (market hours)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm shared option-chain cache for all open user positions so Night's Watch GETs are pure cache hits",
  },
  {
    key: "heatmap-warm",
    name: "Heat Maps Warm",
    kind: "http",
    path: "/api/cron/heatmap-warm",
    schedule_label: "~Every 30s (market hours)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm the shared GEX heatmap matrix cache for the ~11 Heat Maps presets so user GETs are pure cache hits (no cold-build bursts)",
  },
  {
    key: "grid-warm",
    name: "BlackOut Grid Warm",
    kind: "http",
    path: "/api/cron/grid-warm",
    schedule_label: "~Every 2 min (market hours)",
    stale_after_min: 15,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm the BlackOut Grid market-wide snapshots (Analyst Actions Benzinga channel) into Redis grid:* keys so /api/grid/* reads are pure cache hits (cache-reader rule)",
  },
  {
    key: "gex-eod-snapshot",
    name: "GEX EOD Snapshot",
    kind: "http",
    path: "/api/cron/gex-eod-snapshot",
    schedule_label: "~4:10 PM ET weekdays (post-close)",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Persist end-of-day GEX close levels to the rolling gex-eod:{ticker} list so Heat Maps can anchor day-over-day history",
  },
  {
    key: "gex-alerts",
    name: "GEX Regime Alerts",
    kind: "http",
    path: "/api/cron/gex-alerts",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description: "Evaluate Heat Maps for major market-regime gamma events and broadcast web-push alerts (inert until GEX_ALERTS_PUSH + VAPID are set)",
  },
  {
    key: "db-cleanup",
    name: "DB Cleanup",
    kind: "http",
    path: "/api/cron/db-cleanup",
    schedule_label: "Nightly ~3 AM ET",
    stale_after_min: 36 * 60,
    description: "Prune high-volume Postgres tables (telemetry, flow, signal log, cron runs)",
  },
  {
    key: "membership-reconcile",
    name: "Membership Reconcile",
    kind: "http",
    path: "/api/cron/membership-reconcile",
    schedule_label: "Hourly",
    stale_after_min: 3 * 60,
    description: "Resync Whop membership → Clerk tier; self-heals dropped webhooks (lockouts + revenue leaks)",
  },
  {
    key: "data-integrity",
    name: "Data Integrity",
    kind: "http",
    path: "/api/cron/data-integrity",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Cross-validate live numbers across every tool (desk vs heatmap vs quote, SPY/SPX tracking, max-pain scaling, desk internal math, GEX freshness) — auto-opens admin incidents on any discrepancy",
  },
  {
    key: "data-correctness",
    name: "Data Correctness",
    kind: "http",
    path: "/api/cron/data-correctness",
    schedule_label: "~Every 30 min (market hours)",
    stale_after_min: 90,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Data-correctness auditor — independently re-derives Heat Maps GEX/VEX numbers (net/King/flip/walls) from the raw chain, asserts invariants/sanity/freshness, confirms SPX King + net-GEX sign against the UW oracle, and cross-checks getGexPositioning vs the SPX desk; FLAGs any wrong number to Discord",
  },
  {
    key: "cron-staleness-watchdog",
    name: "Cron Watchdog",
    kind: "http",
    path: "/api/cron/cron-staleness-watchdog",
    schedule_label: "Every 20 min",
    stale_after_min: 60,
    description: "Alerts Discord when any cron goes stale/failed (catches silent never-fired crons)",
  },
  {
    key: "spx-signal-observe",
    name: "SPX Signal Observer",
    kind: "http",
    path: "/api/cron/spx-signal-observe",
    schedule_label: "Every 5 min (market hours)",
    stale_after_min: 30,
    weekdays_only: true,
    market_hours_only: true,
    description: "Snapshot all confluence signal weights + raw market values to spx_signal_observations; backfills 30-min outcomes for earlier rows",
  },
  {
    key: "spx-signal-weight-optimize",
    name: "SPX Signal Optimizer",
    kind: "http",
    path: "/api/cron/spx-signal-weight-optimize",
    schedule_label: "Nightly 10 PM UTC",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Compute per-signal directional accuracy vs baseline; write ranked alpha report to spx_signal_weight_reports",
  },
  {
    key: "nighthawk-morning-confirm",
    name: "Night Hawk Morning Confirm",
    kind: "http",
    path: "/api/cron/nighthawk-morning-confirm",
    schedule_label: "9:15 AM ET weekdays",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Validates overnight Night Hawk plays vs pre-market SPX; writes CONFIRMED/DEGRADED/INVALIDATED status to Redis for UI badges",
  },
  {
    key: "positions-expiry",
    name: "Positions Expiry",
    kind: "http",
    path: "/api/cron/positions-expiry",
    schedule_label: "Daily 5:30 PM ET",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Auto-closes user_positions where expiry < today and status = open — prevents expired contracts from cluttering Night's Watch",
  },
];

export const CRON_JOB_BY_KEY = Object.fromEntries(CRON_JOBS.map((j) => [j.key, j])) as Record<
  string,
  CronJobDefinition
>;
