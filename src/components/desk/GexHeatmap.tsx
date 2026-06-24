"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import {
  Panel,
  Badge,
  Stat,
  EmptyState,
  Skeleton,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from "@/components/ui";

/** Regime read derived server-side from spot vs the gamma flip. */
type GexRegime = {
  flip: number | null;
  posture: "long" | "short" | null;
  read: string;
};

/** Net dealer dollar-gamma matrix + regime levels from /api/market/gex-heatmap. */
type GexHeatmapResponse = {
  available: boolean;
  underlying?: string;
  spot?: number;
  change_pct?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  cells?: Record<string, Record<string, number>>;
  strike_totals?: Record<string, number>;
  zero_gamma_flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  max_pain?: number | null;
  regime?: GexRegime;
  total_gex?: number;
  error?: string;
};

async function fetchGexHeatmap(url: string): Promise<GexHeatmapResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GEX heatmap → ${res.status}`);
  return res.json();
}

/** Compact signed dollar-gamma: $22.1K / -$45.2M. */
function fmtGamma(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs < 1) return "·";
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** Compact strike label, e.g. "740" or "5,925". */
function fmtStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Format an expiry (YYYY-MM-DD) as a compact column header, e.g. "Jun 27". */
function fmtExpiry(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

/**
 * Cell background: green (positive dealer gamma) ↔ violet/purple (negative), opacity
 * scaled by magnitude relative to the matrix peak. Brand tokens only (bull / purple),
 * never grey. Returns an inline style so the alpha can vary continuously.
 */
function cellStyle(value: number, peak: number): React.CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  // Ease so small values still read; floor at 0.08 alpha, ceil ~0.6.
  const alpha = 0.08 + Math.pow(mag, 0.7) * 0.52;
  // bull #00e676 / purple #bf5fff
  const rgb = value > 0 ? "0,230,118" : "191,95,255";
  return {
    backgroundColor: `rgba(${rgb},${alpha.toFixed(3)})`,
    boxShadow: mag > 0.6 ? `inset 0 0 14px rgba(${rgb},0.25)` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Gamma profile (the hero) — vertical strike ladder of net gamma bars
// ---------------------------------------------------------------------------

type ProfileRow = {
  strike: number;
  gamma: number;
  isSpot: boolean;
  isFlip: boolean;
  isCallWall: boolean;
  isPutWall: boolean;
};

function GammaProfile({
  rows,
  peak,
  spot,
  flip,
}: {
  rows: ProfileRow[];
  peak: number;
  spot: number;
  flip: number | null;
}) {
  // Index of the divider: drawn ABOVE the first row (strikes desc) whose strike < flip,
  // i.e. between the two strikes the cumulative gamma crosses zero.
  const flipBoundary = useMemo(() => {
    if (flip == null) return -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].strike < flip) return i;
    }
    return -1;
  }, [rows, flip]);

  return (
    <div
      role="img"
      aria-label="Net dealer gamma profile by strike — positive bars (green) right of center, negative (violet) left"
      className="space-y-px"
    >
      {rows.map((r, i) => {
        const mag = peak > 0 ? Math.min(1, Math.abs(r.gamma) / peak) : 0;
        const widthPct = (mag * 50).toFixed(2); // each side spans up to 50% of the row
        const positive = r.gamma > 0;
        const barColor = positive ? "#00e676" : "#bf5fff";
        const wall = r.isCallWall || r.isPutWall;
        return (
          <div key={r.strike}>
            {/* gamma-flip divider between the bracketing strikes */}
            {flip != null && i === flipBoundary && (
              <div className="flex items-center gap-2 py-1" aria-hidden>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_10px_#ffd23f]" />
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold">
                  γ flip {fmtStrike(flip)}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_10px_#ffd23f]" />
              </div>
            )}

            <div
              className={clsx(
                "group relative flex items-center gap-2 rounded-sm py-0.5 pr-1",
                r.isSpot && "outline outline-1 outline-cyan-400/70 bg-cyan-400/[0.06]"
              )}
              title={`${fmtStrike(r.strike)} · ${fmtGamma(r.gamma)}`}
            >
              {/* strike label (left gutter) */}
              <span
                className={clsx(
                  "w-14 shrink-0 text-right font-mono text-[11px] tabular-nums",
                  r.isSpot
                    ? "font-bold text-white"
                    : wall
                      ? "font-semibold text-gold"
                      : "text-sky-300"
                )}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  {r.isSpot && <span className="text-cyan-400">●</span>}
                  {fmtStrike(r.strike)}
                </span>
              </span>

              {/* bipolar bar track with a center axis */}
              <span className="relative h-4 flex-1">
                {/* center axis */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15"
                />
                {/* the bar — negative grows left, positive grows right */}
                <span
                  aria-hidden
                  className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px]"
                  style={{
                    width: `${widthPct}%`,
                    left: positive ? "50%" : undefined,
                    right: positive ? undefined : "50%",
                    backgroundColor: barColor,
                    boxShadow: wall
                      ? `0 0 10px ${barColor}`
                      : mag > 0.55
                        ? `0 0 8px ${barColor}88`
                        : undefined,
                    opacity: 0.35 + mag * 0.6,
                  }}
                />
              </span>

              {/* signed value + wall tag (right gutter) */}
              <span
                className={clsx(
                  "w-20 shrink-0 text-right font-mono text-[10px] tabular-nums",
                  positive ? "text-bull" : "text-purple-light"
                )}
              >
                {fmtGamma(r.gamma)}
              </span>
              <span className="w-10 shrink-0 text-left">
                {r.isCallWall && (
                  <span className="font-mono text-[8px] uppercase tracking-wider text-gold">
                    call
                  </span>
                )}
                {r.isPutWall && (
                  <span className="font-mono text-[8px] uppercase tracking-wider text-gold">
                    put
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      })}

      {/* axis legend */}
      <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70">
        <span className="text-purple-light">◀ short γ (−)</span>
        <span className="text-sky-300">
          {spot > 0 ? `spot ${fmtStrike(spot)}` : "net dealer gamma"}
        </span>
        <span className="text-bull">long γ (+) ▶</span>
      </div>
    </div>
  );
}

export function GexHeatmap({ ticker = "SPY" }: { ticker?: string }) {
  const { data, isLoading, error } = useSWR<GexHeatmapResponse>(
    `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`,
    fetchGexHeatmap,
    { refreshInterval: 45_000, revalidateOnFocus: false }
  );

  const live = !error && Boolean(data?.available);
  const fetchFailed = Boolean(error) && !isLoading;
  const empty = !isLoading && data != null && !data.available;

  const spot = data?.spot ?? 0;
  const expiries = useMemo(() => data?.expiries ?? [], [data?.expiries]);
  const strikes = useMemo(() => data?.strikes ?? [], [data?.strikes]);
  const cells = data?.cells ?? {};
  const strikeTotals = useMemo(() => data?.strike_totals ?? {}, [data?.strike_totals]);
  const flip = data?.zero_gamma_flip ?? null;
  const callWall = data?.call_wall ?? null;
  const putWall = data?.put_wall ?? null;
  const maxPain = data?.max_pain ?? null;
  const regime = data?.regime ?? null;

  // Peak magnitude across all cells drives the matrix color scale.
  const peak = useMemo(() => {
    let p = 0;
    for (const row of Object.values(cells)) {
      for (const v of Object.values(row)) {
        const a = Math.abs(v);
        if (a > p) p = a;
      }
    }
    return p;
  }, [cells]);

  const totalPeak = useMemo(() => {
    let p = 0;
    for (const v of Object.values(strikeTotals)) {
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    return p;
  }, [strikeTotals]);

  // The strike row nearest spot — highlighted as the "spot" band.
  const spotStrike = useMemo(() => {
    if (!(spot > 0) || strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - spot) < Math.abs(best - spot) ? s : best
    );
  }, [strikes, spot]);

  // The strike row nearest the zero-gamma flip — gets the flip marker (matrix view).
  const flipStrike = useMemo(() => {
    if (flip == null || strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - flip) < Math.abs(best - flip) ? s : best
    );
  }, [strikes, flip]);

  // Profile rows: strikes desc, each carrying its net gamma + role flags.
  const profileRows = useMemo<ProfileRow[]>(() => {
    return strikes.map((strike) => ({
      strike,
      gamma: strikeTotals[String(strike)] ?? 0,
      isSpot: strike === spotStrike,
      isFlip: strike === flipStrike,
      isCallWall: callWall != null && strike === callWall,
      isPutWall: putWall != null && strike === putWall,
    }));
  }, [strikes, strikeTotals, spotStrike, flipStrike, callWall, putWall]);

  const changePct = data?.change_pct ?? 0;
  const changeBull = changePct >= 0;
  const postureBull = regime?.posture === "long";

  return (
    <Panel
      accent="bull"
      kicker="Dealer gamma exposure · Polygon options"
      title={
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span>{data?.underlying ?? ticker} GEX Positioning</span>
          {live && spot > 0 && (
            <>
              <span className="font-mono text-sm font-semibold text-white">
                {spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={clsx("font-mono text-xs font-bold", changeBull ? "text-bull" : "text-bear")}>
                {fmtPct(changePct)}
              </span>
            </>
          )}
        </span>
      }
      actions={
        live ? (
          <Badge tone="bull" dot>
            Live
          </Badge>
        ) : (
          <Badge tone="neutral">Offline</Badge>
        )
      }
    >
      {fetchFailed && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-xl border border-bear/40 bg-bear/[0.08] px-4 py-3"
          style={{ boxShadow: "inset 0 0 16px rgba(255,45,85,0.06)" }}
        >
          <span className="text-bear text-sm leading-none">⚠</span>
          <span className="font-mono text-[12px] font-bold text-bear tracking-wide">
            GEX feed unavailable — retrying
          </span>
        </div>
      )}

      {isLoading && !data ? (
        <div className="space-y-4" aria-hidden>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={80} rounded="xl" />
            ))}
          </div>
          <Skeleton height={20} rounded="lg" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} height={22} rounded="md" />
          ))}
        </div>
      ) : empty || strikes.length === 0 ? (
        <EmptyState
          icon="◆"
          title="GAMMA PROFILE IDLE"
          description="The dealer gamma profile prints from the live options chain during RTH. Standby until the bell."
        />
      ) : (
        <>
          {/* ── Regime header ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Gamma Flip"
              value={flip != null ? fmtStrike(flip) : "—"}
              tone={flip != null ? "accent" : "neutral"}
              sublabel="Posture pivot"
              compact
            />
            <Stat
              label="Call Wall"
              value={callWall != null ? fmtStrike(callWall) : "—"}
              tone="bull"
              sublabel="Resistance / pin"
              compact
            />
            <Stat
              label="Put Wall"
              value={putWall != null ? fmtStrike(putWall) : "—"}
              tone="bear"
              sublabel="Support"
              compact
            />
            <Stat
              label="Max Pain"
              value={maxPain != null ? fmtStrike(maxPain) : "—"}
              tone="sky"
              sublabel="OI value floor"
              compact
            />
          </div>

          {/* regime one-liner + posture badge */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] px-4 py-3">
            {regime?.posture != null && (
              <Badge tone={postureBull ? "bull" : "bear"} dot>
                {postureBull ? "Long Gamma" : "Short Gamma"}
              </Badge>
            )}
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-sky-100">
              {regime?.read ?? "Regime read unavailable."}
            </p>
          </div>

          {/* ── Profile | Matrix toggle ───────────────────────────────── */}
          <Tabs defaultValue="profile">
            <TabList aria-label="GEX view" className="mt-4 w-fit">
              <Tab value="profile">Profile</Tab>
              <Tab value="matrix">Matrix</Tab>
            </TabList>

            <TabPanels>
              {/* Hero: gamma profile ladder */}
              <TabPanel value="profile">
                <GammaProfile
                  rows={profileRows}
                  peak={totalPeak}
                  spot={spot}
                  flip={flip}
                />
                <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/60">
                  Net dealer $-gamma per strike · green long / violet short · total{" "}
                  <span className={clsx((data?.total_gex ?? 0) >= 0 ? "text-bull" : "text-purple-light")}>
                    {fmtGamma(data?.total_gex ?? 0)}
                  </span>
                </p>
              </TabPanel>

              {/* Secondary detail: strike × expiry matrix */}
              <TabPanel value="matrix">
                <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-mono uppercase tracking-widest">
                  <span className="flex items-center gap-1.5 text-sky-300">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(0,230,118,0.5)" }} />
                    Long gamma (+)
                  </span>
                  <span className="flex items-center gap-1.5 text-sky-300">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(191,95,255,0.5)" }} />
                    Short gamma (−)
                  </span>
                  {flip != null && (
                    <span className="flex items-center gap-1.5 text-gold">
                      <span aria-hidden>◀ flip</span>
                      <span className="text-white">{fmtStrike(flip)}</span>
                    </span>
                  )}
                  {spot > 0 && (
                    <span className="flex items-center gap-1.5 text-cyan-400">
                      <span aria-hidden>● spot</span>
                    </span>
                  )}
                </div>

                <div
                  className="overflow-x-auto"
                  role="region"
                  aria-label={`${data?.underlying ?? ticker} dealer gamma exposure matrix, strikes by expiration`}
                >
                  <table className="w-full border-separate border-spacing-0 font-mono text-[11px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-[rgba(8,9,14,0.92)] px-2 py-2 text-left text-[10px] uppercase tracking-widest text-cyan-400 backdrop-blur">
                          Strike
                        </th>
                        {expiries.map((e) => (
                          <th
                            key={e}
                            className="whitespace-nowrap px-2 py-2 text-center text-[10px] uppercase tracking-wide text-sky-300"
                          >
                            {fmtExpiry(e)}
                          </th>
                        ))}
                        <th className="whitespace-nowrap px-2 py-2 text-right text-[10px] uppercase tracking-wide text-cyan-400">
                          Net
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {strikes.map((strike) => {
                        const row = cells[String(strike)] ?? {};
                        const isSpot = strike === spotStrike;
                        const isFlip = strike === flipStrike;
                        const total = strikeTotals[String(strike)] ?? 0;
                        return (
                          <tr
                            key={strike}
                            className={clsx(
                              isSpot && "outline outline-1 outline-cyan-400/70",
                            )}
                          >
                            <th
                              scope="row"
                              className={clsx(
                                "sticky left-0 z-10 whitespace-nowrap px-2 py-1.5 text-left font-semibold tabular-nums backdrop-blur",
                                isSpot
                                  ? "bg-cyan-400/[0.12] text-white"
                                  : isFlip
                                    ? "bg-gold/[0.10] text-gold"
                                    : "bg-[rgba(8,9,14,0.92)] text-white"
                              )}
                            >
                              <span className="inline-flex items-center gap-1">
                                {isSpot && <span aria-hidden className="text-cyan-400">●</span>}
                                {isFlip && !isSpot && <span aria-hidden className="text-gold">◀</span>}
                                {fmtStrike(strike)}
                              </span>
                            </th>
                            {expiries.map((e) => {
                              const v = row[e];
                              const has = typeof v === "number";
                              return (
                                <td
                                  key={e}
                                  className={clsx(
                                    "whitespace-nowrap px-2 py-1.5 text-center tabular-nums",
                                    has ? (v > 0 ? "text-bull" : "text-purple-light") : "text-sky-300/30"
                                  )}
                                  style={has ? cellStyle(v, peak) : undefined}
                                  title={has ? `${strike} · ${fmtExpiry(e)} · ${fmtGamma(v)}` : undefined}
                                >
                                  {has ? fmtGamma(v) : "·"}
                                </td>
                              );
                            })}
                            <td
                              className={clsx(
                                "whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums",
                                total > 0 ? "text-bull" : total < 0 ? "text-purple-light" : "text-sky-300/40"
                              )}
                              style={total ? cellStyle(total, totalPeak) : undefined}
                            >
                              {total ? fmtGamma(total) : "·"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/60">
                  Net dealer $-gamma per strike × expiry · green long / violet short · total{" "}
                  <span className={clsx((data?.total_gex ?? 0) >= 0 ? "text-bull" : "text-purple-light")}>
                    {fmtGamma(data?.total_gex ?? 0)}
                  </span>
                </p>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </>
      )}
    </Panel>
  );
}
