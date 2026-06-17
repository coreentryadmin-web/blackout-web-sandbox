"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { EmbedFrame } from "./EmbedFrame";

type TapeItem = Pick<FlowAlert, "ticker" | "premium" | "option_type" | "route">;

type LiveFlowTapeProps = {
  alerts: FlowAlert[];
  className?: string;
};

const SCAN_PLACEHOLDERS: TapeItem[] = [
  { ticker: "SPY", premium: 0, option_type: "CALL", route: "scanning" },
  { ticker: "NVDA", premium: 0, option_type: "PUT", route: "scanning" },
  { ticker: "QQQ", premium: 0, option_type: "CALL", route: "scanning" },
];

export function LiveFlowTape({ alerts, className }: LiveFlowTapeProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || alerts.length === 0) return;
    el.style.animation = "none";
    void el.offsetHeight;
    el.style.animation = "";
  }, [alerts]);

  const items: TapeItem[] = alerts.length > 0 ? alerts : SCAN_PLACEHOLDERS;

  const doubled = [...items.slice(0, 20), ...items.slice(0, 20)];

  return (
    <EmbedFrame
      title="Institutional Tape"
      subtitle="Real-time prints"
      variant="flow"
      className={className}
      live={alerts.length > 0}
    >
      <div className="flow-tape-viewport">
        <div ref={trackRef} className="flow-tape-track">
          {doubled.map((alert, i) => {
            const isBull = alert.option_type?.toUpperCase() === "CALL";
            const scanning = alert.route === "scanning";
            return (
              <div key={`${alert.ticker}-${i}`} className="flow-tape-item">
                <span className="font-mono font-bold text-white">{alert.ticker}</span>
                <span className={clsx("font-mono text-[10px]", isBull ? "text-bull" : "text-bear")}>
                  {alert.option_type?.toUpperCase() ?? "—"}
                </span>
                <span className="font-mono text-[10px] text-purple-light">
                  {scanning ? "SCANNING" : fmtPremium(alert.premium)}
                </span>
                {!scanning && (
                  <span className="font-mono text-[9px] text-grey-500 uppercase">{alert.route}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </EmbedFrame>
  );
}
