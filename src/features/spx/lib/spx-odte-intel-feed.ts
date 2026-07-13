/**
 * 0DTE intel feed — material desk / heatmap / Night Hawk edges only.
 * Pure diffs so the Playbook terminal can scroll important events without noise.
 */
import type { SpxDeskPayload, SpxFlowBrief } from "@/features/spx/lib/spx-desk";
import type { GexWall } from "@/lib/providers/gamma-desk";
import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import { fmtPrice } from "@/lib/api";

/** Minimum premium for a single flow print to surface in the intel feed. */
export const INTEL_FLOW_PREMIUM_MIN = 500_000;
/** Sweep prints can be a bit smaller and still matter. */
export const INTEL_SWEEP_PREMIUM_MIN = 250_000;
/** Absolute 0DTE net-flow delta that counts as a material shift. */
export const INTEL_FLOW_NET_DELTA_MIN = 150_000;
/** Absolute GEX net change (dollars) that counts as material. */
export const INTEL_GEX_NET_DELTA_MIN = 500_000_000;
/** Wall magnitude ratio for strengthen / reduce (desk walls). */
export const INTEL_WALL_RATIO = 1.25;
/** Heatmap grew_pct threshold (±) for build / melt. */
export const INTEL_WALL_GREW_PCT = 0.25;

export type OdteIntelEvent = {
  id: string;
  at: string;
  kind:
    | "anchor"
    | "flip"
    | "call_wall"
    | "put_wall"
    | "flow_print"
    | "flow_net"
    | "gex_net"
    | "spot_cross"
    | "regime"
    | "gamma_regime"
    | "gex_stale"
    | "feed_stalled"
    | "halt"
    | "or_break"
    | "heatmap_event"
    | "vex"
    | "dex"
    | "charm"
    | "nighthawk";
  line: PlayTerminalLine;
};

/** Minimal heatmap slice for intel (matches route fields we care about). */
export type IntelHeatmapSlice = {
  asof?: string;
  spot?: number;
  events?: Array<{
    type: string;
    severity?: string;
    message: string;
    at?: string;
    level?: number;
  }>;
  shift?: {
    available?: boolean;
    wall_changes?: {
      call_wall?: { from: number | null; to: number | null; moved_pts: number | null; grew_pct: number | null };
      put_wall?: { from: number | null; to: number | null; moved_pts: number | null; grew_pct: number | null };
    };
  };
  vex_shift?: {
    available?: boolean;
    wall_changes?: {
      call_wall?: { from: number | null; to: number | null; moved_pts: number | null; grew_pct: number | null };
      put_wall?: { from: number | null; to: number | null; moved_pts: number | null; grew_pct: number | null };
    };
    flip_migration?: { from: number | null; to: number | null } | null;
  };
  gex?: { flip?: number | null; regime?: { posture?: string | null }; total?: number };
  vex?: {
    flip?: number | null;
    pos_wall?: number | null;
    neg_wall?: number | null;
    total?: number;
    regime?: { posture?: string | null };
    strike_totals?: Record<string, number>;
  };
  dex?: { zero_level?: number | null; total?: number; regime?: { posture?: string | null } };
  charm?: { zero_level?: number | null; total?: number; regime?: { posture?: string | null } };
};

function moneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function wallByKind(walls: GexWall[] | undefined, kind: "support" | "resistance"): GexWall | null {
  if (!walls?.length) return null;
  const matches = walls.filter((w) => w.kind === kind);
  if (!matches.length) return null;
  return matches.reduce((best, w) => (Math.abs(w.net_gex) > Math.abs(best.net_gex) ? w : best));
}

function flowKey(f: SpxFlowBrief): string {
  return `${f.alerted_at}|${f.strike}|${f.premium}|${f.option_type}|${f.has_sweep ? 1 : 0}`;
}

function isMaterialFlow(f: SpxFlowBrief): boolean {
  if (!Number.isFinite(f.premium)) return false;
  if (f.has_sweep && Math.abs(f.premium) >= INTEL_SWEEP_PREMIUM_MIN) return true;
  return Math.abs(f.premium) >= INTEL_FLOW_PREMIUM_MIN;
}

