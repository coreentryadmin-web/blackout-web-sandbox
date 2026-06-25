import { dbConfigured, insertFlowAlert, type FlowRow } from "@/lib/db";
import { markFlowDataFresh } from "@/lib/flow-data-freshness";
import { publishFlowEvent } from "@/lib/flow-events";
import type { MarketFlowAlert } from "@/lib/providers/unusual-whales";
import { shouldFanOut } from "@/lib/flow-fanout";
import { flowFallbackAlertId } from "@/lib/flow-alert-id";
import { markFlowFrameDelivered } from "@/lib/flow-liveness";

/**
 * SSE row shape published to the live tape. Extends FlowRow with the canonical
 * `alert_id` so the client can dedup on the SAME id the persist layer uses for the
 * Postgres ON-CONFLICT (audit gap #13) instead of reconstructing a lossy composite
 * key — that composite missed/duplicated rows after an SSE reconnect.
 */
export type PublishedFlowRow = FlowRow & { alert_id: string };

export const MIN_PREMIUM = Number(process.env.UW_FLOW_MIN_PREMIUM ?? 200_000);

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

export function alertId(row: Record<string, unknown>, flow: MarketFlowAlert): string {
  const id = row.id ?? row.alert_id;
  if (id != null) return `uw:${id}`;
  return flowFallbackAlertId(flow);
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
  }).catch((err) => console.warn("[flow-persist] discord webhook:", err));
}

/**
 * Persist UW flow to Postgres (when configured), always fan out to SSE.
 * REST cron and WS path both call this — live tape + DB history stay aligned.
 */
export async function persistAndPublishFlowAlert(
  raw: Record<string, unknown>,
  flow: MarketFlowAlert
): Promise<{ inserted: boolean; published: boolean }> {
  if (flow.premium < MIN_PREMIUM) {
    return { inserted: false, published: false };
  }

  const id = alertId(raw, flow);

  // Store the REAL UW alert time only (created_at / start_time). Do NOT fall back to
  // flow.alerted_at — parseUwFlowAlert defaults that to NOW for timestampless alerts,
  // which made stale prints look fresh and produced false Velocity Radar spikes.
  const realCreatedAt = ((): string | null => {
    if (raw.created_at) return String(raw.created_at);
    const st = raw.start_time;
    if (st != null) {
      const ts = Number(st);
      if (Number.isFinite(ts)) return new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
    }
    return null;
  })();

  const event: PublishedFlowRow = { ...toFlowRow(flow), alert_id: id };
  event.event_at = realCreatedAt;
  // alerted_at drives the live tape's sort + LIVE badge. Use the REAL UW time
  // (realCreatedAt) when known; otherwise leave it null so the UI excludes the row
  // from LIVE/sort rather than trusting parseUwFlowAlert's "" / a fabricated now()
  // (audit gap #6). The DB-backed REST read keeps its own historical fallback.
  event.alerted_at = realCreatedAt ?? "";
  let inserted = false;
  let insertFailed = false;
  const usingDb = dbConfigured();

  if (usingDb) {
    try {
      inserted = await insertFlowAlert({
        alert_id: id,
        ticker: flow.ticker,
        strike: Number.isFinite(flow.strike) ? flow.strike : null,
        expiry: flow.expiry || null,
        option_type: flow.option_type,
        total_premium: flow.premium,
        score: flow.score,
        created_at: realCreatedAt,
        raw_payload: raw,
      });
    } catch (error) {
      // Transient DB failure: `inserted` is an unreliable false. Mark it so we still
      // fan out (a real ON-CONFLICT duplicate returns false WITHOUT throwing, so this
      // does not defeat dedup).
      insertFailed = true;
      console.error("[flow-persist] DB insert failed:", id, error);
    }
  }

  // Only fan out when this call actually created the row, when there is no DB to dedup
  // against, or when the insert threw. Suppressing a genuine ON-CONFLICT duplicate
  // (usingDb && !inserted && !insertFailed) is what stops the WS+REST double-post of the
  // same whale to Discord + the redundant SSE traffic.
  const shouldPublish = shouldFanOut(inserted, usingDb, insertFailed);
  if (shouldPublish) {
    publishFlowEvent(event);
    if (flow.premium >= MIN_PREMIUM) markFlowDataFresh();
    // Cluster-wide liveness heartbeat (audit gap #10): record that THIS replica
    // just delivered a fresh flow frame so a replica running only the flow-ingest
    // cron can tell the cluster already has a live WS and skip redundant REST.
    // Throttled + best-effort + tagged with this process's id (the cron excludes
    // its own writes), so it can never silence the cron that owns this process.
    markFlowFrameDelivered();
    void notifyDiscord(event);
  }

  return { inserted, published: shouldPublish };
}
