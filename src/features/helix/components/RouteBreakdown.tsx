"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fmtPremium, type FlowAlert } from "@/lib/api";
import { Panel } from "@/components/ui";

const ROUTE_META: Record<string, { color: string; icon: string }> = {
  SWEEP:  { color: "#fb923c", icon: "⚡" },
  BLOCK:  { color: "#22d3ee", icon: "▮" },
  SPLIT:  { color: "#a78bfa", icon: "⟁" },
  CROSS:  { color: "#f472b6", icon: "✕" },
  FLOOR:  { color: "#facc15", icon: "▣" },
  MULTI:  { color: "#34d399", icon: "◈" },
};

type RouteEntry = {
  route: string;
  premium: number;
  count: number;
  pct: number;
  color: string;
  icon: string;
};

export function RouteBreakdown({ alerts, loading }: { alerts: FlowAlert[]; loading: boolean }) {
  const entries = useMemo(() => {
    if (!alerts.length) return [];
    const map = new Map<string, { premium: number; count: number }>();

    for (const a of alerts) {
      const route = (a.route || a.alert_rule || "OTHER").toUpperCase();
      const key = Object.keys(ROUTE_META).find((r) => route.includes(r)) ?? "OTHER";
      const cur = map.get(key) ?? { premium: 0, count: 0 };
      cur.premium += a.premium;
      cur.count++;
      map.set(key, cur);
    }

    const total = Array.from(map.values()).reduce((s, v) => s + v.premium, 0);
    return Array.from(map.entries())
      .map(([route, { premium, count }]) => ({
        route,
        premium,
        count,
        pct: total > 0 ? Math.round((premium / total) * 100) : 0,
        color: ROUTE_META[route]?.color ?? "#94a3b8",
        icon: ROUTE_META[route]?.icon ?? "○",
      }))
      .sort((a, b) => b.premium - a.premium);
  }, [alerts]);

  if (loading || entries.length === 0) return null;

  const maxPremium = entries[0]?.premium ?? 1;

  return (
    <Panel accent="sky" kicker="◇ execution" title="Route Breakdown" bodyClassName="space-y-2">
      <AnimatePresence initial={false}>
        {entries.map((e, i) => {
          const barW = Math.max(6, (e.premium / maxPremium) * 100);
          return (
            <motion.div
              key={e.route}
              layout="position"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: e.color }}>{e.icon}</span>
                  <span className="font-mono text-[12px] font-bold tracking-wider" style={{ color: e.color }}>
                    {e.route}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-sky-300/60">{e.count}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-sky-200/70">{e.pct}%</span>
                  <span className="font-mono text-[12px] font-bold tabular-nums text-white">{fmtPremium(e.premium)}</span>
                </div>
              </div>
              <div className="relative h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: e.color, width: `${barW}%`, opacity: 0.7 }}
                  initial={{ width: 0 }}
                  animate={{ width: `${barW}%` }}
                  transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1], delay: i * 0.04 }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        Sweeps signal urgency · blocks signal conviction
      </p>
    </Panel>
  );
}
