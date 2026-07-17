/**
 * Resolve UW flow print timestamps from persisted columns + raw_payload.
 * Shared by Postgres reads and tests — mirrors flow-persist.ts ingest logic.
 */

export type FlowTimestampInput = {
  created_at?: string | Date | null;
  inserted_at?: string | Date | null;
  raw_payload?: Record<string, unknown> | null;
};

export type ResolvedFlowTimes = {
  /** Real UW print time when known; null otherwise. */
  event_at: string | null;
  /** Tape display time — event_at, else ingest time when UW gave none. */
  display_at: string | null;
  /** True when display_at is inserted_at (not a UW print timestamp). */
  tape_time_estimated: boolean;
};

function toIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Extract the real UW alert time from a raw alert/print payload. */
export function extractUwTimestampFromRaw(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const fromCreated = toIso(raw.created_at);
  if (fromCreated) return fromCreated;
  const fromExecuted = toIso(raw.executed_at);
  if (fromExecuted) return fromExecuted;
  const st = raw.start_time;
  if (st != null) {
    const ts = Number(st);
    if (Number.isFinite(ts)) return new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
  }
  return null;
}

export function resolveFlowTimes(input: FlowTimestampInput): ResolvedFlowTimes {
  const fromColumn = toIso(input.created_at);
  const fromRaw = extractUwTimestampFromRaw(
    input.raw_payload && typeof input.raw_payload === "object" ? input.raw_payload : null
  );
  const event_at = fromColumn ?? fromRaw;
  const ingest_at = toIso(input.inserted_at);
  if (event_at) {
    return { event_at, display_at: event_at, tape_time_estimated: false };
  }
  if (ingest_at) {
    return { event_at: null, display_at: ingest_at, tape_time_estimated: true };
  }
  return { event_at: null, display_at: null, tape_time_estimated: false };
}

/** Milliseconds for LIVE / freshness — real UW time only, never ingest fallback. */
export function flowEventTimeMs(flow: {
  event_at?: string | null;
  alerted_at?: string | null;
  tape_time_estimated?: boolean;
}): number | null {
  const iso = flow.event_at ?? (flow.tape_time_estimated ? null : flow.alerted_at);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}
