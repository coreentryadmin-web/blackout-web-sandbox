import type { SpxAdminIssue } from "@/lib/admin-spx-issues";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import { dbConfigured, dbQuery } from "@/lib/db";

// BUG-06 fix (a): Use an insertion-order Map capped at MAX_SEEN entries so the
// set never grows unboundedly. Oldest entries are evicted when the cap is hit.
const MAX_SEEN = 100;
const seenCritical = new Map<string, true>();

function addSeen(id: string): void {
  if (seenCritical.has(id)) return;
  if (seenCritical.size >= MAX_SEEN) {
    // Evict the oldest insertion (first key in Map iteration order).
    const oldest = seenCritical.keys().next().value;
    if (oldest !== undefined) seenCritical.delete(oldest);
  }
  seenCritical.set(id, true);
}

// BUG-06 fix (b): Pre-populate seenCritical from the DB on first use so that a
// process restart does not re-alert for issues that were already notified in the
// last 24 hours.
let seenBootstrapped = false;

async function bootstrapSeenFromDb(): Promise<void> {
  if (seenBootstrapped) return;
  seenBootstrapped = true; // mark eagerly so concurrent callers don't double-query
  if (!dbConfigured()) return;
  try {
    const res = await dbQuery<{ fingerprint: string }>(
      `SELECT fingerprint FROM admin_incidents
       WHERE severity = 'critical'
         AND opened_at >= NOW() - INTERVAL '24 hours'`
    );
    for (const row of res.rows) {
      addSeen(row.fingerprint);
    }
  } catch (err) {
    console.warn("[admin-critical-alerts] bootstrap from DB failed:", err);
  }
}

export async function maybeAlertCriticalIssues(issues: SpxAdminIssue[]): Promise<number> {
  await bootstrapSeenFromDb();

  const critical = issues.filter((i) => i.severity === "critical");
  const fresh = critical.filter((i) => !seenCritical.has(i.id));
  for (const issue of critical) addSeen(issue.id);

  if (fresh.length === 0) return 0;

  const lines = fresh.slice(0, 5).map((i) => `**${i.title}** — ${i.detail}`);
  await notifyOpsDiscord({
    title: `SPX CRITICAL · ${fresh.length} new`,
    body: lines.join("\n"),
    severity: "critical",
  });
  return fresh.length;
}
