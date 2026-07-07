import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { GridPageShell } from "@/components/desk/GridPageShell";

export const metadata: Metadata = {
  title: "0DTE Command · BlackOut",
  description:
    "The always-on 0DTE hunter — scans the tape all session for new single-name plays, cross-checks every find against the full evidence stack, and keeps a graded ledger.",
};

export default async function GridPage() {
  await requireTier("premium");
  if (!(await canAccessTool("grid"))) return <ComingSoon toolKey="grid" />;

  return <GridPageShell />;
}
