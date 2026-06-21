import { dbConfigured, getMeta, setMeta } from "@/lib/db";
import { persistAndPublishFlowAlert } from "@/lib/flow-persist";
import { fetchMarketFlowAlertRows } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { uwSocket, isUwChannelFresh } from "@/lib/ws/uw-socket";

const CURSOR_KEY = "uw_flow_cursor";
const CURSOR_ID_KEY = "uw_flow_cursor_max_id";
const INGEST_LOCK_MS = 5_000;

let lastIngestAt = 0;
export let ingestInFlight: Promise<FlowIngestResult> | null = null;

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

  // When the Python bot is the primary flow poller (FLOW_INGEST_BOT_PRIMARY=1),
  // skip REST ingestion entirely. The bot writes to the shared Postgres and publishes
  // to the blackout:flow-events Redis channel — this cron is redundant.
  // The UW WebSocket path (below) still runs as a hot backup if the bot goes down.
  if (process.env.FLOW_INGEST_BOT_PRIMARY === "1") {
    return { ok: true, ingested: 0, polled: 0, skipped: "bot_primary" };
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
  const cursorMaxId = Number((await getMeta(CURSOR_ID_KEY)) ?? 0);
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
  let newestMaxId = cursorMaxId;

  for (const { raw, flow } of rows) {
    const rowId = Number(raw.id ?? raw.alert_id ?? 0);
    const created = String(raw.created_at ?? "");
    if (!created && rowId > 0 && rowId <= cursorMaxId) {
      continue;
    }

    try {
      const { inserted } = await persistAndPublishFlowAlert(raw, flow);
      if (inserted) ingested += 1;
    } catch (error) {
      console.error("[flow-ingest] persist row failed:", error);
    }

    // Cursor must stay in UW's native `created_at` format and is echoed back as
    // `newer_than`. Never mix in `start_time` (epoch) — comparing epoch vs ISO
    // strings corrupts ordering and can drop or duplicate alerts. Rows without
    // `created_at` advance a numeric id cursor instead (still ingested + deduped).
    if (created && (!newestCursor || created > newestCursor)) {
      newestCursor = created;
    } else if (!created && rowId > newestMaxId) {
      newestMaxId = rowId;
    }
  }

  if (newestCursor && newestCursor !== cursor) {
    await setMeta(CURSOR_KEY, newestCursor);
  }
  if (newestMaxId > cursorMaxId) {
    await setMeta(CURSOR_ID_KEY, String(newestMaxId));
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
