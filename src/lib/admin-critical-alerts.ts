import type { SpxAdminIssue } from "@/lib/admin-spx-issues";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";

const seenCritical = new Set<string>();

export async function maybeAlertCriticalIssues(issues: SpxAdminIssue[]): Promise<number> {
  const critical = issues.filter((i) => i.severity === "critical");
  const fresh = critical.filter((i) => !seenCritical.has(i.id));
  for (const issue of critical) seenCritical.add(issue.id);

  if (fresh.length === 0) return 0;

  const lines = fresh.slice(0, 5).map((i) => `**${i.title}** — ${i.detail}`);
  await notifyOpsDiscord({
    title: `SPX CRITICAL · ${fresh.length} new`,
    body: lines.join("\n"),
    severity: "critical",
  });
  return fresh.length;
}
