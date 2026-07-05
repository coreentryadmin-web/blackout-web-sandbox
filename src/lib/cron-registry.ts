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
  /** True for crons that themselves produce a member-visible alert/signal/status badge when
   *  they run — NOT cache warmers (grid-warm, heatmap-warm, nights-watch-warm) and NOT
   *  validators (data-correctness, data-integrity, provider-health-reconcile). Drives
   *  bie/missed-alerts.ts's outage detection — single source of truth so that list can't
   *  silently drift from the registry (was a hand-maintained duplicate list before). */
  produces_member_alert?: boolean;
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
    produces_member_alert: true,
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
    produces_member_alert: true,
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
    path: "/api/cron/nighthawk-edition",
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
    schedule_label: "~Every 5 min (market hours; in-app leader fills sub-5m gaps)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm shared option-chain cache for all open user positions so Night's Watch GETs are pure cache hits",
  },
  {
    key: "heatmap-warm",
    name: "Thermal Warm",
    kind: "http",
    path: "/api/cron/heatmap-warm",
    schedule_label: "~Every 5 min (market hours; in-app leader fills sub-5m gaps)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm the shared GEX heatmap matrix cache for the ~11 Thermal presets so user GETs are pure cache hits (no cold-build bursts)",
  },
  {
    key: "desk-warm",
    name: "SPX Desk Warm",
    kind: "http",
    path: "/api/cron/desk-warm",
    schedule_label: "~Every 5 min (market hours; in-app leader at ~90s)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm SPX desk/flow/pulse cache lanes + SPX GEX matrix so dashboard polls are pure cache hits (no multi-second buildSpxDesk blocks)",
  },
  {
    key: "grid-warm",
    name: "BlackOut Grid Warm",
    kind: "http",
    path: "/api/cron/grid-warm",
    schedule_label: "~Every 5 min (market hours; in-app leader fills sub-5m gaps)",
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
    description: "Persist end-of-day GEX close levels to the rolling gex-eod:{ticker} list so Thermal can anchor day-over-day history",
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
    description: "Evaluate Thermal for major market-regime gamma events and broadcast web-push alerts (inert until GEX_ALERTS_PUSH + VAPID are set)",
    produces_member_alert: true,
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
    schedule_label: "Every 6h",
    stale_after_min: 13 * 60,
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
    key: "provider-health-reconcile",
    name: "Provider Health Reconcile",
    kind: "http",
    path: "/api/cron/provider-health-reconcile",
    schedule_label: "~Every 10 min (market hours)",
    stale_after_min: 25,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Roll up api_telemetry_events upstream failures and rate limits into admin incidents — catches sustained UW/Polygon/Anthropic outages without watching the dashboard",
  },
  {
    key: "spx-issues-sync",
    name: "SPX Issues Sync",
    kind: "http",
    path: "/api/cron/spx-issues-sync",
    schedule_label: "~Every 5 min (7AM–4PM ET)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Computes SPX play/engine health issues (Claude arbiter veto, gate blocks/warnings, play-engine heartbeat silent/stale) and syncs them into admin_incidents — previously this only ran as a side effect of a human loading /api/admin/spx/dashboard, so BIE's discovery layer (fetchDiscoveryIncidents) went silently stale on SPX engine health whenever nobody was viewing that page",
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
      "Data-correctness auditor — independently re-derives Thermal GEX/VEX numbers (net/King/flip/walls) from the raw chain, asserts invariants/sanity/freshness, confirms SPX King + net-GEX sign against the UW oracle, and cross-checks getGexPositioning vs the SPX desk; FLAGs any wrong number to Discord",
  },
  {
    key: "cron-staleness-watchdog",
    name: "Cron Watchdog",
    kind: "http",
    path: "/api/cron/cron-staleness-watchdog",
    schedule_label: "Every 5 min",
    stale_after_min: 60,
    description: "Alerts Discord when any cron goes stale/failed (catches silent never-fired crons)",
  },
  {
    key: "socket-health",
    name: "Socket Health",
    kind: "http",
    path: "/api/cron/socket-health",
    schedule_label: "~Every 15 min (market hours)",
    stale_after_min: 25,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Boot lazy WS managers and report polygon/UW/options/LULD cluster status — used by RTH validation instead of log grep",
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
    produces_member_alert: true,
  },
  {
    key: "market-regime-detector",
    name: "Market Regime Detector",
    kind: "http",
    path: "/api/cron/market-regime-detector",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Derives composite market regime (GEX/vol/trend/flow) from the SPX desk + HELIX flows and writes to market_regime + flow_anomalies tables — feeds FlowAnomalyBanner and Night Hawk morning confirm",
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
  {
    key: "alert-outcome-sync",
    name: "Alert Outcome Sync",
    kind: "http",
    path: "/api/cron/alert-outcome-sync",
    schedule_label: "Every 6h",
    stale_after_min: 13 * 60,
    description:
      "Grades historical alert_audit_log rows by copying each row's already-computed outcome from its origin table (zerodte_setup_log/nighthawk_play_outcomes/spx_play_outcomes) — feeds BIE precedent search (get_similar_precedents), which was a complete no-op before this cron existed",
  },
];

export const CRON_JOB_BY_KEY = Object.fromEntries(CRON_JOBS.map((j) => [j.key, j])) as Record<
  string,
  CronJobDefinition
>;
