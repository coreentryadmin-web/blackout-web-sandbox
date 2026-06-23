// Branded 404 for the App Router. Server component, dependency-light — does not
// import Nav or heavy components so it renders cleanly off the grid.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Off the grid — BlackOut Trading" };

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex max-w-lg flex-col items-center gap-5">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-sky-300">
          ◆ 404 · OFF THE GRID
        </span>

        <h1 className="font-anton text-4xl uppercase leading-[0.95] tracking-tight text-white sm:text-5xl">
          THIS POSITION DOESN&apos;T EXIST.
        </h1>

        <p className="max-w-md text-sky-300">
          That route never made it to the tape. Head back to base and the desk
          picks you up where the signal is live.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/"
            className="rounded-full bg-bull px-6 py-2.5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-black shadow-glow-green transition hover:brightness-110"
          >
            Return to base →
          </Link>
          <Link
            href="/#features"
            className="rounded-full border border-bull/40 px-6 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-bull transition hover:bg-bull/10"
          >
            The Arsenal
          </Link>
        </div>
      </div>
    </main>
  );
}
