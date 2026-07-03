"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// BIE isn't another instrument card — it's the layer that watches every other
// one, continuously. This gets its own bespoke "living core" treatment instead
// of the static per-product sigil (ProductMark/geometry.tsx): a pulsing
// core, radar rings expanding outward, an orbiting scan ring, and a
// terminal-style readout cycling through the actual categories of thing BIE
// checks (data integrity, cron health, audit-trail dedup, Railway infra) —
// real category labels, not invented telemetry.

const READOUT_LINES = [
  "verifying every heat map, GEX read, and play against source data",
  "cron & worker health — 20+ jobs tracked, schedule-aware",
  "alert_audit_log — every 0DTE and Night Hawk alert, one unified trail",
  "duplicate-alert check — dedup invariants verified against production",
  "Railway deploy, CPU, memory, and env-var presence — live",
  "the model never invents a number — every claim checked against the data",
];

const RING_COUNT = 3;

export function BieCoreVisual({ size = 128 }: { size?: number }) {
  const [lineIndex, setLineIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setLineIndex((i) => (i + 1) % READOUT_LINES.length), 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bie-core-wrap" aria-hidden>
      <div className="bie-core-visual" style={{ width: size, height: size }}>
        {Array.from({ length: RING_COUNT }).map((_, i) => (
          <span
            key={i}
            className="bie-core-ring"
            style={{ animationDelay: `${i * 1.1}s` }}
          />
        ))}
        <span className="bie-core-orbit" />
        <motion.span
          className="bie-core-nucleus"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="bie-core-nucleus-glyph">BIE</span>
        </motion.span>
      </div>
      <div className="bie-core-readout" role="status">
        <span className="bie-core-readout-dot" />
        <span className="bie-core-readout-text">
          {mounted ? READOUT_LINES[lineIndex] : READOUT_LINES[0]}
        </span>
        <span className="bie-core-readout-cursor" aria-hidden>
          _
        </span>
      </div>
    </div>
  );
}
