import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { FlowFeed } from "@/components/FlowFeed";

export default async function FlowsPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden">
      <Nav />
      <PlatformShell
        variant="flows"
        title="Flow Feed"
        subtitle="Whale & dark pool alerts · Real-time tape"
      >
        <FlowFeed />
      </PlatformShell>
    </div>
  );
}
