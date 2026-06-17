"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { useLiveSpxTape } from "@/hooks/useLiveSpxTape";
import { useStableArray, useStableValue } from "@/hooks/useStableValue";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";

type DeskProps = { desk?: SpxDeskPayload; live?: boolean; refreshing?: boolean };

function Panel({
  title,
  subtitle,
  accent,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  accent: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("spx-desk-panel", accent, className)}>
      <div className="spx-desk-panel-header">
        <span className="badge-live-dot animate-pulse" />
        <div>
          <p className="font-syne text-xs tracking-[0.12em] uppercase font-bold">{title}</p>
          {subtitle && (
            <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-grey-500 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="spx-desk-panel-body">{children}</div>
    </div>
  );
}

const LEADER_TICKERS = ["AAPL", "NVDA", "MSFT", "GOOG", "TSLA", "META"] as const;

export function SpxIntelStrip({ desk, live }: DeskProps) {
  const byTicker = new Map((desk?.leader_stocks ?? []).map((s) => [s.ticker, s]));
  const stocks = LEADER_TICKERS.map(
    (ticker) => byTicker.get(ticker) ?? { ticker, name: ticker, change_pct: 0 }
  );

  return (
    <div className="spx-intel-strip">
      {stocks.map((s) => {
        const hasData = live && byTicker.has(s.ticker);
        const up = s.change_pct >= 0;
        return (
          <div
            key={s.ticker}
            className={clsx(
              "spx-intel-chip spx-stock-chip",
              hasData && (up ? "spx-stock-chip-bull" : "spx-stock-chip-bear")
            )}
          >
            <span className="spx-intel-ticker">{s.ticker}</span>
            <span
              className={clsx(
                "font-mono text-sm tabular-nums font-semibold",
                !hasData && "text-grey-500",
                hasData && (up ? "num-bull" : "num-bear")
              )}
            >
              {hasData ? fmtPct(s.change_pct) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SpxDarkPoolCard({ desk, live }: DeskProps) {
  const dp = desk?.dark_pool;
  const prints = dp?.prints ?? [];

  return (
    <Panel title="Dark Pool" subtitle="SPX · institutional prints" accent="spx-panel-amber">
      {!live || !prints.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">{dp?.detail ?? "No prints"}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span
              className={clsx(
                "spx-desk-bias-pill",
                dp?.bias === "bullish" && "spx-bias-bull",
                dp?.bias === "bearish" && "spx-bias-bear",
                dp?.bias === "mixed" && "spx-bias-neutral"
              )}
            >
              {dp?.bias}
            </span>
            <span className="font-mono text-xs text-grey-400 tabular-nums">
              {fmtPremium(dp?.total_premium ?? 0)}
              {dp?.pcr != null ? ` · PCR ${dp.pcr}` : ""}
            </span>
          </div>
          <ul className="spx-desk-list">
            {prints.slice(0, 6).map((p, i) => (
              <li key={`${p.executed_at}-${i}`} className="spx-desk-list-row">
                <span className="text-grey-500 font-mono text-[10px]">
                  {new Date(p.executed_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="font-mono text-xs text-white tabular-nums">
                  {p.strike > 0 ? fmtPrice(p.strike) : "—"}
                </span>
                <span className="font-mono text-xs text-amber-300 tabular-nums ml-auto">
                  {fmtPremium(p.premium)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function tapeSideClass(t: { kind: string; side: string }) {
  if (t.kind === "darkpool") return { tag: "DP", tagClass: "text-amber-300", labelClass: "text-zinc-200" };
  if (t.side === "put") return { tag: "PUT", tagClass: "text-bear", labelClass: "text-bear" };
  return { tag: "CALL", tagClass: "text-bull", labelClass: "text-bull" };
}

export function SpxGexLadder({ desk, refreshing }: DeskProps) {
  const walls = useStableArray(desk?.gex_walls ?? []);
  const gammaFlip = useStableValue(desk?.gamma_flip, (v) => v != null);
  const gammaRegime = useStableValue(desk?.gamma_regime, (v) => Boolean(v && v !== "unknown"));
  const spot = desk?.price ?? null;
  const hasWalls = walls.length > 0;

  return (
    <Panel
      title="GEX Walls"
      subtitle={spot != null ? `0DTE nodes · spot ${fmtPrice(spot)}` : "0DTE gamma nodes"}
      accent="spx-panel-gold"
      className={clsx(refreshing && hasWalls && "spx-desk-panel-refreshing")}
    >
      {!hasWalls ? (
        <p className="font-mono text-[11px] text-grey-500 py-2 spx-gex-ladder-empty">
          Loading gamma ladder…
        </p>
      ) : (
        <ul className="spx-desk-list spx-gex-ladder-list">
          {walls.map((w) => {
            const dist =
              w.distance_pts ??
              (spot != null ? Math.round((w.strike - spot) * 100) / 100 : null);
            return (
              <li
                key={`${w.kind}-${w.strike}`}
                className={clsx(
                  "spx-desk-list-row border-l-2",
                  w.kind === "support" ? "border-l-emerald-500/50" : "border-l-rose-500/50"
                )}
              >
                <span className="font-mono text-[10px] uppercase text-grey-500 w-16">{w.kind}</span>
                <span className="font-mono text-sm text-white tabular-nums">{fmtPrice(w.strike)}</span>
                {dist != null && (
                  <span
                    className={clsx(
                      "font-mono text-[10px] tabular-nums",
                      dist >= 0 ? "text-rose-300/80" : "text-emerald-300/80"
                    )}
                  >
                    {dist >= 0 ? "+" : ""}
                    {dist.toFixed(0)} pts
                  </span>
                )}
                <span
                  className={clsx(
                    "font-mono text-xs tabular-nums ml-auto",
                    w.net_gex >= 0 ? "num-bull" : "num-bear"
                  )}
                >
                  {fmtPremium(w.net_gex)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {gammaFlip != null && (
        <p className="font-mono text-[10px] text-grey-400 mt-2 pt-2 border-t border-white/5">
          γ flip {fmtPrice(gammaFlip)}
          {gammaRegime && gammaRegime !== "unknown"
            ? ` · ${String(gammaRegime).replace("_", " ")}`
            : ""}
        </p>
      )}
    </Panel>
  );
}

export function SpxUnifiedTape({ desk, refreshing }: DeskProps) {
  const tape = useLiveSpxTape(desk?.unified_tape);
  const hasTape = tape.length > 0;

  return (
    <Panel
      title="Live Tape"
      subtitle="Flow + dark pool"
      accent="spx-panel-cyan"
      className={clsx(
        "spx-tape-panel spx-left-tape-panel",
        refreshing && hasTape && "spx-desk-panel-refreshing"
      )}
    >
      {!hasTape ? (
        <p className="font-mono text-[11px] text-grey-500 py-2 spx-tape-empty">Tape quiet…</p>
      ) : (
        <ul className="spx-desk-list spx-tape-list">
          {tape.map((t, i) => {
            const side = tapeSideClass(t);
            return (
              <li key={`${t.kind}-${t.time}-${t.label}-${i}`} className="spx-desk-list-row">
                <span
                  className={clsx(
                    "font-mono text-[9px] uppercase tracking-wider w-12 shrink-0 font-bold",
                    side.tagClass
                  )}
                >
                  {side.tag}
                </span>
                <span className="font-mono text-[10px] text-grey-500 shrink-0">
                  {t.time
                    ? new Date(t.time).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}
                </span>
                <span className={clsx("font-mono text-xs truncate font-semibold", side.labelClass)}>
                  {t.label}
                </span>
                <span
                  className={clsx(
                    "font-mono text-xs tabular-nums ml-auto shrink-0",
                    t.side === "put" ? "text-bear" : t.side === "call" ? "text-bull" : "text-grey-200"
                  )}
                >
                  {fmtPremium(t.premium)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function SpxNetPremSpark({ desk, live }: DeskProps) {
  const ticks = desk?.net_prem_ticks ?? [];
  const values = ticks.map((t) => t.net);
  const max = Math.max(...values.map(Math.abs), 1);
  const w = 200;
  const h = 48;
  const points =
    values.length > 1
      ? values
          .map((v, i) => {
            const x = (i / (values.length - 1)) * w;
            const y = h / 2 - (v / max) * (h / 2 - 4);
            return `${x},${y}`;
          })
          .join(" ")
      : "";

  const last = values[values.length - 1];

  return (
    <Panel title="Net Prem Ticks" subtitle="SPY velocity" accent="spx-panel-teal">
      {!live || values.length < 2 ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">Building tick series…</p>
      ) : (
        <div className="flex items-center gap-3">
          <svg viewBox={`0 0 ${w} ${h}`} className="spx-sparkline flex-1">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-teal-400"
              points={points}
            />
          </svg>
          <span
            className={clsx(
              "font-mono text-sm font-semibold tabular-nums shrink-0",
              (last ?? 0) >= 0 ? "num-bull" : "num-bear"
            )}
          >
            {fmtPremium(last ?? 0)}
          </span>
        </div>
      )}
    </Panel>
  );
}

export function SpxIvTermBars({ desk, live }: DeskProps) {
  const curve = desk?.iv_term_structure ?? [];
  const maxIv = Math.max(...curve.map((p) => p.iv), 1);

  return (
    <Panel title="IV Term" subtitle="Implied vol curve" accent="spx-panel-violet">
      {!live || !curve.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">IV curve loading…</p>
      ) : (
        <div className="spx-iv-bars">
          {curve.map((p) => (
            <div key={p.expiry} className="spx-iv-bar-col">
              <div
                className="spx-iv-bar-fill"
                style={{ height: `${Math.max(8, (p.iv / maxIv) * 100)}%` }}
                title={`${p.iv.toFixed(1)}%`}
              />
              <span className="font-mono text-[8px] text-grey-500 mt-1">{p.expiry.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function SpxOiChangeStrip({ desk, live }: DeskProps) {
  const items = desk?.oi_changes ?? [];

  return (
    <Panel title="OI Change" subtitle="Strike OI shifts" accent="spx-panel-rose">
      {!live || !items.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">No OI shifts flagged</p>
      ) : (
        <ul className="spx-desk-list">
          {items.slice(0, 6).map((o, i) => (
            <li key={`${o.strike}-${i}`} className="spx-desk-list-row">
              <span className="font-mono text-xs text-white tabular-nums">{fmtPrice(o.strike)}</span>
              <span className="font-mono text-[10px] text-grey-500 uppercase">{o.kind}</span>
              <span
                className={clsx(
                  "font-mono text-xs tabular-nums ml-auto",
                  o.oi_change >= 0 ? "num-bull" : "num-bear"
                )}
              >
                {o.oi_change >= 0 ? "+" : ""}
                {o.oi_change.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function OdteFlowBar({ desk, live }: { desk?: SpxDeskPayload; live?: boolean }) {
  const calls = desk?.flow_0dte_call_premium ?? 0;
  const puts = desk?.flow_0dte_put_premium ?? 0;
  const total = calls + puts || 1;
  const callPct = (calls / total) * 100;

  if (!live) return null;

  return (
    <div className="spx-odte-bar-wrap">
      <div className="flex justify-between font-mono text-[10px] mb-1">
        <span className="text-bull">0DTE Calls {fmtPremium(calls)}</span>
        <span className="text-bear">Puts {fmtPremium(puts)}</span>
      </div>
      <div className="spx-odte-bar">
        <div className="spx-odte-bar-call" style={{ width: `${callPct}%` }} />
      </div>
    </div>
  );
}
