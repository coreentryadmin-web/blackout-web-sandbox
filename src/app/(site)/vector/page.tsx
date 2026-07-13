import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import {
  VectorPageShell,
  loadVectorSeedProps,
  normalizeVectorTicker,
} from "@/features/vector";

export const metadata: Metadata = {
  title: "Vector · BlackOut",
  description: "Live price action with GEX/VEX wall beads, flip levels, and dark-pool overlays.",
};

type PageProps = {
  searchParams: Promise<{ ticker?: string }>;
};

export default async function VectorPage({ searchParams }: PageProps) {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  const { ticker: rawTicker } = await searchParams;
  const ticker = normalizeVectorTicker(rawTicker);

  // Shared seed loader (2026-07-13, member-directed desk consolidation): the SPX Slayer dashboard
  // embeds this same Vector surface, so ALL seed logic (bars, wall scope, observed-rail merge,
  // modeled-prefix backfill, empty-case seeding) lives in loadVectorSeedProps — one code path for
  // both routes, zero drift.
  const seed = await loadVectorSeedProps(ticker);

  return <VectorPageShell {...seed} />;
}
