"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { AdminApiDashboard } from "@/components/admin/AdminApiDashboard";
import { AdminSpxDashboard } from "@/components/admin/AdminSpxDashboard";
import { AdminHealthBanner } from "@/components/admin/AdminHealthBanner";
import { ActionButton, TabCanvas } from "@/components/admin/AdminUi";

type ToolTab = "spx" | "nighthawk" | "largo" | "apis";

const TABS: Array<{ id: ToolTab; label: string; icon: string; blurb: string }> = [
  { id: "apis", label: "API Command", icon: "⬡", blurb: "Live ops · incidents · 265 endpoints" },
  { id: "spx", label: "SPX Sniper", icon: "◎", blurb: "Live engine · outcomes · desk" },
  { id: "nighthawk", label: "Night Hawk", icon: "◈", blurb: "Coming soon" },
  { id: "largo", label: "Largo", icon: "◆", blurb: "Coming soon" },
];

function parseTab(value: string | null): ToolTab {
  if (value === "spx" || value === "nighthawk" || value === "largo" || value === "apis") return value;
  return "apis";
}

export function AdminAnalyticsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<ToolTab>(() => parseTab(searchParams.get("tab")));

  useEffect(() => {
    setTab(parseTab(searchParams.get("tab")));
  }, [searchParams]);

  const selectTab = useCallback(
    (next: ToolTab) => {
      setTab(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === "apis") params.delete("tab");
      else params.set("tab", next);
      if (next !== "spx") params.delete("section");
      const qs = params.toString();
      router.replace(qs ? `/admin?${qs}` : "/admin", { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <div className="admin-dashboard">
      <div className="admin-mesh" aria-hidden>
        <div className="admin-mesh-orb admin-mesh-orb-a" />
        <div className="admin-mesh-orb admin-mesh-orb-b" />
        <div className="admin-mesh-orb admin-mesh-orb-c" />
        <div className="admin-mesh-grid" />
      </div>

      <AdminHealthBanner />

      <nav className="admin-tabs admin-tabs-neon admin-tabs-primary">
        {TABS.map(({ id, label, icon, blurb }) => (
          <button
            key={id}
            type="button"
            className={clsx("admin-tab admin-tab-neon", tab === id && "admin-tab-active")}
            onClick={() => selectTab(id)}
          >
            <span className="admin-tab-icon">{icon}</span>
            <span className="admin-tab-text">
              <span className="admin-tab-label">{label}</span>
              <span className="admin-tab-blurb">{blurb}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="admin-tab-panel" key={tab}>
        {tab === "apis" && (
          <TabCanvas theme="api">
            <AdminApiDashboard />
          </TabCanvas>
        )}
        {tab === "spx" && (
          <TabCanvas theme="spx">
            <AdminSpxDashboard />
          </TabCanvas>
        )}
        {tab !== "spx" && tab !== "apis" && (
          <TabCanvas theme="neutral">
            <div className="admin-coming-soon admin-coming-soon-neon">
              <p className="admin-kicker">{tab === "nighthawk" ? "Night Hawk" : "Largo"}</p>
              <h2 className="admin-deck-heading">Intel engine analytics incoming</h2>
              <p>Win rate, signal quality, and engagement telemetry will land in this slot next.</p>
              <ActionButton variant="primary" onClick={() => selectTab("apis")}>
                Back to API Command
              </ActionButton>
            </div>
          </TabCanvas>
        )}
      </div>
    </div>
  );
}
