"use client";

import { clsx } from "clsx";
import type { SpxTapeItem } from "@/features/spx/lib/spx-desk";
import { useLiveSpxTape } from "@/features/spx/hooks/useLiveSpxTape";
import { computeTapeSkew, fmtTapePremium } from "@/features/spx/lib/spx-tape-display";

type Props = {
  seed?: SpxTapeItem[];
  flow0dteNet?: number | null;
  flowCallPrem?: number | null;
  flowPutPrem?: number | null;
};

export function SpxMatrixTapeStrip({ seed, flow0dteNet, flowCallPrem, flowPutPrem }: Props) {
  const tape = useLiveSpxTape(seed);
  const { bull, bear, skew } = computeTapeSkew(tape);
  const flowPrints = tape.filter((t) => t.kind === "flow").slice(0, 6);

  const netLabel =
    flow0dteNet != null && Math.abs(flow0dteNet) > 40_000
      ? `0DTE net ${flow0dteNet > 0 ? "+" : ""}${fmtTapePremium(Math.abs(flow0dteNet))}`
      : flowCallPrem != null && flowPutPrem != null
        ? `C ${fmtTapePremium(flowCallPrem)} · P ${fmtTapePremium(flowPutPrem)}`
        : null;

  return (
    <div className="spx-matrix-tape-strip" aria-label="SPX flow tape skew">
      <div className="spx-matrix-tape-skew">
        <span
          className={clsx(
            "spx-matrix-tape-skew-badge",
            skew === "call" && "spx-matrix-tape-skew-badge--bull",
            skew === "put" && "spx-matrix-tape-skew-badge--bear"
          )}
        >
          {skew === "call" ? "CALL skew" : skew === "put" ? "PUT skew" : "Tape balanced"}
        </span>
        {netLabel && <span className="spx-matrix-tape-net">{netLabel}</span>}
      </div>
      {flowPrints.length > 0 ? (
        <div className="spx-matrix-tape-chips">
          {flowPrints.map((item, i) => (
            <span
              key={`${item.label}-${item.time}-${i}`}
              className={clsx(
                "spx-matrix-tape-chip",
                item.side === "call" && "spx-matrix-tape-chip--call",
                item.side === "put" && "spx-matrix-tape-chip--put"
              )}
              title={item.detail}
            >
              {item.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="spx-matrix-tape-empty">No recent SPX flow prints</p>
      )}
    </div>
  );
}
