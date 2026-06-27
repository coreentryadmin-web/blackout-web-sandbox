"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui";

// ── Types ────────────────────────────────────────────────────────────────────

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface FlowAnomaly {
  id: string;
  detectedAt: string; // ISO
  type: string;
  ticker: string;
  detail: string;
  premium: number;
  direction: string;
  severity: Severity;
}

interface AnomaliesResponse {
  anomalies: FlowAnomaly[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const POLL_MS = 20_000;
const RECENCY_MS = 15 * 60 * 1000; // 15 min

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecent(detectedAt: string): boolean {
  return Date.now() - new Date(detectedAt).getTime() < RECENCY_MS;
}

function severityTone(s: Severity): "bear" | "bull" | "sky" | "neutral" {
  if (s === "CRITICAL" || s === "HIGH") return "bear";
  if (s === "MEDIUM") return "sky";
  return "neutral";
}

// ── Component ────────────────────────────────────────────────────────────────

export function FlowAnomalyBanner() {
  const [anomalies, setAnomalies] = useState<FlowAnomaly[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) { pending.current = true; return; }
    inFlight.current = true;
    try {
      let runAgain = true;
      while (runAgain) {
        pending.current = false;
        try {
          const res = await fetch("/api/market/anomalies", { cache: "no-store" });
          if (res.ok) {
            const data: AnomaliesResponse = await res.json() as AnomaliesResponse;
            const recent = (data.anomalies ?? []).filter((a) => isRecent(a.detectedAt));
            setAnomalies(recent);
          }
        } catch {
          // silent — stale data preferred over error flash
        }
        runAgain = pending.current;
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  if (dismissed || anomalies.length === 0) return null;

  const hasCritical = anomalies.some((a) => a.severity === "CRITICAL");

  return (
    <div
      className={clsx(
        "relative mb-4 rounded-xl border px-4 py-3",
        hasCritical
          ? "border-bear/40 bg-bear/[0.08]"
          : "border-gold/30 bg-gold/[0.06]",
      )}
      role="alert"
      aria-live="polite"
    >
      {/* Header row */}
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Alert icon */}
          <span
            className={clsx(
              "font-mono text-[14px] leading-none",
              hasCritical ? "text-bear-text" : "text-gold",
              hasCritical && "animate-pulse",
            )}
            aria-hidden
          >
            ⚠
          </span>
          <span
            className={clsx(
              "font-mono text-[10px] uppercase tracking-[0.16em] font-semibold",
              hasCritical ? "text-bear-text" : "text-gold",
            )}
          >
            Flow Anomalies Detected
          </span>
          <span className="font-mono text-[9px] text-mute tabular-nums">
            ({anomalies.length})
          </span>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="font-mono text-[9px] uppercase tracking-[0.14em] text-mute transition-colors hover:text-white"
          aria-label="Dismiss anomaly banner"
        >
          Dismiss
        </button>
      </div>

      {/* Anomaly list */}
      <ul className="flex flex-col gap-2">
        {anomalies.map((a) => (
          <li
            key={a.id}
            className={clsx(
              "flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2",
              a.severity === "CRITICAL"
                ? "border-bear/30 bg-bear/[0.07] animate-pulse"
                : "border-white/[0.06] bg-white/[0.025]",
            )}
          >
            {/* Severity badge */}
            <Badge tone={severityTone(a.severity)} size="sm">
              {a.severity}
            </Badge>

            {/* Ticker */}
            <span className="font-mono text-[12px] font-semibold text-white tabular-nums">
              {a.ticker}
            </span>

            {/* Direction chip */}
            <span
              className={clsx(
                "font-mono text-[10px] uppercase tracking-[0.1em]",
                a.direction?.toUpperCase() === "CALL" || a.direction?.toUpperCase() === "BULLISH"
                  ? "text-bull"
                  : "text-bear-text",
              )}
            >
              {a.direction}
            </span>

            {/* Detail text */}
            <span className="font-mono text-[11px] text-mute">
              {a.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
