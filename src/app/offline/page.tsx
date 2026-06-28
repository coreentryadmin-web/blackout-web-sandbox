// Offline app-shell fallback served by the service worker when navigation fails.
// No data fetching, no auth — must render fully from cache. Dependency-light on
// purpose (Link only), but on-brand to match the route-state pages (not-found.tsx).
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Offline — BlackOut" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex max-w-lg flex-col items-center gap-5">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-mute">
          Offline
        </span>

        <h1 className="font-anton text-4xl leading-[0.95] tracking-tight text-white sm:text-5xl">
          You&apos;re offline.
        </h1>

        <p className="max-w-md text-secondary">
          Live flow and SPX structure need a connection. Reconnect and your session will resume.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/"
            className="rounded-full bg-bull px-6 py-2.5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-[#021c14] shadow-glow-green transition hover:brightness-110"
          >
            Go home
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-white/15 px-6 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-secondary transition hover:border-white/25 hover:text-white"
          >
            Open desk
          </Link>
        </div>
      </div>
    </main>
  );
}
