import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { LargoPageShell } from "@/features/largo/components/LargoPageShell";

export const metadata: Metadata = {
  title: "Largo · BlackOut",
  description: "Your AI desk officer — live desk intel grounded in BlackOut's tools.",
};

export default async function TerminalPage() {
  await requireTier("premium");
  if (!(await canAccessTool("largo"))) return <ComingSoon toolKey="largo" />;

  return <LargoPageShell />;
}
