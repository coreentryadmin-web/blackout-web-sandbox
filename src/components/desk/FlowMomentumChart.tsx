"use client";

import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";

type Point = { t: number; net: number };
const MAX_POINTS = 50;

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { value: number }[] }) {
  if (!active || !payload?.length) return null;
  const net = payload[0]?.value ?? 0;
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-1.5 shadow-xl">
      <p className={clsx("font-mono text-[10px] font-semibold", net >= 0 ? "text-emerald-400" : "text-rose-400")}>
        {net >= 0 ? "+" : ""}{fmtPremium(net)}
      </p>
      <p className="font-mono text-[9px] text-zinc-600">net flow</p>
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

    const calls = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
    const puts  = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);

    setPoints((prev) => [...prev.slice(-(MAX_POINTS - 1)), { t: Date.now(), net: calls - puts }]);
  }, [alerts]);

  const latestNet = points[points.length - 1]?.net ?? 0;
  const prevNet   = points[points.length - 2]?.net ?? 0;
  const delta     = latestNet - prevNet;
  const isBull    = latestNet >= 0;
  const color     = isBull ? "#10b981" : "#f43f5e";

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <span className="flow-panel-title">Flow Momentum</span>
        {points.length >= 2 && (
          <div className="flex items-center gap-1.5">
            <span className={clsx("font-mono text-[10px] font-semibold tabular-nums", isBull ? "text-emerald-400" : "text-rose-400")}>
              {isBull ? "+" : ""}{fmtPremium(latestNet)}
            </span>
            {delta !== 0 && (
              <span className={clsx("font-mono text-[9px]", delta > 0 ? "text-emerald-600" : "text-rose-600")}>
                {delta > 0 ? "▲" : "▼"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="px-1 pt-2 pb-1">
        {points.length < 2 ? (
          <div className="h-[72px] flex items-center justify-center">
            <div className="flow-skeleton h-full w-full rounded-md" style={{ height: 72 }} />
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
                <ReferenceLine y={0} stroke="#3f3f46" strokeWidth={1} strokeDasharray="3 3" />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#3f3f46", strokeWidth: 1 }} />
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
        <p className="font-mono text-[9px] text-zinc-700 text-center mt-1">call − put premium · {points.length} samples</p>
      </div>
    </div>
  );
}
