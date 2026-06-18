"use client";

import { motion } from "framer-motion";
import type { ApiCallEvent } from "@/lib/api-telemetry";

export function AdminApiCallTimeline({
  events,
  onSelect,
  selectedId,
}: {
  events: ApiCallEvent[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const maxLatency = Math.max(100, ...events.map((e) => e.latency_ms));

  return (
    <section className="admin-cmd-timeline">
      <div className="admin-cmd-timeline-head">
        <h3 className="admin-cmd-timeline-title">Call timeline</h3>
        <span className="admin-api-muted">{events.length} recent · click bar for details</span>
      </div>
      <div className="admin-cmd-timeline-track">
        {events.slice(0, 48).map((ev, i) => (
          <motion.button
            key={ev.id}
            type="button"
            title={`${ev.provider} ${ev.endpoint} · ${ev.latency_ms}ms`}
            className={`admin-cmd-timeline-bar ${ev.ok ? "admin-cmd-timeline-bar-ok" : "admin-cmd-timeline-bar-fail"} ${selectedId === ev.id ? "admin-cmd-timeline-bar-active" : ""}`}
            style={{ height: `${Math.max(12, (ev.latency_ms / maxLatency) * 100)}%` }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ delay: i * 0.015, type: "spring", stiffness: 500, damping: 28 }}
            onClick={() => onSelect(ev.id)}
          />
        ))}
      </div>
    </section>
  );
}
