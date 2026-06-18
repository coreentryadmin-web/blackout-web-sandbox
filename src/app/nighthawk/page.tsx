import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { NightHawkFeed } from "@/components/NightHawkFeed";
import { NightHawkRadarBackdrop } from "@/components/nighthawk/NightHawkRadarBackdrop";

export default async function NightHawkPage() {
  await requireTier("premium");

  return (
    <div className="page-shell nighthawk-page-shell relative overflow-hidden min-h-screen">
      <NightHawkRadarBackdrop />
      <div className="nv-scanlines" aria-hidden />
      <Nav />
      <PlatformShell
        variant="nighthawk"
        title="Night Hawk"
        subtitle="Tomorrow's playbook · Hunt modes"
        deskMode
        frameless
      >
        <NightHawkFeed />
      </PlatformShell>
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 font-mono text-[9px] tracking-[0.3em] uppercase text-cyan bg-black/80 border border-cyan/30 px-3 py-2 backdrop-blur-md">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse" />
        Night Ops Active
      </div>
    </div>
  );
}
