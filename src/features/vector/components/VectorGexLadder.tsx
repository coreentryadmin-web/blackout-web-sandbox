"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { buildGexLadder, type GexLadder, type GexLadderRow } from "@/features/vector/lib/vector-gex-ladder";
import { dteHorizonLabel, type VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

// Match the chart's bead colours exactly (VectorChart CALL_WALL_COLOR / PUT_WALL_COLOR) so the
// ladder and the beads read as the same object: gold = call/resistance, purple = put/support.
const CALL_COLOR = "#ffd60a";
const PUT_COLOR = "#d97bff";

const USD_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Signed, compact net-GEX label: `+$1.2M` (call) / `-$820K` (put). */
function fmtGex(gex: number): string {
  const sign = gex >= 0 ? "+" : "-";
  return `${sign}$${USD_COMPACT.format(Math.abs(gex))}`;
}

type Props = {
  ticker: string;
  liveSession: boolean;
  /** SSR-seeded spot so the header + empty state aren't blank before the first fetch. */
  initialSpot?: number | null;
  /** DTE horizon from the chart's toggle — the ladder re-scopes to the SAME expiries so it matches
   *  the walls on the chart. "all" = near-term aggregate (default). */
  dteHorizon?: VectorDteHorizon;
};

type LadderResponse = { spot: number | null; asOf: string | null; ladder: GexLadder };

/**
 * Strike-ladder side panel — the dense per-strike net-GEX column a member scans alongside the
 * chart (Skylit-Atlas parity). The chart collapses each strike to one bead; this shows the whole
 * near-spot gamma structure at once: every strike, its signed net GEX as a magnitude bar (gold
 * call / purple put), and the single dominant "king" per side. Polls /api/market/vector/gex-ladder
 * on its own cadence (off the per-second SSE payload). Horizon-scoping to the chart's DTE toggle is
 * a documented follow-up — this first slice shows the near-term ("all") aggregate the chart
 * defaults to.
 */
export function VectorGexLadder({ ticker, liveSession, initialSpot = null, dteHorizon = "all" }: Props) {
  const [ladder, setLadder] = useState<GexLadder>(() => buildGexLadder(null, initialSpot));
  const [spot, setSpot] = useState<number | null>(initialSpot);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // Guard against a slow response for a PREVIOUS ticker landing after a switch and overwriting the
  // new ticker's ladder (same staleness class the chart's fetches guard with a ref check).
  const tickerRef = useRef(ticker);

  useEffect(() => {
    tickerRef.current = ticker;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/gex-ladder?ticker=${encodeURIComponent(ticker)}&dte=${encodeURIComponent(dteHorizon)}`
        );
        if (cancelled || tickerRef.current !== ticker) return;
        if (!res.ok) {
          setState("error");
          return;
        }
        const data = (await res.json()) as LadderResponse;
        if (cancelled || tickerRef.current !== ticker) return;
        setLadder(data.ladder ?? buildGexLadder(null, data.spot ?? null));
        setSpot(data.spot ?? null);
        setAsOf(data.asOf ?? null);
        setState("ready");
      } catch {
        if (!cancelled && tickerRef.current === ticker) setState("error");
      }
    };

    void load();
    // Live: refresh with the walls cadence (15s). Off-hours: one fetch — the ladder is static.
    const id = liveSession ? setInterval(load, 15_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [ticker, liveSession, dteHorizon]);

  const rows = ladder.rows;
  // Index of the first row at/below spot — the spot marker slots ABOVE it (rows are strike-desc, so
  // this is the boundary between strikes above spot and strikes at/below it).
  const spotIdx =
    spot != null ? rows.findIndex((r) => r.strike <= spot) : -1;

  // Auto-centre the ladder on spot once per ticker: the rows are strike-descending, so without this
  // the panel opens scrolled to the highest strikes (all calls) and a member has to scroll down to
  // see spot and the puts below it. Centre the spot marker in the viewport on the first ready load
  // (and again when the ticker changes) — but NOT on the 15s live refresh, which would yank the
  // scroll back if the member has scrolled away.
  const listRef = useRef<HTMLOListElement>(null);
  const centeredTickerRef = useRef<string | null>(null);
  // Re-centre on ticker OR horizon change — a narrowed DTE shifts the strike set, so the panel must
  // re-anchor on spot instead of holding the previous horizon's scroll position.
  const centerKey = `${ticker}:${dteHorizon}`;
  useEffect(() => {
    if (state !== "ready" || spot == null || rows.length === 0) return;
    if (centeredTickerRef.current === centerKey) return;
    const list = listRef.current;
    if (!list) return;
    const target =
      list.querySelector<HTMLElement>(".vector-gex-ladder-spot") ??
      list.querySelector<HTMLElement>(".vector-gex-ladder-row");
    if (!target) return;
    const t = target.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    list.scrollTop += t.top - l.top - list.clientHeight / 2 + t.height / 2;
    centeredTickerRef.current = centerKey;
  }, [state, spot, rows, centerKey]);

  return (
    <section className="vector-gex-ladder" aria-label={`${ticker} GEX strike ladder`}>
      <header className="vector-gex-ladder-head">
        <span className="vector-gex-ladder-title">GEX Ladder</span>
        <span className="vector-gex-ladder-sub">
          {spot != null ? `spot ${spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
          <span className="vector-gex-ladder-scope"> · {dteHorizon === "all" ? "near-term" : dteHorizonLabel(dteHorizon)}</span>
        </span>
      </header>

      {state === "error" ? (
        <div className="vector-gex-ladder-empty">GEX ladder unavailable</div>
      ) : rows.length === 0 ? (
        <div className="vector-gex-ladder-empty">
          {state === "loading" ? "Loading GEX ladder…" : "No GEX structure near spot"}
        </div>
      ) : (
        <ol className="vector-gex-ladder-rows" ref={listRef}>
          {rows.map((r, i) => (
            <LadderRow key={r.strike} row={r} showSpotAbove={i === spotIdx} spot={spot} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LadderRow({
  row,
  showSpotAbove,
  spot,
}: {
  row: GexLadderRow;
  showSpotAbove: boolean;
  spot: number | null;
}) {
  const color = row.side === "call" ? CALL_COLOR : PUT_COLOR;
  return (
    <>
      {showSpotAbove && spot != null ? (
        <li className="vector-gex-ladder-spot" aria-hidden="true">
          <span className="vector-gex-ladder-spot-label">
            spot {spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        </li>
      ) : null}
      <li
        className={clsx(
          "vector-gex-ladder-row",
          `vector-gex-ladder-${row.side}`,
          row.isKing && "vector-gex-ladder-king"
        )}
      >
        <span className="vector-gex-ladder-strike">{row.strike.toLocaleString("en-US")}</span>
        <span className="vector-gex-ladder-bar-track">
          <span
            className="vector-gex-ladder-bar"
            style={{ width: `${Math.max(2, Math.round(row.magnitude * 100))}%`, backgroundColor: color }}
          />
        </span>
        <span className="vector-gex-ladder-val" style={{ color }}>
          {row.isKing ? <span className="vector-gex-ladder-crown" aria-hidden="true">♛</span> : null}
          {fmtGex(row.gex)}
        </span>
      </li>
    </>
  );
}
