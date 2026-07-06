import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { NighthawkPageShell } from "@/components/desk/NighthawkPageShell";

export const metadata: Metadata = {
  title: "Night Hawk · BlackOut",
  description: "Tomorrow's playbook — evening setups ranked and scored for the next session.",
};

export default async function NightHawkPage() {
  await requireTier("premium");
  if (!(await canAccessTool("nighthawk"))) return <ComingSoon toolKey="nighthawk" />;

  return <NighthawkPageShell />;
}
