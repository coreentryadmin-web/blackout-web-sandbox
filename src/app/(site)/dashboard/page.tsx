import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { SpxDashboard } from "@/features/spx";
import { DeskShell } from "@/components/layout/DeskShell";
import { loadVectorSeedProps, type VectorSeedProps } from "@/features/vector";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "SPX Slayer · BlackOut",
  description: "Live SPX structure — GEX walls, dealer positioning, and session levels.",
};

export default async function DashboardPage() {
  await requireTier("premium");

  // DESK CONSOLIDATION (2026-07-13, member-directed): the flagship desk embeds the SPX Vector
  // chart (chart-only — no terminal) where the Trade Alerts + Slayer terminal panels used to be.
  // The seed comes from the SAME loadVectorSeedProps helper the /vector page uses, so the two
  // surfaces can never drift. Vector is still launch-gated (tool-access): if this account can't
  // see the /vector tool yet, we pass null and the desk shows a launching-soon note instead of a
  // chart whose API calls would 403. Seed failures degrade the same way rather than 500ing the
  // whole flagship desk.
  let vectorSeed: VectorSeedProps | null = null;
  if (await canAccessTool("vector")) {
    vectorSeed = await loadVectorSeedProps("SPX").catch(() => null);
  }

  return (
    <DeskShell fullBleed className="ios-native-page ios-native-page-spx">
      <SpxDashboard vectorSeed={vectorSeed} />
    </DeskShell>
  );
}
