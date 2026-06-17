import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { NightHawkFeed } from "@/components/NightHawkFeed";

export default async function NightHawkPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden">
      <Nav />
      <PlatformShell
        variant="nighthawk"
        title="Night Hawk"
        subtitle="2–10 DTE swing plays · Full dossier intel"
      >
        <NightHawkFeed />
      </PlatformShell>
    </div>
  );
}
