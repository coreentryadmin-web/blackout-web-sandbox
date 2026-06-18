import type { SpxAdminIssuesPayload, SpxIssueSeverity } from "@/lib/admin-spx-issues";
import type { AdminIncidentRow } from "@/lib/admin-incidents";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayPayload } from "@/lib/spx-play-engine";

export type SpxTerminalLineKind = "critical" | "warning" | "info" | "api" | "pulse" | "ok";

export type SpxTerminalLine = {
  id: string;
  at: string;
  kind: SpxTerminalLineKind;
  category: string;
  marker: string;
  headline: string;
  detail: string;
  meta?: string;
};

export type SpxTerminalPayload = {
  generated_at: string;
  stream_at: string;
  health_ok: boolean;
  counts: {
    critical: number;
    warning: number;
    info: number;
    api: number;
    pulse: number;
    total: number;
  };
  lines: SpxTerminalLine[];
};

const MARKERS: Record<SpxTerminalLineKind, string> = {
  critical: "✕",
  warning: "△",
  info: "●",
  api: "◈",
  pulse: "▸",
  ok: "✓",
};

function markerForSeverity(s: SpxIssueSeverity): string {
  return MARKERS[s];
}

function kindForSeverity(s: SpxIssueSeverity): SpxTerminalLineKind {
  return s;
}

export function buildSpxTerminalFeed(input: {
  issues: SpxAdminIssuesPayload;
  desk: SpxDeskPayload;
  play: SpxPlayPayload | null;
  liveEngine: boolean;
  signalsToday?: number;
  flowAlertsToday?: number;
  routeErrors?: Array<{ route: string; message: string; at: string }>;
  openIncidents?: AdminIncidentRow[];
}): SpxTerminalPayload {
  const { desk, play, issues, liveEngine } = input;
  const now = new Date().toISOString();
  const lines: SpxTerminalLine[] = [];

  const push = (row: Omit<SpxTerminalLine, "marker"> & { marker?: string }) => {
    lines.push({
      marker: row.marker ?? MARKERS[row.kind],
      ...row,
    });
  };

  // ── Live status pulses (heartbeat rows) ──
  const marketLabel = desk.market_label ?? "SPX";
  const marketOpen = desk.market_open === true;
  push({
    id: `pulse:market:${now}`,
    at: now,
    kind: "pulse",
    category: "market",
    headline: `${marketLabel} ${desk.price?.toFixed(2) ?? "—"} · ${marketOpen ? "SESSION OPEN" : "SESSION CLOSED"}`,
    detail: desk.available
      ? `regime ${desk.regime ?? "—"} · vwap ${desk.above_vwap ? "above" : "below"} · change ${desk.spx_change_pct?.toFixed(2) ?? "—"}%`
      : "Desk feed unavailable",
    meta: desk.source ?? undefined,
  });

  if (input.liveEngine && input.play) {
    push({
      id: `pulse:engine:${input.play.action}:${input.play.direction ?? "flat"}`,
      at: now,
      kind: input.play.gates.passed ? "ok" : "info",
      category: "engine",
      headline: `ENGINE ${input.play.action} · ${input.play.direction?.toUpperCase() ?? "FLAT"} · grade ${input.play.grade ?? "—"}`,
      detail: input.play.headline ?? "Live evaluation tick",
      meta: `score ${input.play.score ?? "—"}`,
    });
  } else {
    push({
      id: `pulse:engine:snapshot`,
      at: now,
      kind: "pulse",
      category: "engine",
      headline: "ENGINE snapshot mode",
      detail: "Run live engine for gate blocks, Claude veto, and trim logic",
    });
  }

  const flowAge = desk.flow_data_age_ms;
  if (flowAge != null) {
    push({
      id: `pulse:flow:${Math.round(flowAge / 1000)}`,
      at: now,
      kind: flowAge > 120_000 ? "critical" : flowAge > 45_000 ? "warning" : "ok",
      category: "flow",
      headline: `FLOW tick · ${Math.round(flowAge / 1000)}s since last UW alert`,
      detail: `0dte net ${desk.flow_0dte_net ?? "—"} · tide ${desk.tide_bias ?? "—"}`,
      meta: input.flowAlertsToday != null ? `${input.flowAlertsToday} alerts today` : undefined,
    });
  }

  if (input.signalsToday != null) {
    push({
      id: `pulse:signals:${input.signalsToday}`,
      at: now,
      kind: "pulse",
      category: "signals",
      headline: `SIGNALS · ${input.signalsToday} logged today`,
      detail: input.play?.gates.warnings.length
        ? `${input.play.gates.warnings.length} active gate warnings`
        : "Telemetry nominal",
    });
  }

  // ── System issues ──
  for (const issue of input.issues.issues) {
    push({
      id: issue.id,
      at: issue.at ?? input.issues.generated_at,
      kind: kindForSeverity(issue.severity),
      category: issue.category,
      marker: markerForSeverity(issue.severity),
      headline: issue.title,
      detail: issue.detail,
    });
  }

  // ── Open incidents (acked / MTTA) ──
  for (const inc of input.openIncidents ?? []) {
    const openMs = Date.now() - new Date(inc.opened_at).getTime();
    push({
      id: `incident:${inc.id}`,
      at: inc.acked_at ?? inc.opened_at,
      kind: inc.severity === "critical" ? "critical" : "warning",
      category: `incident:${inc.status}`,
      headline: inc.title,
      detail: inc.detail,
      meta: [
        inc.status.toUpperCase(),
        inc.mtta_ms != null ? `MTTA ${Math.round(inc.mtta_ms / 1000)}s` : `open ${Math.round(openMs / 1000)}s`,
        inc.acked_by ? `by ${inc.acked_by}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  // ── Route handler failures ──
  for (const err of input.routeErrors ?? []) {
    push({
      id: `route:${err.route}:${err.at}`,
      at: err.at,
      kind: "api",
      category: "route",
      headline: err.route,
      detail: err.message,
      meta: "ROUTE ERR",
    });
  }

  // ── API errors ──
  for (const err of input.issues.api_errors) {
    push({
      id: `api:${err.at}:${err.endpoint}`,
      at: err.at,
      kind: "api",
      category: err.provider,
      headline: err.endpoint,
      detail: err.error ?? "Request failed",
      meta: [err.status != null ? String(err.status) : null, err.rate_limited ? "RATE LIMITED" : null]
        .filter(Boolean)
        .join(" · "),
    });
  }

  if (lines.filter((l) => l.kind === "critical" || l.kind === "warning" || l.kind === "api").length === 0) {
    push({
      id: `ok:clear:${now}`,
      at: now,
      kind: "ok",
      category: "system",
      headline: "ALL SYSTEMS NOMINAL",
      detail: "No critical failures, warnings, or API errors in the current window",
    });
  }

  const severityRank: Record<SpxTerminalLineKind, number> = {
    critical: 0,
    warning: 1,
    api: 2,
    info: 3,
    pulse: 4,
    ok: 5,
  };

  lines.sort((a, b) => {
    const rank = severityRank[a.kind] - severityRank[b.kind];
    if (rank !== 0) return rank;
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });

  const counts = {
    critical: lines.filter((l) => l.kind === "critical").length,
    warning: lines.filter((l) => l.kind === "warning").length,
    info: lines.filter((l) => l.kind === "info").length,
    api: lines.filter((l) => l.kind === "api").length,
    pulse: lines.filter((l) => l.kind === "pulse").length,
    total: lines.length,
  };

  return {
    generated_at: input.issues.generated_at,
    stream_at: now,
    health_ok: input.issues.health_ok,
    counts,
    lines,
  };
}
