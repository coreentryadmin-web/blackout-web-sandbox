/**
 * Registry job key → Railway production service display name.
 * Used by railway-apply-cron-config.mjs and railway-audit-apply.mjs.
 */
export const CRON_SERVICE_NAMES = {
  "alert-outcome-sync": "Alert-Outcome-Sync",
  "cron-staleness-watchdog": "Cron-Staleness-Watchdog",
  "db-cleanup": "DB_CLEANUP",
  "wall-history-retention": "Wall-History-Retention",
  "data-correctness": "Data-Correctness-Cron",
  "data-integrity": "Data-Integrity-Cron",
  "flow-ingest": "Flow-Ingest-Cron",
  "gex-alerts": "GEX-Alerts",
  "gex-eod-snapshot": "GEX-EOD-Snapshot",
  "zerodte-warm": "ZeroDTE-Warm-Cron",
  "heatmap-warm": "heatmap-warm",
  "desk-warm": "SPX-Desk-Warm",
  "largo-cleanup": "Largo-Chat-CleanUp",
  "market-regime-detector": "Market-Regime-Detector",
  "membership-reconcile": "Membership-Reconcile",
  "nighthawk-debrief": "NightHawk-Debrief-Cron",
  "nighthawk-morning-confirm": "NightHawk-Morning-Confirm",
  "nighthawk-outcomes": "NightHawk-Outcomes-Cron",
  "nighthawk-playbook": "NightHawk-Playbook",
  "provider-health-reconcile": "provider-health-reconcile",
  "socket-health": "Socket-Health-Cron",
  "spx-evaluate": "SPX-Engine-Evaluation",
  "spx-issues-sync": "SPX-Issues-Sync",
  "spx-signal-observe": "SPX-Signal-Observe",
  "spx-signal-weight-optimize": "SPX-Signal-Weight-Optimize",
  "uw-cache-refresh": "UW-Cache-Refresh-New",
  "vector-universe-snapshot": "Vector-Universe-Snapshot",
  "vector-full-state-snapshot": "Vector-Full-State-Snapshot",
  "vector-dark-pool-warm": "Vector-Dark-Pool-Warm",
  "bie-full-state-snapshot": "BIE-Full-State-Snapshot",
  "coaching-alerts": "Coaching-Alerts",
};

/** All cron job keys that have a railway.<key>.toml in the repo. */
export const ALL_CRON_KEYS = Object.keys(CRON_SERVICE_NAMES);

export const INTERNAL_CRON_BASE =
  process.env.RAILWAY_INTERNAL_CRON_BASE ?? "http://blackout-web.railway.internal:8080";

export const PRODUCTION_PROJECT_ID =
  process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a";

export const PRODUCTION_ENV = process.env.RAILWAY_ENVIRONMENT ?? "production";
