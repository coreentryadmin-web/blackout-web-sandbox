import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { AtlasPageShell } from "@/components/atlas/AtlasPageShell";
import type { AtlasBar } from "@/components/atlas/AtlasChart";
import { fetchIndexMinuteBars } from "@/lib/providers/polygon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { UTCTimestamp } from "lightweight-charts";

export const metadata: Metadata = {
  title: "Atlas · BlackOut",
  description: "Live SPX price action with real-time dark-pool, flow, and GEX level overlays.",
};

async function readInitialBars(): Promise<AtlasBar[]> {
  const today = todayEtYmd();
  const bars = await fetchIndexMinuteBars("I:SPX", today, today).catch(() => []);
  return bars
    .filter((b) => typeof b.t === "number" && b.o > 0)
    .map((b) => ({
      time: Math.floor((b.t as number) / 1000) as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
}

export default async function AtlasPage() {
  await requireTier("premium");
  if (!(await canAccessTool("atlas"))) return <ComingSoon toolKey="atlas" />;

  const initialBars = await readInitialBars();

  return <AtlasPageShell initialBars={initialBars} />;
}
