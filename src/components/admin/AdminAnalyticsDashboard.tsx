"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { AdminApiDashboard } from "@/components/admin/AdminApiDashboard";
import { AdminCronDashboard } from "@/components/admin/AdminCronDashboard";
import { AdminNightHawkDashboard } from "@/components/admin/AdminNightHawkDashboard";
import { AdminSpxDashboard } from "@/components/admin/AdminSpxDashboard";
import { AdminOperationsDashboard } from "@/components/admin/AdminOperationsDashboard";
import { AdminHealthBanner } from "@/components/admin/AdminHealthBanner";
import { TabCanvas } from "@/components/admin/AdminUi";
import { Tabs, TabList, Tab, TabPanel } from "@/components/ui";

type ToolTab = "spx" | "nighthawk" | "ops" | "apis" | "crons";

const TABS: Array<{ id: ToolTab; label: string; icon: string; blurb: string }> = [
  { id: "ops",       label: "Operations",  icon: "◉", blurb: "Incidents · audit trail · system vitals" },
  { id: "apis",      label: "API Command", icon: "⬡", blurb: "Live ops · incidents · 265 endpoints" },
  { id: "crons",     label: "Crons",       icon: "⏱", blurb: "Job health · schedules · last run" },
  { id: "spx",       label: "SPX Slayer",  icon: "◎", blurb: "Live engine · outcomes · desk" },
  { id: "nighthawk", label: "Night Hawk",  icon: "◈", blurb: "Target-hit · signal quality" },
];

function parseTab(value: string | null): ToolTab {
  if (value === "spx" || value === "nighthawk" || value === "ops" || value === "apis" || value === "crons")
    return value;
  return "ops";
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
      if (next === "ops") params.delete("tab");
      else params.set("tab", next);
      if (next !== "spx" && next !== "ops") params.delete("section");
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

      <Tabs value={tab} onValueChange={(next) => selectTab(next as ToolTab)}>
        <TabList
          unstyled
          aria-label="Admin sections"
          className="admin-tabs admin-tabs-neon admin-tabs-primary"
        >
          {TABS.map(({ id, label, icon, blurb }) => (
            <Tab
              key={id}
              value={id}
              unstyled
              className={clsx("admin-tab admin-tab-neon", tab === id && "admin-tab-active")}
            >
              <span className="admin-tab-icon">{icon}</span>
              <span className="admin-tab-text">
                <span className="admin-tab-label">{label}</span>
                <span className="admin-tab-blurb">{blurb}</span>
              </span>
            </Tab>
          ))}
        </TabList>

        {/* Single active panel — re-mounts on tab change (key) to replay the entry
            animation, exactly as before. role="tabpanel" + the matching id/labelledby
            wiring comes from TabPanel so the tabs' aria-controls resolves. */}
        <TabPanel value={tab} key={tab} className="admin-tab-panel">
          {tab === "ops" && (
            <TabCanvas theme="neutral">
              <AdminOperationsDashboard />
            </TabCanvas>
          )}
          {tab === "apis" && (
            <TabCanvas theme="api">
              <AdminApiDashboard />
            </TabCanvas>
          )}
          {tab === "crons" && (
            <TabCanvas theme="api">
              <AdminCronDashboard />
            </TabCanvas>
          )}
          {tab === "spx" && (
            <TabCanvas theme="spx">
              <AdminSpxDashboard />
            </TabCanvas>
          )}
          {tab === "nighthawk" && (
            <TabCanvas theme="neutral">
              <AdminNightHawkDashboard />
            </TabCanvas>
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
