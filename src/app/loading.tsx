// Route-level loading UI for the App Router. Server component, dependency-light —
// renders on any navigation/suspense boundary so it must not pull in Nav or data.
export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex flex-col items-center gap-6">
        <span className="relative grid h-12 w-12 place-items-center" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border border-bull/30 motion-reduce:opacity-60" />
          <span
            className="h-2.5 w-2.5 rounded-full bg-bull shadow-glow-green motion-reduce:animate-none animate-pulse"
            style={{ animationDuration: "1.8s" }}
          />
        </span>

        <span className="font-anton text-3xl tracking-tight text-white md:text-4xl">
          BlackOut
        </span>

        <span className="font-mono text-xs uppercase tracking-[0.28em] text-mute">
          Loading
        </span>
      </div>
    </main>
  );
}
