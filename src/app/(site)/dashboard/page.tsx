import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { SpxDashboard } from "@/components/SpxDashboard";
import { DeskShell } from "@/components/desk/DeskShell";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "SPX Slayer · BlackOut",
  description: "Live SPX structure — GEX walls, dealer positioning, and session levels.",
};

export default async function DashboardPage() {
  await requireTier("premium");

  return (
    <DeskShell fullBleed>
      <SpxDashboard />
    </DeskShell>
  );
}
