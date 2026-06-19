import "server-only";
import type { ApiCallEvent } from "@/lib/api-telemetry-types";
import { sanitizeTelemetryBody, sanitizeTelemetryUrl } from "@/lib/api-telemetry-sanitize";
import { dbConfigured, ensureSchema, dbQuery } from "@/lib/db";

export async function persistApiTelemetryEvent(event: ApiCallEvent): Promise<void> {
  if (!dbConfigured()) return;
  const safeUrl = sanitizeTelemetryUrl(event.request_url);
  const safeBody = sanitizeTelemetryBody(event.request_body);
  try {
    await ensureSchema();
    await dbQuery(
      `INSERT INTO api_telemetry_events (
        event_id, correlation_id, provider, endpoint, method, status, ok,
        latency_ms, error, severity, rate_limited, sla_breach, attempt, max_attempts,
        retry_status, phase, request_url, request_body, response_snippet, headers_sent, at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        event.correlation_id,
        event.provider,
        event.endpoint,
        event.method,
        event.status,
        event.ok,
        event.latency_ms,
        event.error,
        event.severity,
        event.rate_limited,
        event.sla_breach,
        event.attempt,
        event.max_attempts,
        event.retry_status,
        event.phase,
        safeUrl,
        safeBody,
        event.response_snippet,
        JSON.stringify(event.headers_sent),
        event.at,
      ]
    );
  } catch (err) {
    console.warn("[api-telemetry-persist]", err);
  }
}

export async function fetchPersistedApiEvent(eventId: string): Promise<ApiCallEvent | null> {
  if (!dbConfigured()) return null;
  try {
    await ensureSchema();
    const { rows } = await dbQuery<{
      seq_id: string;
      event_id: string;
      correlation_id: string;
      provider: ApiCallEvent["provider"];
      endpoint: string;
      method: string;
      status: number | null;
      ok: boolean;
      latency_ms: number;
      error: string | null;
      severity: ApiCallEvent["severity"];
      rate_limited: boolean;
      sla_breach: boolean;
      attempt: number;
      max_attempts: number;
      retry_status: ApiCallEvent["retry_status"];
      phase: ApiCallEvent["phase"];
      request_url: string | null;
      request_body: string | null;
      response_snippet: string | null;
      headers_sent: string[];
      at: Date;
    }>(
      `SELECT * FROM api_telemetry_events WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.event_id,
      seq_id: Number(row.seq_id),
      correlation_id: row.correlation_id,
      provider: row.provider,
      endpoint: row.endpoint,
      method: row.method,
      status: row.status,
      ok: row.ok,
      latency_ms: row.latency_ms,
      error: row.error,
      at: new Date(row.at).toISOString(),
      attempt: row.attempt,
      max_attempts: row.max_attempts,
      retry_status: row.retry_status,
      phase: row.phase,
      request_url: row.request_url ?? row.endpoint,
      response_snippet: row.response_snippet,
      rate_limited: row.rate_limited,
      headers_sent: Array.isArray(row.headers_sent) ? row.headers_sent : [],
      severity: row.severity,
      request_body: row.request_body,
      sla_breach: row.sla_breach,
    };
  } catch {
    return null;
  }
}