function kingFromTotals(totals: Record<string, number> | undefined): number | null {
  if (!totals) return null;
  let best: number | null = null;
  let bestAbs = 0;
  for (const [k, v] of Object.entries(totals)) {
    const strike = Number(k);
    if (!Number.isFinite(strike) || !Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > bestAbs) {
      bestAbs = a;
      best = strike;
    }
  }
  return best;
}

type PushFn = (kind: OdteIntelEvent["kind"], line: PlayTerminalLine, key: string) => void;

function emitWallMagnitude(
  push: PushFn,
  kind: "call_wall" | "put_wall",
  label: string,
  tone: "bull" | "bear",
  prev: GexWall,
  next: GexWall
) {
  const prevAbs = Math.abs(prev.net_gex);
  const nextAbs = Math.abs(next.net_gex);
  if (prevAbs <= 0) return;
  if (nextAbs > prevAbs * INTEL_WALL_RATIO) {
    push(
      kind,
      {
        icon: "level",
        tone,
        text: `${label} strengthening ${fmtPrice(next.strike)} · ${moneyShort(next.net_gex)}`,
        indent: 1,
      },
      `build-${next.strike}-${Math.round(next.net_gex)}`
    );
  } else if (nextAbs < prevAbs / INTEL_WALL_RATIO) {
    push(
      kind,
      {
        icon: "level",
        tone: "warn",
        text: `${label} reducing ${fmtPrice(next.strike)} · ${moneyShort(next.net_gex)}`,
        indent: 1,
      },
      `melt-${next.strike}-${Math.round(next.net_gex)}`
    );
  }
}

function emitHeatmapWallChange(
  push: PushFn,
  at: string,
  label: string,
  tone: "bull" | "bear",
  change:
    | { from: number | null; to: number | null; moved_pts: number | null; grew_pct: number | null }
    | null
    | undefined,
  prefix: string
) {
  if (!change) return;
  if (change.from != null && change.to != null && change.from !== change.to) {
    push(
      label.includes("PUT") || label.includes("NEG") ? "put_wall" : "call_wall",
      {
        icon: "level",
        tone,
        text: `${label} moved ${fmtPrice(change.from)} → ${fmtPrice(change.to)}${
          change.moved_pts != null ? ` (${change.moved_pts > 0 ? "+" : ""}${change.moved_pts.toFixed(0)}pt)` : ""
        }`,
        indent: 1,
      },
      `${prefix}-move-${change.from}->${change.to}-${at}`
    );
  } else if (change.grew_pct != null && Math.abs(change.grew_pct) >= INTEL_WALL_GREW_PCT) {
    const building = change.grew_pct > 0;
    push(
      label.includes("PUT") || label.includes("NEG") ? "put_wall" : "call_wall",
      {
        icon: "level",
        tone: building ? tone : "warn",
        text: `${label} ${building ? "building" : "reducing"} ${
          change.to != null ? fmtPrice(change.to) : ""
        } · ${building ? "+" : ""}${(change.grew_pct * 100).toFixed(0)}%`,
        indent: 1,
      },
      `${prefix}-${building ? "build" : "melt"}-${change.to}-${Math.round(change.grew_pct * 100)}-${at}`
    );
  }
}

/**
 * Diff two desk snapshots → material 0DTE intel events (newest last).
 * Pass `prev=null` on first tick to seed current structure without flooding.
 */
