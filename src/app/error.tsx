"use client";

// Route-level error boundary for the App Router. Client component (required by
// Next). Dependency-light — must render even when the rest of the tree faulted,
// so no Nav / heavy imports. The raw error is never shown to the user.
import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console for diagnostics; never render the raw error.
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex max-w-lg flex-col items-center gap-5">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-sky-300">
          ◆ SYSTEM FAULT
        </span>

        <h1 className="font-anton text-4xl uppercase leading-[0.95] tracking-tight text-white sm:text-5xl">
          THE DESK HIT A SNAG.
        </h1>

        <p className="max-w-md text-sky-300">
          Something tripped on the wire. Retry the request — if it keeps faulting,
          fall back to base and the terminal reconnects.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-bull px-6 py-2.5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-black shadow-glow-green transition hover:brightness-110"
          >
            Retry
          </button>
          <Link
            href="/"
            className="rounded-full border border-bull/40 px-6 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-bull transition hover:bg-bull/10"
          >
            Return to base →
          </Link>
        </div>
      </div>
    </main>
  );
}
