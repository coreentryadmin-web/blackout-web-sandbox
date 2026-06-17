"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { AdminApiDashboard } from "@/components/admin/AdminApiDashboard";
import { AdminSpxDashboard } from "@/components/admin/AdminSpxDashboard";

type ToolTab = "spx" | "nighthawk" | "largo" | "apis";

export function AdminAnalyticsDashboard() {
  const [tab, setTab] = useState<ToolTab>("spx");

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard-header">
        <div>
          <p className="admin-kicker">Blackout · Internal</p>
          <h1 className="admin-title">Analytics Command</h1>
          <p className="admin-sub">Trade alert performance · desk telemetry · signal quality</p>
        </div>
      </header>

      <nav className="admin-tabs">
        {(
          [
            ["spx", "SPX Sniper"],
            ["nighthawk", "Night Hawk"],
            ["largo", "Largo"],
            ["apis", "API Dashboard"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={clsx("admin-tab", tab === id && "admin-tab-active")}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "spx" && <AdminSpxDashboard />}

      {tab === "apis" && <AdminApiDashboard />}

      {tab !== "spx" && tab !== "apis" && (
        <div className="admin-coming-soon">
          <h2>{tab === "nighthawk" ? "Night Hawk" : "Largo"} analytics</h2>
          <p>
            Engine-side outcome logging coming next — same admin shell will host win rate, signal quality, and user
            engagement once we wire the intel engine.
          </p>
        </div>
      )}
    </div>
  );
}
