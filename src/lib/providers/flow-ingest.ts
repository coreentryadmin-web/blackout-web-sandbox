import { dbConfigured, getMeta, setMeta } from "@/lib/db";
import { persistAndPublishFlowAlert } from "@/lib/flow-persist";
import { fetchMarketFlowAlertRows } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { uwSocket, isUwChannelFresh } from "@/lib/ws/uw-socket";

const CURSOR_KEY = "uw_flow_cursor";
const INGEST_LOCK_MS = 5_000;

let lastIngestAt = 0;
let ingestInFlight: Promise<FlowIngestResult> | null = null;

export type FlowIngestResult = {
  ok: boolean;
  ingested: number;
  polled: number;
  skipped?: string;
};

export async function runFlowIngest(): Promise<FlowIngestResult> {
  if (!uwConfigured()) {
    return { ok: false, ingested: 0, polled: 0, skipped: "UW_API_KEY not set" };
  }

  const wsStatus = uwSocket.getStatus();
  // Skip REST only if the WS is BOTH authenticated AND actually delivering data.
  // "OPEN" alone means authenticated; a half-open/silent socket would otherwise
  // stop ingestion entirely. Require a recent message before trusting the WS path.
  if (wsStatus["flow_alerts"] === "OPEN" && isUwChannelFresh("flow_alerts", 120_000)) {
    // WS path persists via persistAndPublishFlowAlert — skip REST to avoid duplicate UW calls.
    return { ok: true, ingested: 0, polled: 0, skipped: "ws_active" };
  }

  if (!dbConfigured()) {
    return { ok: false, ingested: 0, polled: 0, skipped: "DATABASE_URL not set" };
  }

  const cursor = await getMeta(CURSOR_KEY);
  let rows: Awaited<ReturnType<typeof fetchMarketFlowAlertRows>>;
  try {
    rows = await fetchMarketFlowAlertRows({
      limit: 100,
      min_premium: Number(process.env.UW_FLOW_MIN_PREMIUM ?? 200_000),
      newer_than: cursor ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[flow-ingest] UW fetch skipped:", message);
    return { ok: false, ingested: 0, polled: 0, skipped: message };
  }
  let ingested = 0;
  let newestCursor = cursor;

  for (const { raw, flow } of rows) {
    try {
      const { inserted } = await persistAndPublishFlowAlert(raw, flow);
      if (inserted) ingested += 1;
    } catch (error) {
      console.error("[flow-ingest] persist row failed:", error);
    }

    // Cursor must stay in UW's native `created_at` format and is echoed back as
    // `newer_than`. Never mix in `start_time` (epoch) — comparing epoch vs ISO
    // strings corrupts ordering and can drop or duplicate alerts. Rows without
    // `created_at` simply don't advance the cursor (still ingested + deduped).
    const created = String(raw.created_at ?? "");
    if (created && (!newestCursor || created > newestCursor)) {
      newestCursor = created;
    }
  }

  if (newestCursor && newestCursor !== cursor) {
    await setMeta(CURSOR_KEY, newestCursor);
  }

  return { ok: true, ingested, polled: rows.length };
}

export async function maybeRunFlowIngest(force = false): Promise<FlowIngestResult | null> {
  const intervalMs = Number(process.env.UW_FLOW_POLL_SEC ?? 45) * 1000;
  const due = force || Date.now() - lastIngestAt >= intervalMs;
  if (!due) return null;

  if (ingestInFlight) return ingestInFlight;

  ingestInFlight = runFlowIngest()
    .then((res) => {
      lastIngestAt = Date.now();
      return res;
    })
    .finally(() => {
      ingestInFlight = null;
    });

  return ingestInFlight;
}

/** Prevent concurrent cron + lazy ingest stampedes. */
export function ingestLockActive(): boolean {
  return ingestInFlight != null && Date.now() - lastIngestAt < INGEST_LOCK_MS;
}

let lastDeskIngestAt = 0;

/** Throttled ingest while SPX desk is open — disabled by default to avoid UW 429s. */
export async function maybeRunDeskFlowIngest(): Promise<void> {
  const sec = Number(process.env.SPX_DESK_FLOW_INGEST_SEC ?? 0);
  if (!Number.isFinite(sec) || sec <= 0) return;
  const intervalMs = sec * 1000;
  if (Date.now() - lastDeskIngestAt < intervalMs) return;
  lastDeskIngestAt = Date.now();
  void maybeRunFlowIngest(false);
}
