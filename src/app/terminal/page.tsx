import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { LargoTerminal } from "@/components/LargoTerminal";
import { IMAGES } from "@/lib/images";

export default async function TerminalPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden flex flex-col min-h-screen">
      <Nav />
      <PlatformShell
        variant="largo"
        title="AI Terminal"
        subtitle="Largo — Desk-grade market intelligence"
        imageSrc={IMAGES.largo}
        imageAlt="BlackOut Largo — AI trading terminal"
      >
        <LargoTerminal />
      </PlatformShell>
    </div>
  );
}
