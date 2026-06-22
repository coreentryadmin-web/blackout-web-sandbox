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
    stale_after_min: 36 * 60,
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
    key: "cron-staleness-watchdog",
    name: "Cron Watchdog",
    kind: "http",
    path: "/api/cron/cron-staleness-watchdog",
    schedule_label: "Every 20 min",
    stale_after_min: 60,
    description: "Alerts Discord when any cron goes stale/failed (catches silent never-fired crons)",
  },
];

export const CRON_JOB_BY_KEY = Object.fromEntries(CRON_JOBS.map((j) => [j.key, j])) as Record<
  string,
  CronJobDefinition
>;
