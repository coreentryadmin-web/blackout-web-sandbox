"use client";

// Recharts sparkline extracted out of DarkPoolPanel so the (large) recharts
// chart code can be code-split via next/dynamic at the import site. This file is
// the ONLY recharts importer for the dark-pool panel; DarkPoolPanel itself no
// longer pulls recharts into its static client graph. Behavior is identical to
// the inline JSX it replaced (lines 301-317 of the old DarkPoolPanel).
import { AreaChart, Area, ResponsiveContainer, ReferenceLine } from "recharts";

type SparkPoint = { t: number; net: number };

export function DarkPoolSpark({ history, color }: { history: SparkPoint[]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="dpSparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
        <Area type="monotone" dataKey="net" stroke={color} strokeWidth={2}
          fill="url(#dpSparkGrad)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default DarkPoolSpark;
