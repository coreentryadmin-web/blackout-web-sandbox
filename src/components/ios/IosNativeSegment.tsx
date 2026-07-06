"use client";

import { clsx } from "clsx";
import { motion } from "framer-motion";

type Segment<T extends string> = {
  id: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  onChange: (id: T) => void;
  segments: Segment<T>[];
  accent?: string;
  className?: string;
  "aria-label"?: string;
};

const SEGMENT_SPRING = { type: "spring" as const, stiffness: 520, damping: 42 };

/** Lens rail — sharp institutional view switcher (not pill tabs). */
export function IosNativeSegment<T extends string>({
  value,
  onChange,
  segments,
  accent = "#00e676",
  className,
  "aria-label": ariaLabel = "View lens",
}: Props<T>) {
  return (
    <div
      className={clsx("ios-native-segment", className)}
      role="tablist"
      aria-label={ariaLabel}
      style={{ "--segment-accent": accent } as React.CSSProperties}
    >
      {segments.map((seg) => {
        const active = value === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={clsx("ios-native-segment-btn", active && "ios-native-segment-btn-active")}
            onClick={() => onChange(seg.id)}
          >
            {active && (
              <motion.span
                layoutId="ios-native-segment-indicator"
                className="ios-native-segment-indicator"
                transition={SEGMENT_SPRING}
                aria-hidden
              />
            )}
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
