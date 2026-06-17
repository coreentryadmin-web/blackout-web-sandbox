"use client";

import useSWR from "swr";
import { fetchSpxState, fmtPrice, fmtPct, fmtPremium, pctClass, type SpxState } from "@/lib/api";
import { clsx } from "clsx";
import { PlatformEmpty } from "@/components/platform/PlatformEmpty";

function StatCard({ label, value, sub, bull }: { label: string; value: string; sub?: string; bull?: boolean | null }) {
  return (
    <div className="card p-5">
      <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-2">{label}</p>
      <p className={clsx("font-mono text-2xl font-semibold", bull === true ? "num-bull" : bull === false ? "num-bear" : "text-white")}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-text-muted mt-1">{sub}</p>}
    </div>
  );
}

function LevelRow({ label, value }: { label: string; value: number | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-surface-1 last:border-0">
      <span className="text-[11px] tracking-[1px] text-text-muted">{label}</span>
      <span className="font-mono text-[13px] text-text-primary">{fmtPrice(value)}</span>
    </div>
  );
}

export function SpxDashboard() {
  const { data, isLoading, error } = useSWR<SpxState>("spx-state", fetchSpxState, {
    refreshInterval: 15_000,
  });

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data?.available) {
    return (
      <PlatformEmpty
        variant="dashboard"
        title="ENGINE STANDBY"
        description="SPX intel loads during RTH — 9:30 AM to 4:00 PM ET. GEX, VWAP, flow, and levels populate live when the market opens."
      />
    );
  }

  const s = data;
  const levels = s.chart_levels;
  const flowNet = s.flow_0dte_net;
  const flowBull = flowNet != null ? flowNet > 0 : null;

  return (
    <div className="space-y-6">
      {/* Top row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-surface-2">
        <StatCard label="SPX Price" value={fmtPrice(s.price)} bull={s.spx_change_pct >= 0} sub={fmtPct(s.spx_change_pct)} />
        <StatCard label="VWAP" value={fmtPrice(s.vwap)} sub={s.above_vwap ? "▲ Above VWAP" : "▼ Below VWAP"} bull={s.above_vwap} />
        <StatCard label="VIX" value={fmtPrice(s.vix, 2)} bull={s.vix_change_pct <= 0} sub={fmtPct(s.vix_change_pct)} />
        <StatCard label="IV Rank" value={s.uw_iv_rank != null ? `${s.uw_iv_rank}` : "—"} sub="UW IV Rank" />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-surface-2">
        <StatCard label="Session LOD" value={fmtPrice(s.lod)} />
        <StatCard label="Session HOD" value={fmtPrice(s.hod)} />
        <StatCard label="GEX Net" value={fmtPremium(s.gex_net)} bull={s.gex_net != null ? s.gex_net > 0 : null} sub={s.gex_king ? `King: ${fmtPrice(s.gex_king)}` : undefined} />
        <StatCard label="Max Pain" value={s.max_pain ? fmtPrice(s.max_pain) : "—"} sub={s.gamma_flip ? `γ Flip: ${fmtPrice(s.gamma_flip)}` : undefined} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Chart levels */}
        <div className="card p-5">
          <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-4">Key Levels</p>
          <LevelRow label="Session HOD" value={s.hod} />
          <LevelRow label="PDH" value={levels.pdh} />
          <LevelRow label="VAH" value={levels.vah} />
          <LevelRow label="VWAP" value={s.vwap} />
          <LevelRow label="POC" value={levels.poc} />
          <LevelRow label="VAL" value={levels.val} />
          <LevelRow label="PDL" value={levels.pdl} />
          <LevelRow label="Session LOD" value={s.lod} />
        </div>

        {/* Fib + EMAs */}
        <div className="card p-5">
          <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-4">Fibs & EMAs</p>
          <LevelRow label="ONH" value={levels.onh} />
          <LevelRow label="Fib 38.2%" value={levels.fib_382} />
          <LevelRow label="Fib 50%" value={levels.fib_50} />
          <LevelRow label="Fib 61.8%" value={levels.fib_618} />
          <LevelRow label="ONL" value={levels.onl} />
          <LevelRow label="EMA 20" value={levels.ema20} />
          <LevelRow label="EMA 50" value={levels.ema50} />
          <LevelRow label="EMA 200" value={levels.ema200} />
        </div>

        {/* Flow + Breadth + Regime */}
        <div className="space-y-4">
          <div className="card p-5">
            <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-3">0DTE Flow</p>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] text-text-muted">Calls</span>
              <span className="font-mono text-[13px] num-bull">{fmtPremium(s.flow_0dte_call_premium)}</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] text-text-muted">Puts</span>
              <span className="font-mono text-[13px] num-bear">{fmtPremium(s.flow_0dte_put_premium)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-surface-1">
              <span className="text-[11px] text-text-muted">Net</span>
              <span className={clsx("font-mono text-[13px] font-semibold", flowBull ? "num-bull" : "num-bear")}>
                {fmtPremium(flowNet)}
              </span>
            </div>
          </div>

          <div className="card p-5">
            <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-3">Breadth</p>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] text-text-muted">A/D</span>
              <span className="font-mono text-[13px]">
                <span className="num-bull">{s.adv ?? "—"}</span>
                <span className="text-surface-4">/</span>
                <span className="num-bear">{s.dec ?? "—"}</span>
              </span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] text-text-muted">TRIN</span>
              <span className="font-mono text-[13px] text-text-primary">{s.trin?.toFixed(2) ?? "—"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-text-muted">TICK</span>
              <span className={clsx("font-mono text-[13px]", (s.tick ?? 0) >= 0 ? "num-bull" : "num-bear")}>
                {s.tick != null ? (s.tick >= 0 ? `+${s.tick}` : `${s.tick}`) : "—"}
              </span>
            </div>
          </div>

          <div className="card p-5">
            <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-2">Regime</p>
            <p className="text-[13px] text-text-primary capitalize">{levels.regime ?? "—"}</p>
            <p className="text-[10px] text-text-muted mt-2 uppercase tracking-[1px]">
              {s.sector_bias ?? "—"} sectors
            </p>
          </div>
        </div>
      </div>

      {/* Sectors */}
      {(s.sector_leaders.length > 0 || s.sector_laggards.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-5">
            <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-3">Leading Sectors</p>
            {s.sector_leaders.slice(0, 4).map((sec) => (
              <div key={sec.sector} className="flex justify-between items-center py-2 border-b border-surface-1 last:border-0">
                <span className="text-[12px] text-text-secondary">{sec.sector}</span>
                <span className="font-mono text-[12px] num-bull">{fmtPct(sec.change_pct)}</span>
              </div>
            ))}
          </div>
          <div className="card p-5">
            <p className="text-[10px] tracking-[2px] uppercase text-text-muted mb-3">Lagging Sectors</p>
            {s.sector_laggards.slice(0, 4).map((sec) => (
              <div key={sec.sector} className="flex justify-between items-center py-2 border-b border-surface-1 last:border-0">
                <span className="text-[12px] text-text-secondary">{sec.sector}</span>
                <span className="font-mono text-[12px] num-bear">{fmtPct(sec.change_pct)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-4 gap-px bg-surface-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-black p-5 h-24" />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-px bg-surface-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-black p-5 h-20" />
        ))}
      </div>
    </div>
  );
}
