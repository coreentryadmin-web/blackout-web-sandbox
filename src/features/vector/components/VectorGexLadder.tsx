"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { buildGexLadder, type GexLadderRow } from "@/features/vector/lib/vector-gex-ladder";
import { dteHorizonLabel, type VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import {
  formatSnapshotClock,
  snapshotMatches,
  type VectorHorizonSnapshot,
} from "@/features/vector/lib/vector-horizon-snapshot";

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
  /** SSR-seeded spot so the header + empty state aren't blank before the first snapshot. */
  initialSpot?: number | null;
  /** DTE horizon from the chart's toggle — label + re-centre key; the snapshot carries the
   *  horizon-scoped data itself. "all" = near-term aggregate (default). */
  dteHorizon?: VectorDteHorizon;
  /** The SHARED per-(ticker,horizon) snapshot (one fetch cycle, one asOf — see
   *  vector-horizon-snapshot.ts). The ladder renders THIS object — it no longer runs its own
   *  poll, so its rows can never describe a different instant than the chart's walls/banner or
   *  the terminal citations consuming the same snapshot. */
  snapshot: VectorHorizonSnapshot | null;
};

/**
 * Strike-ladder side panel — the dense per-strike net-GEX column a member scans alongside the
 * chart (Skylit-Atlas parity). The chart collapses each strike to one bead; this shows the whole
 * near-spot gamma structure at once: every strike, its signed net GEX as a magnitude bar (gold
 * call / purple put), and the single dominant "king" per side. Data comes EXCLUSIVELY from the
 * shared VectorHorizonSnapshot (cross-surface sync): the panel previously polled
 * /api/market/vector/gex-ladder on its own cadence, which let its numbers drift up to a cycle
 * away from the chart/terminal — the "three different numbers" member report. The shared `asOf`
 * is displayed in the header so the sync is visible.
 */
export function VectorGexLadder({ ticker, initialSpot = null, dteHorizon = "all", snapshot }: Props) {
  // Only a snapshot for THIS exact (ticker, horizon) may render — during a switch the stale
  // snapshot for the previous selection shows as "loading", never as the wrong ticker's rows
  // (same staleness class the old fetch guarded with a ticker ref).
  const matched = snapshotMatches(snapshot, ticker, dteHorizon) ? snapshot : null;
  const ladder = matched?.ladder ?? buildGexLadder(null, initialSpot);
  const spot = matched?.spot ?? initialSpot;
  const asOf = matched?.asOf ?? null;
  const state: "loading" | "ready" | "error" =
    matched == null ? "loading" : matched.ladder == null ? "error" : "ready";

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
          {/* Shared-snapshot stamp: the SAME asOf the terminal shows — visible proof the ladder,
              chart levels, and narration all cite one fetch cycle. */}
          {asOf != null ? (
            <span className="vector-gex-ladder-scope"> · as of {formatSnapshotClock(asOf)}</span>
          ) : null}
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
