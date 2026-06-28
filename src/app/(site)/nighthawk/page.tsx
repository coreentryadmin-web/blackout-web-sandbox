import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { NightHawkFeed } from "@/components/NightHawkFeed";

export const metadata: Metadata = {
  title: "Night Hawk · BlackOut",
  description: "Tomorrow's playbook — evening setups ranked and scored for the next session.",
};

export default async function NightHawkPage() {
  await requireTier("premium");
  if (!(await canAccessTool("nighthawk"))) return <ComingSoon toolKey="nighthawk" />;

  return (
    <PageShell fullBleed contentClassName="!py-0">
      <div className="flex min-h-[calc(100svh-var(--nav-offset))] max-w-none flex-col px-2 pb-4 pt-4 md:px-3">
        <PageHeader
          kicker="Overnight playbook"
          title="Night Hawk"
          subtitle="Tomorrow's ranked setups — published after the close, ready before the open."
          badge={<ProductMark product="nighthawk" size={44} animated={false} />}
          className="mb-3 shrink-0"
        />
        <NightHawkFeed />
      </div>
    </PageShell>
  );
}