export function diffOdteIntelEvents(
  prev: SpxDeskPayload | null | undefined,
  next: SpxDeskPayload | null | undefined,
  opts?: { seed?: boolean }
): OdteIntelEvent[] {
  if (!next?.available || !(next.price > 0)) return [];
  const at = next.as_of || new Date().toISOString();
  const events: OdteIntelEvent[] = [];
  const seed = Boolean(opts?.seed || !prev);

  const push: PushFn = (kind, line, key) => {
    events.push({ id: `${kind}|${key}|${at}`, at, kind, line });
  };

  // --- Anchor (GEX king) ---
  if (next.gex_king != null) {
    if (seed) {
      push(
        "anchor",
        {
          icon: "gamma",
          tone: "accent",
          text: `ANCHOR ${fmtPrice(next.gex_king)} · max |GEX| node`,
          indent: 1,
        },
        String(next.gex_king)
      );
    } else if (prev?.gex_king != null && prev.gex_king !== next.gex_king) {
      push(
        "anchor",
        {
          icon: "gamma",
          tone: "warn",
          text: `ANCHOR migrated ${fmtPrice(prev.gex_king)} → ${fmtPrice(next.gex_king)}`,
          indent: 1,
        },
        `${prev.gex_king}->${next.gex_king}`
      );
    } else if (prev?.gex_king == null) {
      push(
        "anchor",
        {
          icon: "gamma",
          tone: "accent",
          text: `ANCHOR locked ${fmtPrice(next.gex_king)}`,
          indent: 1,
        },
        String(next.gex_king)
      );
    }
  }

  // --- γ Flip ---
  if (next.gamma_flip != null) {
    if (seed) {
      const side = next.above_gamma_flip ? "above" : "below";
      push(
        "flip",
        {
          icon: "level",
          tone: next.above_gamma_flip ? "bull" : "bear",
          text: `γ FLIP ${fmtPrice(next.gamma_flip)} · spot ${side}`,
          indent: 1,
        },
        String(next.gamma_flip)
      );
    } else if (prev?.gamma_flip != null && Math.abs(prev.gamma_flip - next.gamma_flip) >= 0.5) {
      push(
        "flip",
        {
          icon: "level",
          tone: "warn",
          text: `γ FLIP shifted ${fmtPrice(prev.gamma_flip)} → ${fmtPrice(next.gamma_flip)}`,
          indent: 1,
        },
        `${prev.gamma_flip}->${next.gamma_flip}`
      );
    }

    if (!seed && prev && prev.above_gamma_flip !== next.above_gamma_flip) {
      push(
        "spot_cross",
        {
          icon: "pulse",
          tone: next.above_gamma_flip ? "bull" : "bear",
          text: next.above_gamma_flip
            ? `SPOT crossed ABOVE γ flip ${fmtPrice(next.gamma_flip)}`
            : `SPOT crossed BELOW γ flip ${fmtPrice(next.gamma_flip)}`,
          indent: 1,
        },
        `cross-${next.above_gamma_flip}`
      );
    }
  }

  // --- Call / put walls ---
  const nextCall = wallByKind(next.gex_walls, "resistance");
  const nextPut = wallByKind(next.gex_walls, "support");
  const prevCall = wallByKind(prev?.gex_walls, "resistance");
  const prevPut = wallByKind(prev?.gex_walls, "support");

  if (nextCall) {
    if (seed) {
      push(
        "call_wall",
        {
          icon: "level",
          tone: "bull",
          text: `CALL WALL ${fmtPrice(nextCall.strike)} · ${moneyShort(nextCall.net_gex)}`,
          indent: 1,
        },
        String(nextCall.strike)
      );
    } else if (!prevCall || prevCall.strike !== nextCall.strike) {
      push(
        "call_wall",
        {
          icon: "level",
          tone: "bull",
          text: prevCall
            ? `CALL WALL moved ${fmtPrice(prevCall.strike)} → ${fmtPrice(nextCall.strike)}`
            : `CALL WALL building ${fmtPrice(nextCall.strike)} · ${moneyShort(nextCall.net_gex)}`,
          indent: 1,
        },
        `${prevCall?.strike ?? "new"}->${nextCall.strike}`
      );
    } else {
      emitWallMagnitude(push, "call_wall", "CALL WALL", "bull", prevCall, nextCall);
    }
  }

  if (nextPut) {
    if (seed) {
      push(
        "put_wall",
        {
          icon: "level",
          tone: "bear",
          text: `PUT WALL ${fmtPrice(nextPut.strike)} · ${moneyShort(nextPut.net_gex)}`,
          indent: 1,
        },
        String(nextPut.strike)
      );
    } else if (!prevPut || prevPut.strike !== nextPut.strike) {
      push(
        "put_wall",
        {
          icon: "level",
          tone: "bear",
          text: prevPut
            ? `PUT WALL moved ${fmtPrice(prevPut.strike)} → ${fmtPrice(nextPut.strike)}`
            : `PUT WALL building ${fmtPrice(nextPut.strike)} · ${moneyShort(nextPut.net_gex)}`,
          indent: 1,
        },
        `${prevPut?.strike ?? "new"}->${nextPut.strike}`
      );
    } else {
      emitWallMagnitude(push, "put_wall", "PUT WALL", "bear", prevPut, nextPut);
    }
  }

  // --- Aggregate GEX net ---
  if (next.gex_net != null) {
    if (seed) {
      push(
        "gex_net",
        {
          icon: "gamma",
          tone: next.gex_net >= 0 ? "bull" : "bear",
          text: `NET GEX ${moneyShort(next.gex_net)}`,
          indent: 1,
        },
        String(Math.round(next.gex_net))
      );
    } else if (
      prev?.gex_net != null &&
      Math.abs(next.gex_net - prev.gex_net) >= INTEL_GEX_NET_DELTA_MIN
    ) {
      const delta = next.gex_net - prev.gex_net;
      push(
        "gex_net",
        {
          icon: "gamma",
          tone: delta >= 0 ? "bull" : "bear",
          text: `GEX ${delta >= 0 ? "+" : ""}${moneyShort(delta)} → net ${moneyShort(next.gex_net)}`,
          indent: 1,
        },
        `${Math.round(prev.gex_net)}->${Math.round(next.gex_net)}`
      );
    }
  }

  // --- EMA regime ---
  if (next.regime && next.regime !== "unknown") {
    if (seed) {
      push(
        "regime",
        {
          icon: "pulse",
          tone:
            next.regime === "bullish" || next.regime === "recovering"
              ? "bull"
              : next.regime === "bearish" || next.regime === "weak"
                ? "bear"
                : "neutral",
          text: `REGIME ${String(next.regime).toUpperCase()}`,
          indent: 1,
        },
        next.regime
      );
    } else if (prev?.regime && prev.regime !== next.regime) {
      push(
        "regime",
        {
          icon: "pulse",
          tone: "warn",
          text: `REGIME ${String(prev.regime).toUpperCase()} → ${String(next.regime).toUpperCase()}`,
          indent: 1,
        },
        `${prev.regime}->${next.regime}`
      );
    }
  }

  // --- Gamma regime ---
  if (next.gamma_regime && next.gamma_regime !== "unknown") {
    if (seed) {
      push(
        "gamma_regime",
        {
          icon: "gamma",
          tone: next.gamma_regime === "mean_revert" ? "bull" : "bear",
          text: `γ REGIME ${next.gamma_regime === "mean_revert" ? "MEAN-REVERT" : "AMPLIFICATION"}`,
          indent: 1,
        },
        next.gamma_regime
      );
    } else if (prev?.gamma_regime && prev.gamma_regime !== next.gamma_regime) {
      push(
        "gamma_regime",
        {
          icon: "gamma",
          tone: "warn",
          text: `γ REGIME ${prev.gamma_regime} → ${next.gamma_regime}`,
          indent: 1,
        },
        `${prev.gamma_regime}->${next.gamma_regime}`
      );
    }
  }

  // --- Opening range break (HOD/LOD proxy early session) ---
  if (!seed && prev && next.hod != null && next.lod != null && next.price > 0) {
    const brokeHigh = prev.price <= (prev.hod ?? next.hod) && next.price > next.hod;
    const brokeLow = prev.price >= (prev.lod ?? next.lod) && next.price < next.lod;
    if (brokeHigh) {
      push(
        "or_break",
        {
          icon: "pulse",
          tone: "bull",
          text: `OR BREAK ABOVE ${fmtPrice(next.hod)} (HOD proxy)`,
          indent: 1,
        },
        `or-hi-${next.hod}`
      );
    }
    if (brokeLow) {
      push(
        "or_break",
        {
          icon: "pulse",
          tone: "bear",
          text: `OR BREAK BELOW ${fmtPrice(next.lod)} (LOD proxy)`,
          indent: 1,
        },
        `or-lo-${next.lod}`
      );
    }
  }

  // --- GEX stale / feed stalled ---
  if (!seed && prev) {
    if (Boolean(prev.gex_stale) !== Boolean(next.gex_stale)) {
      push(
        "gex_stale",
        {
          icon: next.gex_stale ? "no" : "ok",
          tone: next.gex_stale ? "warn" : "bull",
          text: next.gex_stale ? "GEX STALE — ladder on sticky fallback" : "GEX LIVE — ladder refreshed",
          indent: 1,
        },
        `gex-stale-${next.gex_stale}`
      );
    }
    if (Boolean(prev.feed_stalled) !== Boolean(next.feed_stalled)) {
      push(
        "feed_stalled",
        {
          icon: next.feed_stalled ? "no" : "ok",
          tone: next.feed_stalled ? "warn" : "bull",
          text: next.feed_stalled ? "INDEX FEED STALLED — price may be frozen" : "INDEX FEED recovered",
          indent: 1,
        },
        `feed-${next.feed_stalled}`
      );
    }
  }

  // --- Trading halts ---
  if (!seed && prev) {
    const prevHalts = new Set((prev.active_halts ?? []).map((h) => h.symbol));
    for (const h of next.active_halts ?? []) {
      if (prevHalts.has(h.symbol)) continue;
      push(
        "halt",
        {
          icon: "no",
          tone: "bear",
          text: `HALT ${h.symbol}${h.halt_type ? ` · ${h.halt_type}` : ""}${h.reason ? ` — ${h.reason}` : ""}`,
          indent: 1,
        },
        `halt-${h.symbol}-${h.halt_type ?? ""}`
      );
    }
  } else if (seed && (next.active_halts?.length ?? 0) > 0) {
    for (const h of next.active_halts ?? []) {
      push(
        "halt",
        {
          icon: "no",
          tone: "bear",
          text: `HALT ACTIVE ${h.symbol}${h.halt_type ? ` · ${h.halt_type}` : ""}`,
          indent: 1,
        },
        `halt-seed-${h.symbol}`
      );
    }
  }

  // --- 0DTE flow net ---
  if (next.flow_0dte_net != null) {
    if (
      !seed &&
      prev?.flow_0dte_net != null &&
      (Math.sign(prev.flow_0dte_net) !== Math.sign(next.flow_0dte_net) ||
        Math.abs(next.flow_0dte_net - prev.flow_0dte_net) >= INTEL_FLOW_NET_DELTA_MIN)
    ) {
      const tone = next.flow_0dte_net >= 0 ? "bull" : "bear";
      push(
        "flow_net",
        {
          icon: "flow",
          tone,
          text: `0DTE FLOW NET ${next.flow_0dte_net >= 0 ? "+" : ""}${moneyShort(next.flow_0dte_net)}`,
          indent: 1,
        },
        String(Math.round(next.flow_0dte_net))
      );
    }
  }

  // --- Massive individual prints ---
  if (!seed && prev) {
    const seen = new Set((prev.spx_flows ?? []).map(flowKey));
    for (const f of next.spx_flows ?? []) {
      if (!isMaterialFlow(f)) continue;
      const key = flowKey(f);
      if (seen.has(key)) continue;
      const side = String(f.option_type || "").toLowerCase().startsWith("c") ? "CALL" : "PUT";
      const sweep = f.has_sweep ? " SWEEP" : "";
      push(
        "flow_print",
        {
          icon: "flow",
          tone: side === "CALL" ? "bull" : "bear",
          text: `MASSIVE ${side}${sweep} ${fmtPrice(f.strike)} · ${moneyShort(f.premium)}`,
          indent: 1,
        },
        key
      );
    }
  }

  return events;
}

