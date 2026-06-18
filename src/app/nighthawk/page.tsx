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
        fullWidth
      >
        <NightHawkFeed />
      </PlatformShell>

      <div className="nighthawk-ops-badge">
        <span className="nighthawk-ops-badge-dot" />
        Night Ops Active
      </div>
    </div>
  );
}
