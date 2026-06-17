import { dbConfigured, getMeta, insertFlowAlert, setMeta, type FlowRow } from "@/lib/db";
import { publishFlowEvent } from "@/lib/flow-events";
import { fetchMarketFlowAlertRows, type MarketFlowAlert } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";

const CURSOR_KEY = "uw_flow_cursor";
const MIN_PREMIUM = Number(process.env.UW_FLOW_MIN_PREMIUM ?? 200_000);
const INGEST_LOCK_MS = 5_000;

let lastIngestAt = 0;
let ingestInFlight: Promise<FlowIngestResult> | null = null;

export type FlowIngestResult = {
  ok: boolean;
  ingested: number;
  polled: number;
  skipped?: string;
};

function toFlowRow(alert: MarketFlowAlert): FlowRow {
  return {
    ticker: alert.ticker,
    premium: alert.premium,
    option_type: alert.option_type,
    expiry: alert.expiry,
    strike: alert.strike,
    direction: alert.direction,
    score: alert.score,
    route: alert.route,
    alerted_at: alert.alerted_at,
  };
}

function alertId(row: Record<string, unknown>, flow: MarketFlowAlert): string {
  const id = row.id ?? row.alert_id;
  if (id != null) return `uw:${id}`;
  return `uw:${flow.ticker}:${flow.alerted_at}:${flow.strike}:${flow.option_type}`;
}

async function notifyDiscord(flow: FlowRow): Promise<void> {
  const url = process.env.DISCORD_FLOW_WEBHOOK_URL?.trim();
  if (!url) return;

  const emoji = flow.route === "whale" ? "🐋" : flow.route === "0dte" ? "⚡" : "📈";
  const content = [
    `${emoji} **${flow.ticker}** ${flow.option_type} $${flow.strike} · ${flow.expiry}`,
    `Premium **$${flow.premium.toLocaleString()}** · ${flow.direction} · ${flow.route.toUpperCase()}`,
    `[View on Blackout](https://blackouttrades.com/flows)`,
  ].join("\n");

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1900) }),
  }).catch((err) => console.warn("[flow-ingest] discord webhook:", err));
}

export async function runFlowIngest(): Promise<FlowIngestResult> {
  if (!uwConfigured()) {
    return { ok: false, ingested: 0, polled: 0, skipped: "UW_API_KEY not set" };
  }
  if (!dbConfigured()) {
    return { ok: false, ingested: 0, polled: 0, skipped: "DATABASE_URL not set" };
  }

  const cursor = await getMeta(CURSOR_KEY);
  let rows: Awaited<ReturnType<typeof fetchMarketFlowAlertRows>>;
  try {
    rows = await fetchMarketFlowAlertRows({
      limit: 100,
      min_premium: MIN_PREMIUM,
      newer_than: cursor ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`UW flow fetch failed: ${message}`);
  }
  let ingested = 0;
  let newestCursor = cursor;

  for (const { raw, flow } of rows) {
    const id = alertId(raw, flow);

    try {
      const inserted = await insertFlowAlert({
        alert_id: id,
        ticker: flow.ticker,
        strike: Number.isFinite(flow.strike) ? flow.strike : null,
        expiry: flow.expiry || null,
        option_type: flow.option_type,
        total_premium: flow.premium,
        score: flow.score,
        created_at: flow.alerted_at || null,
        raw_payload: raw,
      });

      if (inserted) {
        ingested += 1;
        const event = toFlowRow(flow);
        publishFlowEvent(event);
        void notifyDiscord(event);
      }
    } catch (error) {
      console.warn("[flow-ingest] skip row:", id, error);
    }

    const created = String(raw.created_at ?? raw.start_time ?? flow.alerted_at ?? "");
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

/** Throttled ingest while SPX desk is open — feeds SSE tape between UW polls. */
export async function maybeRunDeskFlowIngest(): Promise<void> {
  const sec = Number(process.env.SPX_DESK_FLOW_INGEST_SEC ?? 8);
  const intervalMs = Number.isFinite(sec) && sec > 0 ? sec * 1000 : 8_000;
  if (Date.now() - lastDeskIngestAt < intervalMs) return;
  lastDeskIngestAt = Date.now();
  void maybeRunFlowIngest(true);
}
