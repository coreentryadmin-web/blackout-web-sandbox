"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";

type DeskPanelProps = {
  title: string;
  subtitle?: string;
  variant?: "green" | "purple" | "red" | "neutral";
  className?: string;
  children: ReactNode;
  live?: boolean;
  feedStatus?: "live" | "reconnecting";
  glow?: boolean;
};

const VARIANTS = {
  green: "desk-panel-green",
  purple: "desk-panel-purple",
  red: "desk-panel-red",
  neutral: "desk-panel-neutral",
};

export function DeskPanel({
  title,
  subtitle,
  variant = "neutral",
  className,
  children,
  live,
  feedStatus,
  glow,
}: DeskPanelProps) {
  return (
    <div className={clsx("desk-panel", VARIANTS[variant], glow && "desk-panel-glow", className)}>
      <div className="desk-panel-header">
        <div>
          <p className="desk-panel-title">{title}</p>
          {subtitle && <p className="desk-panel-subtitle">{subtitle}</p>}
        </div>
        {feedStatus === "live" && (
          <span className="badge-live text-[9px]">
            <span className="badge-live-dot" />
            LIVE
          </span>
        )}
        {feedStatus === "reconnecting" && (
          <span className="badge-reconnecting text-[9px]">
            <span className="badge-offline-dot" />
            RECONNECTING
          </span>
        )}
        {feedStatus === undefined && live && (
          <span className="badge-live text-[9px]">
            <span className="badge-live-dot" />
            Live
          </span>
        )}
      </div>
      <div className="desk-panel-body">{children}</div>
      <div className="desk-panel-scan" aria-hidden />
    </div>
  );
}
