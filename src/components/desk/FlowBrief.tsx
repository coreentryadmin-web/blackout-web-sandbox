"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FlowAlert } from "@/lib/api";

const REFRESH_MS = 2 * 60 * 1000;
const MIN_ALERTS = 5;

async function fetchBrief(alerts: FlowAlert[]): Promise<string | null> {
  try {
    const res = await fetch("/api/market/flow-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alerts: alerts.slice(0, 20) }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()).brief ?? null;
  } catch {
    return null;
  }
}

export function FlowBrief({ alerts }: { alerts: FlowAlert[] }) {
  const [brief, setBrief]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const lastFpRef = useRef("");

  const refresh = useCallback(async (forAlerts: FlowAlert[]) => {
    if (forAlerts.length < MIN_ALERTS) return;
    const fp = forAlerts.slice(0, 3).map((a) => a.alerted_at).join("|");
    if (fp === lastFpRef.current) return;
    lastFpRef.current = fp;
    setLoading(true);
    const text = await fetchBrief(forAlerts);
    setLoading(false);
    if (text) setBrief(text);
  }, []);

  useEffect(() => { refresh(alerts); }, [alerts, refresh]);
  useEffect(() => {
    const id = setInterval(() => refresh(alerts), REFRESH_MS);
    return () => clearInterval(id);
  }, [alerts, refresh]);

  if (!brief && !loading) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative overflow-hidden rounded-lg border border-violet-900/40 bg-gradient-to-r from-violet-950/30 via-zinc-950/60 to-zinc-950/30"
        style={{ boxShadow: "0 0 30px rgba(139,92,246,0.08)" }}
      >
        {/* Top gradient line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-600/40 to-transparent" />

        <div className="flex items-start gap-3 px-4 py-3">
          {/* AI icon */}
          <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
            <div className="relative">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 block" />
              <span className="absolute inset-0 rounded-full bg-violet-500 animate-ping opacity-40" />
            </div>
            <span className="font-mono text-[8px] tracking-[0.3em] uppercase text-violet-600">AI</span>
          </div>

          {/* Text */}
          <AnimatePresence mode="wait">
            {loading && !brief ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 space-y-1.5 py-0.5">
                <div className="flow-skeleton h-[11px] rounded w-full" />
                <div className="flow-skeleton h-[11px] rounded w-3/4" />
              </motion.div>
            ) : (
              <motion.p
                key={brief}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.4 }}
                className="flex-1 font-mono text-[11px] leading-relaxed text-zinc-300"
              >
                {brief}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Refresh indicator */}
          {loading && brief && (
            <span className="flex-shrink-0 font-mono text-[9px] text-violet-800 animate-pulse pt-0.5">
              updating
            </span>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
