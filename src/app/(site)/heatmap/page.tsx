import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { ThermalPageShell } from "@/components/desk/ThermalPageShell";

export const metadata: Metadata = {
  title: "BlackOut Thermal · BlackOut",
  description: "Dealer gamma & vanna exposure mapped across the full options chain.",
};

export default async function HeatmapPage() {
  await requireTier("premium");
  if (!(await canAccessTool("heatmap"))) return <ComingSoon toolKey="heatmap" />;

  return <ThermalPageShell />;
}
