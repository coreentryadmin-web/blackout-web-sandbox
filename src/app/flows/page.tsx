import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { FlowFeed } from "@/components/FlowFeed";
import { DnaHelixBackground } from "@/components/DnaHelixBackground";

export default async function FlowsPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden">
      {/* Animated DNA helix wallpaper — fixed behind all content */}
      <DnaHelixBackground />

      {/* All content sits above the background */}
      <div className="relative" style={{ zIndex: 1 }}>
        <Nav />
        <PlatformShell
          variant="flows"
          title="HELIX"
          subtitle="Whale & dark pool alerts · Real-time tape"
          deskMode
          fullWidth
        >
          <FlowFeed />
        </PlatformShell>
      </div>
    </div>
  );
}