/** Diff heatmap cache snapshots (events, wall_changes, VEX/DEX/CHARM). */
export function diffHeatmapIntelEvents(
  prev: IntelHeatmapSlice | null | undefined,
  next: IntelHeatmapSlice | null | undefined,
  opts?: { seed?: boolean }
): OdteIntelEvent[] {
  if (!next) return [];
  const at = next.asof || new Date().toISOString();
  const events: OdteIntelEvent[] = [];
  const seed = Boolean(opts?.seed || !prev);
  const push: PushFn = (kind, line, key) => {
    events.push({ id: `${kind}|${key}|${at}`, at, kind, line });
  };

  // Server GEX events (flip crossed, wall broken, regime flipped, net sign)
  if (!seed && next.events?.length) {
    const prevMsgs = new Set((prev?.events ?? []).map((e) => `${e.type}|${e.message}|${e.at ?? ""}`));
    for (const ev of next.events) {
      const key = `${ev.type}|${ev.message}|${ev.at ?? ""}`;
      if (prevMsgs.has(key)) continue;
      push(
        "heatmap_event",
        {
          icon: ev.severity === "warn" ? "no" : "pulse",
          tone: ev.severity === "warn" ? "warn" : "accent",
          text: ev.message,
          indent: 1,
        },
        key
      );
    }
  }

  // GEX wall_changes from shift
  if (!seed && next.shift?.available && next.shift.wall_changes) {
    emitHeatmapWallChange(
      push,
      at,
      "CALL WALL",
      "bull",
      next.shift.wall_changes.call_wall,
      "hm-call"
    );
    emitHeatmapWallChange(
      push,
      at,
      "PUT WALL",
      "bear",
      next.shift.wall_changes.put_wall,
      "hm-put"
    );
  }

  // VEX walls / flip
  if (next.vex) {
    const vexKing = kingFromTotals(next.vex.strike_totals);
    if (seed && (vexKing != null || next.vex.flip != null || next.vex.regime?.posture)) {
      if (vexKing != null) {
        push(
          "vex",
          {
            icon: "gamma",
            tone: "accent",
            text: `VEX ANCHOR ${fmtPrice(vexKing)}`,
            indent: 1,
          },
          `vex-king-${vexKing}`
        );
      }
      if (next.vex.flip != null) {
        push(
          "vex",
          {
            icon: "level",
            tone: "neutral",
            text: `VEX FLIP ${fmtPrice(next.vex.flip)}`,
            indent: 1,
          },
          `vex-flip-${next.vex.flip}`
        );
      }
      if (next.vex.regime?.posture) {
        push(
          "vex",
          {
            icon: "pulse",
            tone: next.vex.regime.posture === "positive" ? "bull" : "bear",
            text: `VEX POSTURE ${next.vex.regime.posture.toUpperCase()}`,
            indent: 1,
          },
          `vex-posture-${next.vex.regime.posture}`
        );
      }
    } else if (!seed && prev?.vex) {
      const prevKing = kingFromTotals(prev.vex.strike_totals);
      if (vexKing != null && prevKing != null && vexKing !== prevKing) {
        push(
          "vex",
          {
            icon: "gamma",
            tone: "warn",
            text: `VEX ANCHOR ${fmtPrice(prevKing)} → ${fmtPrice(vexKing)}`,
            indent: 1,
          },
          `vex-king-${prevKing}->${vexKing}`
        );
      }
      if (
        next.vex.flip != null &&
        prev.vex.flip != null &&
        Math.abs(next.vex.flip - prev.vex.flip) >= 0.5
      ) {
        push(
          "vex",
          {
            icon: "level",
            tone: "warn",
            text: `VEX FLIP ${fmtPrice(prev.vex.flip)} → ${fmtPrice(next.vex.flip)}`,
            indent: 1,
          },
          `vex-flip-${prev.vex.flip}->${next.vex.flip}`
        );
      }
      if (
        next.vex.regime?.posture &&
        prev.vex.regime?.posture &&
        next.vex.regime.posture !== prev.vex.regime.posture
      ) {
        push(
          "vex",
          {
            icon: "pulse",
            tone: "warn",
            text: `VEX POSTURE ${prev.vex.regime.posture} → ${next.vex.regime.posture}`,
            indent: 1,
          },
          `vex-posture-${prev.vex.regime.posture}->${next.vex.regime.posture}`
        );
      }
    }
  }

  if (!seed && next.vex_shift?.available && next.vex_shift.wall_changes) {
    emitHeatmapWallChange(
      push,
      at,
      "VEX POS WALL",
      "bull",
      next.vex_shift.wall_changes.call_wall,
      "vex-pos"
    );
    emitHeatmapWallChange(
      push,
      at,
      "VEX NEG WALL",
      "bear",
      next.vex_shift.wall_changes.put_wall,
      "vex-neg"
    );
  }

  // DEX
  if (next.dex) {
    if (seed && next.dex.regime?.posture) {
      push(
        "dex",
        {
          icon: "level",
          tone: next.dex.regime.posture === "long" ? "bull" : "bear",
          text: `DEX POSTURE ${next.dex.regime.posture.toUpperCase()}${
            next.dex.zero_level != null ? ` · zero ${fmtPrice(next.dex.zero_level)}` : ""
          }`,
          indent: 1,
        },
        `dex-${next.dex.regime.posture}`
      );
    } else if (
      !seed &&
      prev?.dex?.regime?.posture &&
      next.dex.regime?.posture &&
      prev.dex.regime.posture !== next.dex.regime.posture
    ) {
      push(
        "dex",
        {
          icon: "level",
          tone: "warn",
          text: `DEX POSTURE ${prev.dex.regime.posture} → ${next.dex.regime.posture}`,
          indent: 1,
        },
        `dex-${prev.dex.regime.posture}->${next.dex.regime.posture}`
      );
    }
  }

  // CHARM
  if (next.charm) {
    if (seed && next.charm.regime?.posture) {
      push(
        "charm",
        {
          icon: "pulse",
          tone: next.charm.regime.posture === "positive" ? "bull" : "bear",
          text: `CHARM POSTURE ${next.charm.regime.posture.toUpperCase()}${
            next.charm.zero_level != null ? ` · zero ${fmtPrice(next.charm.zero_level)}` : ""
          }`,
          indent: 1,
        },
        `charm-${next.charm.regime.posture}`
      );
    } else if (
      !seed &&
      prev?.charm?.regime?.posture &&
      next.charm.regime?.posture &&
      prev.charm.regime.posture !== next.charm.regime.posture
    ) {
      push(
        "charm",
        {
          icon: "pulse",
          tone: "warn",
          text: `CHARM POSTURE ${prev.charm.regime.posture} → ${next.charm.regime.posture}`,
          indent: 1,
        },
        `charm-${prev.charm.regime.posture}->${next.charm.regime.posture}`
      );
    }
  }

  return events;
}

