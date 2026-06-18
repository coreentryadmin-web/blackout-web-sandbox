import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { LargoTerminal } from "@/components/desk/LargoTerminal";

export default async function TerminalPage() {
  await requireTier("premium");

  return (
    <div className="largo-page-shell">
      <Nav />
      <main className="largo-page-main">
        <header className="largo-page-header">
          <div>
            <p className="largo-page-kicker">◆ AI DESK — LARGO</p>
            <h1 className="largo-page-title">Neural Terminal</h1>
            <p className="largo-page-subtitle">
              Live market intelligence ·{" "}
              <span className="largo-page-subtitle-accent">Partner In Crime</span>
            </p>
          </div>
          <span className="badge-ai largo-page-badge">
            <span className="badge-live-dot" />
            AI Online
          </span>
        </header>
        <LargoTerminal fullPage />
      </main>
      <div className="platform-ambient platform-ambient-largo" aria-hidden />
      <div className="platform-dot-grid" aria-hidden />
    </div>
  );
}
