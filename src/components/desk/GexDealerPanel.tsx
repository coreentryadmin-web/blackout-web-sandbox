"use client";

import { DeskPanel } from "./DeskPanel";
import type { SpxState } from "@/lib/api";
import { fmtPremium, fmtPrice } from "@/lib/api";
import { clsx } from "clsx";

export function GexDealerPanel({ data, live }: { data?: SpxState; live?: boolean }) {
  const gex = data?.gex_net ?? 0;
  const gexBull = gex > 0;
  const pct = live && data?.gex_net != null ? Math.min(100, Math.abs(gex) / 5e9 * 100) : 12;

  return (
    <DeskPanel title="Dealer Positioning" subtitle="GEX · Max pain · Gamma flip" variant="green" live={live}>
      <div className="space-y-5">
        <div>
          <div className="flex justify-between text-[10px] font-mono uppercase tracking-widest text-sky-300 mb-2">
            <span>Net GEX</span>
            <span className={gexBull ? "text-bull" : "text-bear"}>
              {live ? fmtPremium(data?.gex_net ?? null) : "—"}
            </span>
          </div>
          <div className="desk-meter">
            <div
              className={clsx("desk-meter-fill", gexBull ? "desk-meter-bull" : "desk-meter-bear")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="GEX King" value={live ? fmtPrice(data?.gex_king ?? null) : "—"} />
          <Metric label="Max Pain" value={live ? fmtPrice(data?.max_pain ?? null) : "—"} />
          <Metric label="Gamma Flip" value={live ? fmtPrice(data?.gamma_flip ?? null) : "—"} />
          <Metric label="Tide" value={live ? (data?.tide_bias ?? "—") : "—"} accent />
        </div>
      </div>
    </DeskPanel>
  );
}

export function Flow0dtePanel({ data, live }: { data?: SpxState; live?: boolean }) {
  const calls = data?.flow_0dte_call_premium ?? 0;
  const puts = data?.flow_0dte_put_premium ?? 0;
  const total = calls + puts || 1;
  const callPct = (calls / total) * 100;

  return (
    <DeskPanel title="0DTE Flow" subtitle="Calls vs puts" variant="purple" live={live}>
      <div className="space-y-4">
        <div className="desk-flow-split">
          <div className="desk-flow-calls" style={{ width: `${callPct}%` }} />
        </div>
        <div className="flex justify-between font-mono text-xs">
          <span className="text-bull">Calls {live ? fmtPremium(data?.flow_0dte_call_premium ?? null) : "—"}</span>
          <span className="text-bear">Puts {live ? fmtPremium(data?.flow_0dte_put_premium ?? null) : "—"}</span>
        </div>
        <div className="text-center font-mono text-lg font-bold">
          <span className={(data?.flow_0dte_net ?? 0) >= 0 ? "num-bull" : "num-bear"}>
            Net {live ? fmtPremium(data?.flow_0dte_net ?? null) : "—"}
          </span>
        </div>
      </div>
    </DeskPanel>
  );
}

export function BreadthPanel({ data, live }: { data?: SpxState; live?: boolean }) {
  return (
    <DeskPanel title="Market Breadth" subtitle="Internals" variant="neutral" live={live}>
      <div className="grid grid-cols-2 gap-4">
        <Metric label="A/D" value={live ? `${data?.adv ?? "—"}/${data?.dec ?? "—"}` : "—"} />
        <Metric label="TRIN" value={live && data?.trin != null ? data.trin.toFixed(2) : "—"} />
        <Metric label="TICK" value={live && data?.tick != null ? (data.tick >= 0 ? `+${data.tick}` : String(data.tick)) : "—"} />
        <Metric label="Sectors" value={live ? (data?.sector_bias ?? "—") : "—"} accent />
      </div>
    </DeskPanel>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="desk-metric">
      <p className="text-[9px] tracking-widest uppercase text-cyan-400 mb-1">{label}</p>
      <p className={clsx("font-mono text-sm font-semibold capitalize", accent ? "text-bull" : "text-white")}>
        {value}
      </p>
    </div>
  );
}
