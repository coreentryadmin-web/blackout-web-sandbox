import { dbConfigured, insertFlowAlert, type FlowRow } from "@/lib/db";
import { markFlowDataFresh } from "@/lib/flow-data-freshness";
import { publishFlowEvent } from "@/lib/flow-events";
import type { MarketFlowAlert } from "@/lib/providers/unusual-whales";

const MIN_PREMIUM = Number(process.env.UW_FLOW_MIN_PREMIUM ?? 200_000);

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
  const event = toFlowRow(flow);
  let inserted = false;

  if (dbConfigured()) {
    try {
      inserted = await insertFlowAlert({
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
    } catch (error) {
      console.error("[flow-persist] DB insert failed:", id, error);
    }
  }

  publishFlowEvent(event);
  if (flow.premium >= MIN_PREMIUM) markFlowDataFresh();
  void notifyDiscord(event);

  return { inserted, published: true };
}
