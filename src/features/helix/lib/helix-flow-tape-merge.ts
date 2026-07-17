import type { FlowAlert } from "@/lib/api";
import { mergeFlowAlerts } from "@/features/helix/lib/helix-flow-merge";

export function flowDedupeKey(a: {
  alert_id?: string;
  ticker: string;
  strike: number;
  option_type: string;
  alerted_at?: string | null;
}): string {
  if (a.alert_id) return `id:${a.alert_id}`;
  return `${a.ticker}|${a.strike}|${a.option_type}|${String(a.alerted_at ?? "").slice(0, 19)}`;
}

function flowTimeSortKey(a: FlowAlert): number {
  if (!a.alerted_at) return 0;
  const ms = new Date(a.alerted_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Merge a fresh head page (poll/SSE refresh) into the full in-memory tape without dropping older pages. */
export function mergeFlowTapeHead(existing: FlowAlert[], head: FlowAlert[]): FlowAlert[] {
  const map = new Map<string, FlowAlert>();
  for (const row of existing) {
    map.set(flowDedupeKey(row), row);
  }
  for (const row of head) {
    const key = flowDedupeKey(row);
    const prev = map.get(key);
    map.set(key, prev ? mergeFlowAlerts(row, prev) : row);
  }
  return [...map.values()].sort((a, b) => flowTimeSortKey(b) - flowTimeSortKey(a));
}

/** Append an older cursor page — rows strictly older than what we already hold. */
export function appendFlowTapePage(existing: FlowAlert[], older: FlowAlert[]): FlowAlert[] {
  if (!older.length) return existing;
  const map = new Map<string, FlowAlert>();
  for (const row of existing) {
    map.set(flowDedupeKey(row), row);
  }
  for (const row of older) {
    const key = flowDedupeKey(row);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()].sort((a, b) => flowTimeSortKey(b) - flowTimeSortKey(a));
}

/** Cursor for the next older page — timestamp of the oldest row in the current page. */
export function flowPageCursor(
  rows: readonly { alerted_at: string; event_at?: string | null }[]
): string | null {
  if (!rows.length) return null;
  let oldestMs = Infinity;
  let cursor: string | null = null;
  for (const row of rows) {
    const iso = row.event_at || row.alerted_at;
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms) && ms < oldestMs) {
      oldestMs = ms;
      cursor = iso;
    }
  }
  return cursor;
}
