import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayPayload } from "@/lib/spx-play-engine";
import { buildMarketHealthSnapshot } from "@/lib/market-health";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { isProductionRuntime, dbConfigured } from "@/lib/db";
import { freshestFeedAgeMs, classifyFeedStaleness } from "@/lib/ws/feed-staleness";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";

export type SpxIssueSeverity = "critical" | "warning" | "info";

export type SpxAdminIssue = {
  id: string;
  severity: SpxIssueSeverity;
  category: string;
  title: string;
  detail: string;
  at?: string;
};

export type SpxAdminIssuesPayload = {
  generated_at: string;
  counts: { critical: number; warning: number; info: number; total: number };
  health_ok: boolean;
  issues: SpxAdminIssue[];
  api_errors: Array<{
    provider: string;
    endpoint: string;
    status: number | null;
    error: string | null;
    at: string;
    rate_limited: boolean;
  }>;
};

function push(
  issues: SpxAdminIssue[],
  row: Omit<SpxAdminIssue, "id"> & { id?: string }
): void {
  issues.push({
    id: row.id ?? `${row.category}:${issues.length}:${row.title.slice(0, 24)}`,
    ...row,
  });
}

export async function buildSpxAdminIssues(input: {
  desk: SpxDeskPayload;
  play: SpxPlayPayload | null;
  marketOpen?: boolean;
}): Promise<SpxAdminIssuesPayload> {
  const issues: SpxAdminIssue[] = [];
  const { desk, play } = input;
  const marketOpen = input.marketOpen ?? desk.market_open === true;

  const health = await buildMarketHealthSnapshot();

  if (isProductionRuntime() && !health.postgres.ok) {
    push(issues, {
      severity: "critical",
      category: "database",
      title: "Postgres unreachable",
      detail: health.postgres.error ?? "SELECT 1 failed in production",
    });
  }

  if (!dbConfigured()) {
    push(issues, {
      severity: isProductionRuntime() ? "critical" : "warning",
      category: "database",
      title: "DATABASE_URL not set",
      detail: "Play engine and outcomes run in memory only",
    });
  }

  if (!polygonConfigured() && !uwConfigured()) {
    push(issues, {
      severity: "critical",
      category: "providers",
      title: "No market data providers configured",
      detail: "Set POLYGON_API_KEY and/or UW_API_KEY",
    });
  }

  if (!desk.available || (desk.price ?? 0) <= 0) {
    push(issues, {
      severity: marketOpen ? "critical" : "warning",
      category: "desk",
      title: "Desk unavailable or zero price",
      detail: `available=${desk.available} price=${desk.price ?? 0}`,
    });
  }

  if (marketOpen) {
    const flowAge = desk.flow_data_age_ms;
    if (flowAge == null) {
      push(issues, {
        severity: "warning",
        category: "flow",
        title: "Flow data age unknown",
        detail: "No UW flow timestamp tracked yet",
      });
    } else if (flowAge > 120_000) {
      // `flowAge` (desk.flow_data_age_ms) is a PER-REPLICA in-memory value: on a
      // replica whose recent desk builds returned no fresh SPX flow rows it reads
      // stale even while the cluster keeps delivering frames. Before escalating to
      // CRITICAL (which pages ops + opens an incident), corroborate against the
      // shared cluster flow-liveness heartbeat. If SOME replica delivered a frame
      // recently, this is a local reading artifact → keep a visible WARNING rather
      // than a false critical. A genuine cluster-wide stall lapses the heartbeat
      // (90s TTL) → not fresh → the real critical fires. Fail-open (Redis down →
      // not fresh → critical fires), so no real stall is ever masked.
      const clusterFlowLive = await isFlowFrameFreshAnywhere(120_000);
      if (clusterFlowLive) {
        push(issues, {
          severity: "warning",
          category: "flow",
          title: "Flow data stale on this replica",
          detail: `Last local flow update ${Math.round(
            flowAge / 1000
          )}s ago, but the cluster flow heartbeat is live — per-replica reading, not a cluster stall`,
        });
      } else {
        push(issues, {
          severity: "critical",
          category: "flow",
          title: "Flow data stale",
          detail: `Last flow update ${Math.round(flowAge / 1000)}s ago`,
        });
      }
    } else if (flowAge > 45_000) {
      push(issues, {
        severity: "warning",
        category: "flow",
        title: "Flow data aging",
        detail: `Last flow update ${Math.round(flowAge / 1000)}s ago`,
      });
    }
  }

  if (desk.data_quality?.vix_term_partial) {
    push(issues, {
      severity: "warning",
      category: "desk",
      title: "Partial VIX term structure",
      detail: desk.data_quality.missing.length
        ? `Missing: ${desk.data_quality.missing.join(", ")}`
        : "VIX9D missing — using 3M only",
    });
  }

  const polygonWs = health.websockets.polygon_indices;
  if (polygonConfigured()) {
    if (!polygonWs.authenticated) {
      push(issues, {
        severity: marketOpen ? "warning" : "info",
        category: "websocket",
        title: "Polygon indices WS not authenticated",
        detail: `State: ${polygonWs.wsState}`,
      });
    }
    for (const sym of polygonWs.symbols) {
      if (marketOpen && sym.price <= 0 && sym.ageMs > 30_000) {
        push(issues, {
          severity: "warning",
          category: "websocket",
          title: `${sym.sym} stale or zero`,
          detail: `price=${sym.price} age=${Math.round(sym.ageMs / 1000)}s`,
        });
      }
    }
    // Per-feed staleness: alert when the indices socket stops delivering bars
    // even though the last price was non-zero (the symbol loop above only
    // catches price<=0). Freshest age across symbols is the liveness signal.
    if (marketOpen) {
      const polygonFreshestAgeMs = freshestFeedAgeMs(
        polygonWs.symbols.map((s) => s.ageMs)
      );
      const polygonState = classifyFeedStaleness(
        polygonFreshestAgeMs,
        30_000,
        120_000
      );
      if (polygonState === "critical") {
        push(issues, {
          severity: "critical",
          category: "websocket",
          title: "Polygon indices feed stale",
          detail: `No index bar for ${Math.round((polygonFreshestAgeMs ?? 0) / 1000)}s`,
        });
      } else if (polygonState === "stale") {
        push(issues, {
          severity: "warning",
          category: "websocket",
          title: "Polygon indices feed aging",
          detail: `No index bar for ${Math.round((polygonFreshestAgeMs ?? 0) / 1000)}s`,
        });
      }
    }
  }

  const uwWs = health.websockets.unusual_whales;
  if (uwConfigured()) {
    if (!uwWs.configured) {
      push(issues, { severity: "warning", category: "websocket", title: "UW WS disabled", detail: "UW_API_KEY missing" });
    } else if (uwWs.auth_failed) {
      const authFailedChannels = Object.entries(uwWs.channels)
        .filter(([, row]) => row.auth_failed)
        .map(([ch]) => ch);
      push(issues, {
        severity: marketOpen ? "critical" : "warning",
        category: "websocket",
        title: "UW WebSocket auth failed",
        detail:
          authFailedChannels.length > 0
            ? `Channels: ${authFailedChannels.join(", ")} — check UW_API_KEY`
            : "401 on connect — check UW_API_KEY",
      });
    } else {
      for (const [ch, row] of Object.entries(uwWs.channels)) {
        if (row.auth_failed) {
          push(issues, {
            severity: marketOpen ? "critical" : "warning",
            category: "websocket",
            title: `UW ${ch} auth failed`,
            detail: row.last_close_reason || "401 — check UW_API_KEY",
          });
          continue;
        }
        if (row.ws_state !== "OPEN") {
          push(issues, {
            severity: marketOpen ? "warning" : "info",
            category: "websocket",
            title: `UW ${ch} not connected`,
            detail: `State: ${row.ws_state}`,
          });
        } else if (!row.authenticated) {
          push(issues, {
            severity: "warning",
            category: "websocket",
            title: `UW ${ch} not authenticated`,
            detail: "Connected — waiting for first payload",
          });
        }
        const age = uwWs.last_message_age_ms[ch as keyof typeof uwWs.last_message_age_ms];
        if (marketOpen && age != null && age > 120_000) {
          push(issues, {
            severity: "warning",
            category: "websocket",
            title: `UW ${ch} silent`,
            detail: `No message for ${Math.round(age / 1000)}s`,
          });
        }
      }
    }
  }

  if (health.redis.configured && !health.flow_events.redis_bridge_ready) {
    push(issues, {
      severity: "warning",
      category: "redis",
      title: "Flow events Redis bridge not ready",
      detail: "Multi-dyno SSE may miss cross-instance flows",
    });
  }

  for (const alert of health.rate_limits.alerts) {
    push(issues, {
      severity: alert.severity === "critical" ? "critical" : "warning",
      category: "rate_limit",
      title: alert.message,
      detail: `5m count: ${alert.count_5m}`,
    });
  }

  for (const retry of health.api_telemetry.active_retries) {
    push(issues, {
      severity: "warning",
      category: "api",
      title: `API retry in progress: ${retry.provider}`,
      detail: `${retry.method} ${retry.endpoint} — ${retry.last_error ?? "scheduled"}`,
      at: retry.started_at,
    });
  }

  if (play) {
    if (play.claude?.verdict === "VETO" && play.claude.source === "claude") {
      push(issues, {
        severity: "info",
        category: "play",
        title: "Claude veto active",
        detail: play.claude.thesis,
      });
    }
    if (!play.gates.passed && play.gates.blocks.length) {
      for (const block of play.gates.blocks.slice(0, 6)) {
        push(issues, {
          severity: "info",
          category: "play",
          title: "Play gate block",
          detail: block,
        });
      }
    }
    for (const w of play.gates.warnings.slice(0, 4)) {
      push(issues, {
        severity: "info",
        category: "play",
        title: "Play gate warning",
        detail: w,
      });
    }
  }

  const playEngine = health.play_engine;
  const hb = playEngine.heartbeat;
  if (marketOpen) {
    if (!hb.last_tick_at) {
      push(issues, {
        severity: "warning",
        category: "engine",
        title: "Play engine never ticked this session",
        detail: "No cron or live-engine evaluation recorded since process start",
      });
    } else if (hb.critical_stale) {
      push(issues, {
        severity: "critical",
        category: "engine",
        title: "Play engine silent",
        detail: `Last tick ${Math.round((hb.age_ms ?? 0) / 1000)}s ago via ${hb.last_source ?? "unknown"}`,
      });
    } else if (hb.stale) {
      push(issues, {
        severity: "warning",
        category: "engine",
        title: "Play engine tick aging",
        detail: `Last tick ${Math.round((hb.age_ms ?? 0) / 1000)}s ago · ${hb.tick_count} ticks total`,
      });
    }
  }

  if (playEngine.open_play && marketOpen && !play) {
    push(issues, {
      severity: "info",
      category: "play",
      title: "Open play in DB (snapshot mode)",
      detail: `${playEngine.open_play.direction} @ ${playEngine.open_play.entry_price} — run live engine for full state`,
    });
  }

  const api_errors = health.api_telemetry.recent_errors.map((e) => ({
    provider: e.provider,
    endpoint: e.endpoint,
    status: e.status,
    error: e.error,
    at: e.at,
    rate_limited: e.rate_limited,
  }));

  const severityRank: Record<SpxIssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
    total: issues.length,
  };

  return {
    generated_at: new Date().toISOString(),
    counts,
    health_ok: counts.critical === 0 && counts.warning === 0 && health.ok,
    issues,
    api_errors,
  };
}
