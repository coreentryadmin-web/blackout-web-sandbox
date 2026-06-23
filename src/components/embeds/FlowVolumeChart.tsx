"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtPremium, type FlowAlert } from "@/lib/api";
import { rechartsTheme } from "@/lib/chart-theme";
import { EmbedFrame } from "./EmbedFrame";

type FlowVolumeChartProps = {
  alerts: FlowAlert[];
};

export function FlowVolumeChart({ alerts }: FlowVolumeChartProps) {
  const data = useMemo(() => {
    const totals = new Map<string, number>();
    for (const alert of alerts) {
      totals.set(alert.ticker, (totals.get(alert.ticker) ?? 0) + alert.premium);
    }
    return Array.from(totals.entries())
      .map(([ticker, premium]) => ({ ticker, premium }))
      .sort((a, b) => b.premium - a.premium)
      .slice(0, 8);
  }, [alerts]);

  return (
    <EmbedFrame title="Premium by Ticker" subtitle="Last 50 prints" variant="flow">
      {data.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center">
          <p className="font-mono text-xs text-purple-light/70 animate-pulse">
            Standby — tape quiet…
          </p>
        </div>
      ) : (
        <div className="h-[240px] p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="ticker"
                width={48}
                tick={rechartsTheme.axisTick}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid #8b5cf6",
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
                formatter={(value: number) => [fmtPremium(value), "Premium"]}
              />
              <Bar dataKey="premium" radius={[0, 4, 4, 0]} barSize={14}>
                {data.map((entry, i) => (
                  <Cell key={entry.ticker} fill={i < 3 ? "#a78bfa" : "#6d28d9"} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </EmbedFrame>
  );
}
