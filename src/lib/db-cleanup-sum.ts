/** Sum numeric prune counts only — BIE metadata is stored separately in cron `tables`. */
export function sumCleanupDeletes(tables: Record<string, number>): number {
  return Object.values(tables).reduce((sum, n) => sum + n, 0);
}
