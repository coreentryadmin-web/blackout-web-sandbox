"use client";

// SHARED PRICE AXIS strike ladder (SPX desk, 2026-07-13, flagship upgrade #1).
//
// Renders the dealer-gamma matrix's strike/net data as a vertical ladder on the SAME
// y-scale as the adjacent embedded Vector chart: horizontal bars extending left (−, put/
// short-gamma) and right (+, call/long-gamma) from a center spine, king strike glowing,
// and ONE spot line whose pixel height matches the chart's spot exactly.
//
// Alignment mechanism: VectorChart emits a VectorPriceScaleMap ({priceToY, rangeMin,
// rangeMax, height, paneTop}) via the onPriceScaleRender seam. priceToY is pane-relative,
// so this component offsets by (map.paneTop - ownTop) — both measured in viewport coords —
// to land rows at the identical screen height in a DIFFERENT grid column. When no map
// exists yet (chart mounting / vector column gated off) it falls back to a spot-centered
// linear scale so the ladder is never blank.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { VectorPriceScaleMap } from "@/features/vector/lib/vector-price-scale-map";
import {
  buildLadderAxisRows,
  fallbackLadderRange,
  ladderBarThickness,
  ladderRowGapPx,
  ladderY,
  type LadderScale,
} from "@/features/spx/lib/spx-strike-ladder";
import {
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  type GexHeatmapLens,
} from "@/lib/gex-heatmap-display";
import { fmtPrice } from "@/lib/api";

type Props = {
  strikes: number[];
  /** strike → signed net exposure (the matrix block's strike_totals — same Net the table shows). */
  totals: Record<string, number>;
  spot: number | null;
  king: number | null;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  lens: GexHeatmapLens;
  /** Live y-mapping from the embedded Vector chart; null → spot-centered linear fallback. */
  map: VectorPriceScaleMap | null;
  /** "full" = bars+labels (matrix column). "focus" = king/wall markers + spot only (48px rail). */
  variant?: "full" | "focus";
};

export function SpxStrikeLadderAxis({
  strikes,
  totals,
  spot,
  king,
  callWall,
  putWall,
  flip,
  lens,
  map,
  variant = "full",
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ top: number; height: number }>({ top: 0, height: 0 });

  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox((cur) =>
      Math.abs(cur.top - r.top) > 0.5 || Math.abs(cur.height - r.height) > 0.5
        ? { top: r.top, height: r.height }
        : cur
    );
  }, []);

  // Re-measure on resize and page scroll; ALSO whenever the map changes — map.paneTop is a
  // viewport coordinate, so both sides of the offset must be sampled at the same time.
  useLayoutEffect(() => {
    measure();
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure);
    };
  }, [measure]);
  useLayoutEffect(measure, [map, measure]);

  // Scale: the chart's live one when present, else spot-centered fallback over our own box.
  const scale: LadderScale | null = useMemo(() => {
    if (map) {
      return {
        rangeMin: map.rangeMin,
        rangeMax: map.rangeMax,
        height: map.height,
        priceToY: map.priceToY,
      };
    }
    const range = fallbackLadderRange(spot, strikes);
    return range && box.height > 0 ? { ...range, height: box.height } : null;
  }, [map, spot, strikes, box.height]);

  /** Pane-y → own-box-y. With a chart map the offset aligns viewport pixels across columns. */
  const offset = map ? map.paneTop - box.top : 0;

  const rows = useMemo(
    () =>
      scale
        ? buildLadderAxisRows({ strikes, totals, scale, king, callWall, putWall })
        : [],
    [scale, strikes, totals, king, callWall, putWall]
  );

  const barH = ladderBarThickness(ladderRowGapPx(rows));
  const spotY = scale && spot != null && spot > 0 ? ladderY(scale, spot) : null;
  const flipY = scale && flip != null ? ladderY(scale, flip) : null;
  const focus = variant === "focus";

  /** Inside our own box (with a 1px slack) — rows that map off-panel are clipped. */
  const inBox = (yOwn: number) => yOwn >= -1 && yOwn <= box.height + 1;

  return (
    <div
      ref={boxRef}
      className={clsx("spx-strike-ladder", focus && "spx-strike-ladder--focus")}
      aria-label={
        focus
          ? "King strikes rail (shared chart axis)"
          : `SPX ${lens.toUpperCase()} strike ladder on the chart's price axis`
      }
    >
      {!focus && <div className="spx-strike-ladder-spine" aria-hidden />}

      {rows.map((row) => {
        const yOwn = row.y + offset;
        if (!inBox(yOwn)) return null;
        const marker = row.king || row.callWall || row.putWall;
        if (focus && !marker) return null;
        const side = row.net >= 0 ? "pos" : "neg";
        const title = `${fmtHeatmapStrike(row.strike)} · net ${fmtHeatmapMoneySigned(row.net, { showZero: true })}${
          row.king ? " · KING" : ""
        }${row.callWall ? " · call wall" : ""}${row.putWall ? " · put wall" : ""}${
          spot != null && spot > 0 ? ` · ${Math.round(Math.abs(row.strike - spot))}pt from spot` : ""
        }`;
        return (
          <div
            key={row.strike}
            className={clsx(
              "spx-strike-ladder-row",
              row.king && "spx-strike-ladder-row--king",
              row.callWall && "spx-strike-ladder-row--call-wall",
              row.putWall && "spx-strike-ladder-row--put-wall"
            )}
            style={{ top: yOwn }}
            title={title}
          >
            {focus ? (
              <span
                className={clsx(
                  "spx-strike-ladder-marker",
                  `spx-strike-ladder-marker--${row.king ? "king" : side}`
                )}
                aria-hidden
              />
            ) : (
              <>
                <span
                  className={clsx(
                    "spx-strike-ladder-bar",
                    `spx-strike-ladder-bar--${side}`,
                    lens === "vex" && "spx-strike-ladder-bar--vex"
                  )}
                  style={{
                    height: barH,
                    width: `calc((50% - 3rem) * ${Math.max(row.widthPct, row.net !== 0 ? 2 : 0) / 100})`,
                  }}
                  aria-hidden
                />
                {row.label && (
                  <span className="spx-strike-ladder-strike">{fmtHeatmapStrike(row.strike)}</span>
                )}
                {row.king && (
                  <span className="spx-strike-ladder-king-star" aria-hidden>
                    ★
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}

      {flipY != null && inBox(flipY + offset) && !focus && (
        <div
          className="spx-strike-ladder-flip"
          style={{ top: flipY + offset }}
          title={`γ flip ${fmtHeatmapStrike(flip!)}`}
        >
          <span>γ flip</span>
        </div>
      )}

      {spotY != null && inBox(spotY + offset) && (
        <div
          className="spx-strike-ladder-spot"
          style={{ top: spotY + offset }}
          title={`SPX spot ${fmtPrice(spot!)}`}
        >
          {!focus && <span className="spx-strike-ladder-spot-label">{fmtPrice(spot!)}</span>}
        </div>
      )}

      {rows.length === 0 && !focus && (
        <p className="spx-strike-ladder-empty font-mono text-[10px] text-sky-300">
          Mapping strikes to the chart axis…
        </p>
      )}
    </div>
  );
}
