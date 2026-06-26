"use client";

import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { Panel, Skeleton } from "@/components/ui";

type Point = { t: number; net: number };
const MAX_POINTS = 50;

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { value: number }[] }) {
  if (!active || !payload?.length) return null;
  const net = payload[0]?.value ?? 0;
  return (
    <div className="bg-[rgba(8,9,14,0.92)] border border-white/10 rounded-md px-2.5 py-1.5 shadow-xl backdrop-blur">
      <p className={clsx("font-mono text-[10px] font-semibold", net >= 0 ? "text-bull" : "text-bear")}>
        {net >= 0 ? "+" : ""}{fmtPremium(net)}
      </p>
      <p className="font-mono text-[10px] text-cyan-400">cumulative net premium</p>
    </div>
  );
}

export function FlowMomentumChart({ alerts }: { alerts: FlowAlert[] }) {
  const [points, setPoints] = useState<Point[]>([]);
  const lastFpRef = useRef("");

  useEffect(() => {
    if (!alerts.length) return;
    const fp = `${alerts[0]?.alerted_at ?? ""}:${alerts.length}`;
    if (fp === lastFpRef.current) return;
    lastFpRef.current = fp;

    // Each point is the CUMULATIVE call−put premium across the entire loaded tape at sample
    // time — NOT per-window net flow. As the tape accumulates, this is a running total whose
    // slope tracks how many alerts have loaded (and it jumps on reload). Labeled accordingly
    // ("cumulative net premium") rather than rebuilt into a true event-time–bucketed series.
    const calls = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
    const puts  = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);

    setPoints((prev) => [...prev.slice(-(MAX_POINTS - 1)), { t: Date.now(), net: calls - puts }]);
  }, [alerts]);

  const latestNet = points[points.length - 1]?.net ?? 0;
  const prevNet   = points[points.length - 2]?.net ?? 0;
  const delta     = latestNet - prevNet;
  const isBull    = latestNet >= 0;
  const color     = isBull ? "#00e676" : "#ff2d55";

  return (
    <Panel
      accent="sky"
      title="Cumulative Net Prem (running)"
      bodyClassName="!px-2 !py-2"
      actions={
        points.length >= 2 ? (
          <div className="flex items-center gap-1.5">
            <span className={clsx("font-mono text-[10px] font-semibold tabular-nums", isBull ? "text-bull" : "text-bear")}>
              {isBull ? "+" : ""}{fmtPremium(latestNet)}
            </span>
            {delta !== 0 && (
              <span className={clsx("font-mono text-[10px]", delta > 0 ? "text-bull" : "text-bear")}>
                {delta > 0 ? "▲" : "▼"}
              </span>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="px-1 pt-1 pb-1">
        {points.length < 2 ? (
          <div className="h-[72px] flex items-center justify-center">
            <Skeleton width="100%" height={72} rounded="md" />
          </div>
        ) : (
          <div className="h-[72px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="momentumGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3 3" />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.18)", strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke={color}
                  strokeWidth={1.5}
                  fill="url(#momentumGrad)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="font-mono text-[10px] text-cyan-500 text-center mt-1">cumulative (call − put) premium of loaded tape · {points.length} samples</p>
      </div>
    </Panel>
  );
}
