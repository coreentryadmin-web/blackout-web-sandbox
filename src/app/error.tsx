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
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex max-w-lg flex-col items-center gap-5">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-mute">
          Something went wrong
        </span>

        <h1 className="font-anton text-4xl leading-[0.95] tracking-tight text-white sm:text-5xl">
          We couldn&apos;t load this page.
        </h1>

        <p className="max-w-md text-secondary">
          Try again. If the problem persists, return home and reopen the desk.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-bull px-6 py-2.5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-[#021c14] shadow-glow-green transition hover:brightness-110"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full border border-white/15 px-6 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-secondary transition hover:border-white/25 hover:text-white"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
