"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";

type GexRegimeData = {
  available: boolean;
  ticker?: string;
  spot?: number;
  flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  gamma_posture?: string | null;
  gamma_regime_read?: string;
  net_gex?: number;
  vanna_posture?: string | null;
  charm_posture?: string | null;
  distance_to_flip_pct?: number | null;
  nearest_wall?: { strike: number; kind: string; distance_pts: number } | null;
};

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<GexRegimeData>;

function fmtLevel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function PostureTag({ posture, kind }: { posture: string | null | undefined; kind: "gamma" | "vanna" | "charm" }) {
  if (!posture) return null;
  const s = posture.toLowerCase();
  const isPos = s === "long" || s === "positive";
  const isNeg = s === "short" || s === "negative";
  return (
    <span
      className={clsx(
        "grid-tag text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded",
        isPos
          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
          : isNeg
          ? "bg-red-500/20 text-red-400 border border-red-500/30"
          : "bg-sky-500/20 text-sky-300 border border-sky-500/30"
      )}
    >
      {kind === "gamma" ? "γ" : kind === "vanna" ? "ν" : "θ"} {posture}
    </span>
  );
}

function RegimeRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
      <span className="text-sky-400 text-[11px] font-medium uppercase tracking-wide">{label}</span>
      <span className={clsx("text-[12px] font-mono tabular-nums", accent ? "text-cyan-400" : "text-white")}>
        {value}
      </span>
    </div>
  );
}

/**
 * GridGexPanel — GEX Dealer Regime tile for the BlackOut Grid.
 *
 * Shows the live gamma flip level, current posture (negative/pin/trending),
 * call wall, put wall, and charm/vanna posture from the shared GEX matrix cache
 * (same data the Heatmaps tool shows). Polls /api/market/gex-positioning?ticker=SPX
 * every 30 seconds (the route itself is cache-reader — no upstream pressure).
 */
export function GridGexPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const gexTicker = ticker ?? "SPX";
  const url = `/api/market/gex-positioning?ticker=${gexTicker}`;
  const { data, error } = useSWR<GexRegimeData>(url, fetcher, { refreshInterval: 30_000 });

  const available = !error && (data?.available ?? false);
  const live = available && data?.spot != null;

  const regimeLabel = (() => {
    if (!data?.gamma_posture) return "—";
    const p = data.gamma_posture.toLowerCase();
    if (p === "short") return "NEGATIVE GAMMA";
    if (p === "long") return "POSITIVE GAMMA";
    return data.gamma_posture.toUpperCase();
  })();

  const distLabel = data?.distance_to_flip_pct != null
    ? `${data.distance_to_flip_pct >= 0 ? "+" : ""}${data.distance_to_flip_pct.toFixed(2)}% from flip`
    : null;

  return (
    <GridCard
      title="GEX Regime"
      kicker="DEALER"
      accent="sky"
      live={live}
      footer={
        <span className="grid-foot-note">
          Polygon/Massive matrix · {gexTicker} · {!data ? "loading…" : data.available ? "live" : "unavailable"}
        </span>
      }
    >
      {isFiltered && ticker && (
        <p className="grid-ticker-badge">GEX regime for {ticker}</p>
      )}
      {!data && !error ? (
        <p className="grid-empty">Loading GEX regime…</p>
      ) : error || !available ? (
        <p className="grid-empty">GEX data unavailable</p>
      ) : (
        <div className="flex flex-col gap-1 px-0.5">
          {/* Regime headline */}
          <div className="flex items-center gap-2 mb-1">
            <span
              className={clsx(
                "text-[13px] font-bold tracking-wide",
                data?.gamma_posture?.toLowerCase() === "short"
                  ? "text-red-400"
                  : data?.gamma_posture?.toLowerCase() === "long"
                  ? "text-emerald-400"
                  : "text-sky-300"
              )}
            >
              {regimeLabel}
            </span>
            {distLabel && (
              <span className="text-sky-400 text-[10px] font-mono">{distLabel}</span>
            )}
          </div>

          {/* Posture tags */}
          <div className="flex gap-1 flex-wrap mb-1">
            <PostureTag posture={data?.gamma_posture} kind="gamma" />
            <PostureTag posture={data?.vanna_posture} kind="vanna" />
            <PostureTag posture={data?.charm_posture} kind="charm" />
          </div>

          {/* Level rows */}
          <RegimeRow label="Gamma Flip" value={fmtLevel(data?.flip)} accent />
          <RegimeRow label="Call Wall" value={fmtLevel(data?.call_wall)} />
          <RegimeRow label="Put Wall" value={fmtLevel(data?.put_wall)} />
          {data?.spot != null && (
            <RegimeRow label={gexTicker === "SPX" ? "SPX Spot" : `${gexTicker} Spot`} value={fmtLevel(data.spot)} />
          )}

          {/* Nearest wall */}
          {data?.nearest_wall && (
            <div className="pt-1 text-[11px] text-sky-300">
              Nearest wall:{" "}
              <span className="text-white font-mono">{data.nearest_wall.strike}</span>{" "}
              <span className="text-sky-400">
                ({data.nearest_wall.kind},{" "}
                {data.nearest_wall.distance_pts >= 0 ? "+" : ""}
                {data.nearest_wall.distance_pts} pts)
              </span>
            </div>
          )}

          {/* Regime read */}
          {data?.gamma_regime_read && (
            <div className="pt-1 text-[11px] text-sky-300 italic leading-snug">
              {data.gamma_regime_read}
            </div>
          )}
        </div>
      )}
    </GridCard>
  );
}
