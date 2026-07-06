import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { HelixPageShell } from "@/components/desk/HelixPageShell";

export const metadata: Metadata = {
  title: "HELIX · BlackOut",
  description: "Whale & dark-pool options flow — real-time institutional tape.",
};

export default async function FlowsPage() {
  await requireTier("premium");

  return <HelixPageShell />;
}
