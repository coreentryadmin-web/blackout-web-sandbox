// Route-level loading UI for the App Router. Server component, dependency-light —
// renders on any navigation/suspense boundary so it must not pull in Nav or data.
export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex flex-col items-center gap-6">
        {/* Emerald pulsing ring + dot. Reduced-motion safe. */}
        <span className="relative grid h-12 w-12 place-items-center" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border border-bull/40 animate-pulse motion-reduce:animate-none" />
          <span className="h-2.5 w-2.5 rounded-full bg-bull shadow-glow-green animate-pulse motion-reduce:animate-none" />
        </span>

        <span className="font-anton text-4xl uppercase tracking-[0.18em] text-white">
          BLACKOUT
        </span>

        <span className="font-mono text-xs uppercase tracking-[0.3em] text-sky-300">
          Securing the feed…
        </span>
      </div>
    </main>
  );
}
