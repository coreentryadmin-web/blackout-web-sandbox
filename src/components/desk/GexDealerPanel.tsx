"use client";

import { Panel, Badge } from "@/components/ui";
import type { SpxState } from "@/lib/api";
import { fmtPremium, fmtPrice } from "@/lib/api";
import { clsx } from "clsx";

/** Live / offline status pill — mirrors the legacy DeskPanel `live` indicator. */
function FeedBadge({ live }: { live?: boolean }) {
  return live ? (
    <Badge tone="bull" dot>
      Live
    </Badge>
  ) : (
    <Badge tone="neutral">Offline</Badge>
  );
}

export function GexDealerPanel({ data, live }: { data?: SpxState; live?: boolean }) {
  // Gate direction on ACTUAL data presence — a null/offline GEX must read neutral,
  // never a fabricated bearish (gex ?? 0 > 0 === false) value/meter.
  const hasGex = live && data?.gex_net != null;
  const gexBull = hasGex && (data!.gex_net as number) > 0;
  const pct = hasGex ? Math.min(100, (Math.abs(data!.gex_net as number) / 5e9) * 100) : 12;

  return (
    <Panel
      accent="bull"
      kicker="GEX · Max pain · Gamma flip"
      title="Dealer Positioning"
      actions={<FeedBadge live={live} />}
    >
      <div className="space-y-5" role="status" aria-live="polite" aria-label="Dealer positioning levels">

        <div>
          <div className="flex justify-between text-[10px] font-mono uppercase tracking-widest text-sky-300 mb-2">
            <span>Net GEX</span>
            <span className={!hasGex ? "text-sky-300" : gexBull ? "text-bull" : "text-bear"}>
              {hasGex ? fmtPremium(data?.gex_net ?? null) : "—"}
            </span>
          </div>
          <div className="desk-meter">
            <div
              className={clsx(
                "desk-meter-fill",
                !hasGex
                  ? "bg-gradient-to-r from-sky-400/20 to-sky-400/40"
                  : gexBull
                    ? "desk-meter-bull"
                    : "desk-meter-bear"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="GEX Anchor" value={live ? fmtPrice(data?.gex_king ?? null) : "—"} />
          <Metric label="Max Pain" value={live ? fmtPrice(data?.max_pain ?? null) : "—"} />
          <Metric label="Gamma Flip" value={live ? fmtPrice(data?.gamma_flip ?? null) : "—"} />
          <Metric label="Tide" value={live ? (data?.tide_bias ?? "—") : "—"} accent />
        </div>
      </div>
    </Panel>
  );
}

export function Flow0dtePanel({ data, live }: { data?: SpxState; live?: boolean }) {
  const calls = data?.flow_0dte_call_premium ?? 0;
  const puts = data?.flow_0dte_put_premium ?? 0;
  const total = calls + puts || 1;
  const callPct = (calls / total) * 100;
  // Gate Net color on actual data — a null net must read neutral, not a
  // fabricated bullish (null ?? 0 >= 0 === true) tint next to a "—" value.
  const hasNet = live && data?.flow_0dte_net != null;
  const netBull = hasNet && (data!.flow_0dte_net as number) >= 0;

  return (
    <Panel
      accent="accent"
      kicker="Calls vs puts"
      title="0DTE Flow"
      actions={<FeedBadge live={live} />}
    >
      <div className="space-y-4">
        <div className="desk-flow-split">
          <div className="desk-flow-calls" style={{ width: `${callPct}%` }} />
        </div>
        <div className="flex justify-between font-mono text-xs">
          <span className="text-bull">Calls {live ? fmtPremium(data?.flow_0dte_call_premium ?? null) : "—"}</span>
          <span className="text-bear">Puts {live ? fmtPremium(data?.flow_0dte_put_premium ?? null) : "—"}</span>
        </div>
        <div className="text-center font-mono text-lg font-bold">
          <span className={!hasNet ? "text-sky-300" : netBull ? "num-bull" : "num-bear"}>
            Net {hasNet ? fmtPremium(data?.flow_0dte_net ?? null) : "—"}
          </span>
        </div>
      </div>
    </Panel>
  );
}

export function BreadthPanel({ data, live }: { data?: SpxState; live?: boolean }) {
  return (
    <Panel
      accent="sky"
      kicker="Internals"
      title="Market Breadth"
      actions={<FeedBadge live={live} />}
    >
      <div className="grid grid-cols-2 gap-4">
        <Metric label="A/D" value={live ? `${data?.adv ?? "—"}/${data?.dec ?? "—"}` : "—"} />
        <Metric label="TRIN" value={live && data?.trin != null ? data.trin.toFixed(2) : "—"} />
        <Metric label="TICK" value={live && data?.tick != null ? (data.tick >= 0 ? `+${data.tick}` : String(data.tick)) : "—"} />
        <Metric label="Sectors" value={live ? (data?.sector_bias ?? "—") : "—"} accent />
      </div>
    </Panel>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="desk-metric">
      <p className="text-[10px] tracking-widest uppercase text-cyan-400 mb-1">{label}</p>
      <p className={clsx("font-mono text-sm font-semibold capitalize", accent ? "text-bull" : "text-white")}>
        {value}
      </p>
    </div>
  );
}
