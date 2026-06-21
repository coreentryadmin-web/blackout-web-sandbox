"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FlowAlert } from "@/lib/api";

const REFRESH_MS = 10 * 60 * 1000;
const MIN_ALERTS = 5;

const AFTER_HOURS_LINES = [
  "Market's dark. The flow you saw today already told you where tomorrow opens.",
  "RTH closed. Whales don't stop — they just move without noise now.",
  "Bell rang. Smart money spent all session leaving footprints. HELIX caught every one.",
  "After-hours. Where institutional repositioning happens before retail even knows the story.",
  "Tape's silent. But the $401M in premium printed today? That conviction doesn't expire overnight.",
  "Dark pools never sleep. They're just quieter when the retail crowd goes home.",
  "Market closed. The sweep you saw at 3:58 PM wasn't an accident — it was a signal.",
  "Off-hours. The whales are positioned. The question is: are you on the right side?",
  "RTH offline. Every block print today was a breadcrumb. HELIX has the trail.",
  "Closed for business. Open for edge. Come back at 9:30 ET and let the tape talk.",
];

function isRTH(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour    = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute  = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

  if (["Sat", "Sun"].includes(weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}

function afterHoursLine(): string {
  // deterministic pick by hour so it doesn't flash on re-render
  const h = new Date().getHours();
  return AFTER_HOURS_LINES[h % AFTER_HOURS_LINES.length];
}

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
  const [brief, setBrief]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [marketOpen, setMarketOpen] = useState(isRTH());
  const lastFpRef = useRef("");

  const refresh = useCallback(async (forAlerts: FlowAlert[]) => {
    if (!isRTH()) {
      setMarketOpen(false);
      setBrief(null);
      return;
    }
    setMarketOpen(true);
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

  // Re-check RTH every minute so the banner flips at open/close automatically
  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isRTH()), 60_000);
    return () => clearInterval(id);
  }, []);

  const showAfterHours = !marketOpen;
  const displayText    = showAfterHours ? afterHoursLine() : brief;

  if (!displayText && !loading) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative overflow-hidden rounded-lg"
        style={showAfterHours ? {
          background: "linear-gradient(135deg, rgba(30,30,40,0.95) 0%, rgba(10,10,20,0.98) 100%)",
          border: "1px solid rgba(100,100,130,0.25)",
          boxShadow: "0 0 20px rgba(0,0,0,0.5)",
        } : {
          background: "linear-gradient(135deg, rgba(217,70,239,0.12) 0%, rgba(0,0,0,0.7) 40%, rgba(0,255,102,0.08) 100%)",
          border: "1px solid",
          borderImage: "linear-gradient(90deg, rgba(217,70,239,0.6), rgba(0,255,102,0.5)) 1",
          boxShadow: "0 0 30px rgba(217,70,239,0.15), 0 0 60px rgba(0,255,102,0.05)",
        }}
      >
        {/* Top gradient line — only during RTH */}
        {!showAfterHours && (
          <div className="absolute inset-x-0 top-0 h-[2px]" style={{
            background: "linear-gradient(90deg, transparent, #e879f9, #00ff66, transparent)",
            animation: "brief-scan 3s ease-in-out infinite",
          }} />
        )}

        <div className="flex items-start gap-3 px-4 py-3">
          {/* Label */}
          <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
            {showAfterHours ? (
              <>
                <span className="w-2 h-2 rounded-full block" style={{ background: "rgba(120,120,160,0.6)" }} />
                <span className="font-mono text-[9px] tracking-[0.35em] uppercase font-bold" style={{ color: "rgba(140,140,180,0.8)" }}>
                  AFTER-HOURS
                </span>
              </>
            ) : (
              <>
                <div className="relative">
                  <span className="w-2 h-2 rounded-full block relative z-10" style={{ background: "#e879f9", boxShadow: "0 0 8px #e879f9" }} />
                  <span className="absolute inset-0 rounded-full animate-ping opacity-50" style={{ background: "#e879f9" }} />
                </div>
                <span className="font-mono text-[9px] tracking-[0.35em] uppercase font-bold" style={{ color: "#e879f9", textShadow: "0 0 8px rgba(232,121,249,0.7)" }}>
                  AI BRIEF
                </span>
                <span className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color: "#00e566", textShadow: "0 0 6px rgba(0,229,102,0.6)" }}>
                  · LIVE
                </span>
              </>
            )}
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
                key={displayText}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.4 }}
                className="flex-1 font-mono leading-relaxed font-medium"
                style={showAfterHours ? {
                  color: "rgba(160,160,200,0.85)",
                  fontSize: "11px",
                  fontStyle: "italic",
                } : {
                  color: "#f0f0f0",
                  fontSize: "12px",
                  textShadow: "0 0 1px rgba(255,255,255,0.3)",
                }}
              >
                {displayText}
              </motion.p>
            )}
          </AnimatePresence>

          {loading && brief && (
            <span className="flex-shrink-0 font-mono text-[9px] animate-pulse pt-0.5" style={{ color: "#00e566" }}>
              updating
            </span>
          )}
        </div>

        {/* Bottom line — only during RTH */}
        {!showAfterHours && (
          <div className="absolute inset-x-0 bottom-0 h-px" style={{
            background: "linear-gradient(90deg, transparent, rgba(0,255,102,0.3), rgba(217,70,239,0.3), transparent)",
          }} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
