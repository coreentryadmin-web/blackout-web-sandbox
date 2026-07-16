"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fmtPremium, type FlowAlert } from "@/lib/api";
import { Panel } from "@/components/ui";

type Bucket = { label: string; callPremium: number; putPremium: number; total: number; callPct: number; count: number };

function bucketLabel(dte: number): string {
  if (dte === 0) return "0DTE";
  if (dte <= 7) return "This week";
  if (dte <= 30) return "Monthly";
  return "LEAPS";
}

export function ExpiryConcentration({ alerts, loading }: { alerts: FlowAlert[]; loading: boolean }) {
  const buckets = useMemo(() => {
    if (!alerts.length) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map<string, { callPremium: number; putPremium: number; count: number }>();

    for (const a of alerts) {
      const expDate = new Date(a.expiry + "T00:00:00");
      const dte = a.dte ?? Math.max(0, Math.floor((expDate.getTime() - today.getTime()) / 86_400_000));
      const label = bucketLabel(dte);
      const cur = map.get(label) ?? { callPremium: 0, putPremium: 0, count: 0 };
      if (a.option_type === "CALL") cur.callPremium += a.premium;
      else if (a.option_type === "PUT") cur.putPremium += a.premium;
      cur.count++;
      map.set(label, cur);
    }

    const order = ["0DTE", "This week", "Monthly", "LEAPS"];
    return order
      .filter((l) => map.has(l))
      .map((label) => {
        const { callPremium, putPremium, count } = map.get(label)!;
        const total = callPremium + putPremium;
        const callPct = total > 0 ? Math.round((callPremium / total) * 100) : 50;
        return { label, callPremium, putPremium, total, callPct, count } as Bucket;
      })
      .filter((b) => b.total >= 50_000);
  }, [alerts]);

  if (loading || buckets.length === 0) return null;

  const maxTotal = buckets[0]?.total ?? 1;
  const grandTotal = buckets.reduce((s, b) => s + b.total, 0);

  return (
    <Panel accent="purple" kicker="⟐ expiry horizon" title="Expiry Concentration" bodyClassName="space-y-2">
      <AnimatePresence initial={false}>
        {buckets.map((b, i) => {
          const pct = grandTotal > 0 ? Math.round((b.total / grandTotal) * 100) : 0;
          const barW = Math.max(8, (b.total / maxTotal) * 100);
          const isBull = b.callPct >= 55;
          const isBear = b.callPct <= 45;
          return (
            <motion.div
              key={b.label}
              layout="position"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-purple-200 w-20">{b.label}</span>
                  <span className="font-mono text-[10px] tabular-nums text-sky-300/60">{b.count} prints</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-purple-300/80">{pct}%</span>
                  <span
                    className="font-mono text-[12px] font-bold tabular-nums"
                    style={{ color: isBull ? "#00e676" : isBear ? "#ff2d55" : "#c4b5fd" }}
                  >
                    {fmtPremium(b.total)}
                  </span>
                </div>
              </div>
              <div className="relative h-2 rounded-full overflow-hidden bg-white/[0.06]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    background: isBull
                      ? "linear-gradient(90deg, #00b35a, #00e676)"
                      : isBear
                        ? "linear-gradient(90deg, #b3203c, #ff2d55)"
                        : "linear-gradient(90deg, #7c3aed, #a78bfa)",
                    width: `${barW}%`,
                  }}
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
        Premium by expiry horizon · call/put colored
      </p>
    </Panel>
  );
}
