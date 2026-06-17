import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { NightHawkFeed } from "@/components/NightHawkFeed";

export default async function NightHawkPage() {
  await requireTier("premium");

  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main">
        <div className="page-header">
          <h1 className="page-title">NIGHT HAWK</h1>
          <span className="page-subtitle">2–10 DTE Swing Plays</span>
        </div>
        <NightHawkFeed />
      </main>
    </div>
  );
}