/** Night Hawk publish edge. */
export function diffNighthawkIntelEvents(
  prev: NightHawkEdition | null | undefined,
  next: NightHawkEdition | null | undefined
): OdteIntelEvent[] {
  if (!next?.available || next.stale) return [];
  const at = next.published_at || new Date().toISOString();
  const prevKey = prev?.available
    ? `${prev.edition_for ?? ""}|${prev.published_at ?? ""}`
    : "";
  const nextKey = `${next.edition_for ?? ""}|${next.published_at ?? ""}`;
  if (prevKey === nextKey) return [];

  const events: OdteIntelEvent[] = [];
  const push = (line: PlayTerminalLine, key: string) => {
    events.push({ id: `nighthawk|${key}|${at}`, at, kind: "nighthawk", line });
  };

  if (next.recap_only) {
    push(
      {
        icon: "news",
        tone: "accent",
        text: `NIGHT HAWK RECAP · ${next.recap_headline ?? next.edition_for ?? "published"}`,
        indent: 1,
      },
      `recap-${nextKey}`
    );
    return events;
  }

  push(
    {
      icon: "news",
      tone: "accent",
      text: `NIGHT HAWK PUBLISHED · ${next.plays.length} play${next.plays.length === 1 ? "" : "s"} · ${
        next.edition_for ?? ""
      }`,
      indent: 1,
    },
    `pub-${nextKey}`
  );

  const spx = next.plays.find((p) => /^(SPX|SPXW)$/i.test(p.ticker));
  const top = spx ?? next.plays[0];
  if (top) {
    push(
      {
        icon: "pulse",
        tone: /long|bull/i.test(top.direction) ? "bull" : /short|bear/i.test(top.direction) ? "bear" : "neutral",
        text: `NH #${top.rank} ${top.ticker} ${top.direction.toUpperCase()} · ${top.conviction}${
          top.target ? ` · tgt ${top.target}` : ""
        }`,
        indent: 1,
      },
      `play-${top.ticker}-${top.rank}-${nextKey}`
    );
  }

  return events;
}

