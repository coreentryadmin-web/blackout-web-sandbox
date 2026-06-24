"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui";

// One shared brief per 15-min window — generated server-side for all users
const REFRESH_MS = 15 * 60 * 1000;

const AFTER_HOURS_LINES = [
  "Market closed. Today's flow is logged and ready to review before the open.",
  "RTH closed. Institutional repositioning keeps printing in extended hours — quieter, but tracked.",
  "Bell rang. Every sweep and block today is captured in the HELIX tape.",
  "After-hours. This is when institutional positioning sets up ahead of the next session.",
  "Market closed. Today's largest prints are still on the tape — review them before tomorrow.",
  "Dark pools keep printing after the bell. HELIX logs the blocks in real time.",
  "Market closed. That late-session sweep is on record — read it as an observation, not a forecast.",
  "Off-hours. Positioning is set; the open will show whether it follows through.",
  "RTH closed. Every block print today is on the HELIX tape for review.",
  "Market closed. The desk reopens at 9:30 ET.",
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

async function fetchBrief(): Promise<string | null> {
  try {
    const res = await fetch("/api/market/flow-brief", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).brief ?? null;
  } catch {
    return null;
  }
}

// No props needed — the server generates one shared brief for every user.
export function FlowBrief() {
  const [brief, setBrief]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [marketOpen, setMarketOpen] = useState(isRTH());

  const refresh = useCallback(async () => {
    if (!isRTH()) {
      setMarketOpen(false);
      return; // preserve last RTH brief text across the 4 PM boundary
    }
    setMarketOpen(true);
    setLoading(true);
    const text = await fetchBrief();
    setLoading(false);
    if (text) setBrief(text);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

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
          background: "linear-gradient(135deg, rgba(191,95,255,0.18) 0%, rgba(8,9,14,0.95) 50%, rgba(7,42,100,0.2) 100%)",
          border: "1px solid rgba(191,95,255,0.35)",
          boxShadow: "0 0 25px rgba(191,95,255,0.12), 0 0 50px rgba(56,189,248,0.06)",
        } : {
          background: "linear-gradient(135deg, rgba(191,95,255,0.14) 0%, rgba(8,9,14,0.7) 40%, rgba(0,230,118,0.08) 100%)",
          border: "1px solid",
          borderImage: "linear-gradient(90deg, rgba(191,95,255,0.6), rgba(0,230,118,0.5)) 1",
          boxShadow: "0 0 30px rgba(191,95,255,0.15), 0 0 60px rgba(0,230,118,0.05)",
        }}
      >
        {/* Top gradient line — only during RTH */}
        {!showAfterHours && (
          <div className="absolute inset-x-0 top-0 h-[2px]" style={{
            background: "linear-gradient(90deg, transparent, #bf5fff, #00e676, transparent)",
            animation: "brief-scan 3s ease-in-out infinite",
          }} />
        )}

        <div className="flex items-start gap-3 px-4 py-3">
          {/* Label */}
          <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
            {showAfterHours ? (
              <>
                <div className="relative">
                  <span className="w-2 h-2 rounded-full block relative z-10" style={{ background: "#bf5fff", boxShadow: "0 0 8px #bf5fff" }} />
                  <span className="absolute inset-0 rounded-full animate-ping opacity-30 motion-reduce:animate-none" style={{ background: "#bf5fff" }} />
                </div>
                <span className="font-mono text-[10px] tracking-[0.35em] uppercase font-bold" style={{ color: "#d580ff", textShadow: "0 0 10px rgba(191,95,255,0.8)" }}>
                  AFTER-HOURS
                </span>
              </>
            ) : (
              <>
                <div className="relative">
                  <span className="w-2 h-2 rounded-full block relative z-10" style={{ background: "#bf5fff", boxShadow: "0 0 8px #bf5fff" }} />
                  <span className="absolute inset-0 rounded-full animate-ping opacity-50 motion-reduce:animate-none" style={{ background: "#bf5fff" }} />
                </div>
                <span className="font-mono text-[10px] tracking-[0.35em] uppercase font-bold" style={{ color: "#d580ff", textShadow: "0 0 8px rgba(191,95,255,0.7)" }}>
                  AI BRIEF
                </span>
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase" style={{ color: "#00e676", textShadow: "0 0 6px rgba(0,230,118,0.6)" }}>
                  · LIVE
                </span>
              </>
            )}
          </div>

          {/* Text */}
          <AnimatePresence mode="wait">
            {loading && !brief ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 space-y-1.5 py-0.5">
                <Skeleton width="100%" height={11} rounded="sm" />
                <Skeleton width="75%" height={11} rounded="sm" />
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
                  color: "#d580ff",
                  fontSize: "11px",
                  fontStyle: "italic",
                  textShadow: "0 0 12px rgba(191,95,255,0.4)",
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
            <span className="flex-shrink-0 font-mono text-[10px] animate-pulse pt-0.5" style={{ color: "#00e676" }}>
              UPDATING
            </span>
          )}
        </div>

        {/* Bottom line — only during RTH */}
        {!showAfterHours && (
          <div className="absolute inset-x-0 bottom-0 h-px" style={{
            background: "linear-gradient(90deg, transparent, rgba(0,230,118,0.3), rgba(191,95,255,0.3), transparent)",
          }} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
