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
  /** Hide panel header — used for full-page Largo layout */
  bare?: boolean;
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
  bare,
}: DeskPanelProps) {
  return (
    <div className={clsx("desk-panel", VARIANTS[variant], glow && "desk-panel-glow", className)}>
      {!bare && (
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
      )}
      <div className={clsx("desk-panel-body", bare && "desk-panel-body-bare")}>{children}</div>
      <div className="desk-panel-scan" aria-hidden />
    </div>
  );
}