/** Cap ring buffer; keep newest. */
export function appendOdteIntelEvents(
  existing: OdteIntelEvent[],
  incoming: OdteIntelEvent[],
  max = 60
): OdteIntelEvent[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing];
  for (const ev of incoming) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
  }
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export function odteIntelEventsToTerminalLines(events: OdteIntelEvent[]): PlayTerminalLine[] {
  if (!events.length) {
    return [
      {
        icon: "dim",
        tone: "dim",
        text: "Listening for 0DTE structure / greek / flow / NH edges…",
        indent: 1,
      },
    ];
  }
  return events.map((e) => e.line);
}

/** Map a full heatmap payload (or API JSON) into the intel slice. */
export function heatmapToIntelSlice(
  hm: {
    asof?: string;
    spot?: number;
    available?: boolean;
    events?: IntelHeatmapSlice["events"];
    shift?: IntelHeatmapSlice["shift"];
    vex_shift?: IntelHeatmapSlice["vex_shift"];
    gex?: IntelHeatmapSlice["gex"] & {
      flip?: number | null;
      total?: number;
      regime?: { posture?: string | null };
      strike_totals?: Record<string, number>;
    };
    vex?: IntelHeatmapSlice["vex"];
    dex?: IntelHeatmapSlice["dex"];
    charm?: IntelHeatmapSlice["charm"];
  } | null | undefined
): IntelHeatmapSlice | null {
  if (!hm) return null;
  if (hm.available === false) return null;
  return {
    asof: hm.asof,
    spot: hm.spot,
    events: hm.events,
    shift: hm.shift,
    vex_shift: hm.vex_shift,
    gex: hm.gex,
    vex: hm.vex,
    dex: hm.dex,
    charm: hm.charm,
  };
}

