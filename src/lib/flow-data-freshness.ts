let lastFlowDataAt: number | null = null;

/** Mark UW flow data fresh (WS, REST ingest, or desk poll). */
export function markFlowDataFresh(at = Date.now()): void {
  if (!Number.isFinite(at)) return;
  // Reject future-dated timestamps (clock skew / bad source data). A future value would
  // pin freshness ahead of real time and permanently disable the staleness trade gate.
  if (at > Date.now() + 60_000) return;
  if (lastFlowDataAt == null || at > lastFlowDataAt) {
    lastFlowDataAt = at;
  }
}

export function markFlowDataFromBriefs(flows: Array<{ alerted_at?: string }>): void {
  for (const flow of flows) {
    if (!flow.alerted_at) continue;
    const t = Date.parse(flow.alerted_at);
    if (Number.isFinite(t)) markFlowDataFresh(t);
  }
}

/** Age (ms) of the newest `alerted_at` in the supplied tape rows — payload-grounded. */
export function newestFlowAgeMsFromBriefs(
  flows: Array<{ alerted_at?: string }>,
  now = Date.now()
): number | null {
  let newest: number | null = null;
  for (const flow of flows) {
    if (!flow.alerted_at) continue;
    const t = Date.parse(flow.alerted_at);
    if (!Number.isFinite(t)) continue;
    if (newest == null || t > newest) newest = t;
  }
  return newest != null ? Math.max(0, now - newest) : null;
}

export function flowDataAgeMs(now = Date.now()): number | null {
  return lastFlowDataAt != null ? Math.max(0, now - lastFlowDataAt) : null;
}

/**
 * Honest flow age for desk/play payloads: min(newest tape row, in-memory stamp).
 * Prefer this over raw `flowDataAgeMs()` so a replica that missed WS frames but
 * just fetched fresh DB rows doesn't report 23m stale and block entries.
 */
export function resolveFlowDataAgeMs(
  flows: Array<{ alerted_at?: string }>,
  now = Date.now()
): number | null {
  markFlowDataFromBriefs(flows);
  const fromTape = newestFlowAgeMsFromBriefs(flows, now);
  const fromMem = flowDataAgeMs(now);
  if (fromTape == null) return fromMem;
  if (fromMem == null) return fromTape;
  return Math.min(fromTape, fromMem);
}

export function lastFlowDataTimestamp(): number | null {
  return lastFlowDataAt;
}