export type OdteIntelContext = {
  events: OdteIntelEvent[];
  /** Plain text lines for AI prompts (no terminal chrome). */
  lines: string[];
};

/**
 * Shared 0DTE intel context for Largo commentary + chat — same diffs as the
 * Playbook terminal, without any UI coupling.
 */
export function buildOdteIntelContext(opts: {
  prevDesk?: SpxDeskPayload | null;
  desk?: SpxDeskPayload | null;
  prevHeatmap?: IntelHeatmapSlice | null;
  heatmap?: IntelHeatmapSlice | null;
  prevNighthawk?: NightHawkEdition | null;
  nighthawk?: NightHawkEdition | null;
  /** First tick: seed structure/greek posture without flooding. */
  seed?: boolean;
}): OdteIntelContext {
  const seed = Boolean(opts.seed);
  const deskEvents = opts.desk
    ? diffOdteIntelEvents(opts.prevDesk ?? null, opts.desk, { seed })
    : [];
  const hmEvents = opts.heatmap
    ? diffHeatmapIntelEvents(opts.prevHeatmap ?? null, opts.heatmap, { seed })
    : [];
  // Night Hawk: never "seed" a static edition as a publish edge on first tick when
  // we already have prev — first-ever sighting still emits via prev=null.
  const nhEvents = diffNighthawkIntelEvents(opts.prevNighthawk ?? null, opts.nighthawk ?? null);
  const events = [...deskEvents, ...hmEvents, ...nhEvents];
  return {
    events,
    lines: events.map((e) => e.line.text),
  };
}
