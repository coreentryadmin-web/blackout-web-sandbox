import Link from "next/link";

const TOOLS = [
  { label: "SPX Slayer", href: "/dashboard", desc: "0DTE structure desk" },
  { label: "HELIX", href: "/flows", desc: "Institutional options flow" },
  { label: "BlackOut Thermal", href: "/heatmap", desc: "Dealer gamma map" },
  { label: "Largo", href: "/terminal", desc: "AI desk analyst" },
  { label: "Night Hawk", href: "/nighthawk", desc: "Playbook command" },
];

/** Static BIE / platform overview — replaces animated BieBrainBanner (no client JS). */
export function StaticBieSection() {
  return (
    <section id="features" className="border-b border-white/10 px-4 py-16 md:px-8 md:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-cyan-400">BlackOut Intelligence</p>
        <h2 className="mt-2 font-anton text-4xl text-white md:text-5xl">One engine. Five surfaces.</h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-sky-300 md:text-base">
          BIE scores setups, gates alerts, and keeps every tool on the same live tape — without a chat box or
          broker connection.
        </p>
        <div
          className="mt-10 rounded-2xl border border-bull/25 bg-gradient-to-b from-bull/5 to-transparent p-6 md:p-8"
          aria-hidden
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="h-16 w-16 rounded-full border-2 border-bull/40 bg-bull/10 shadow-[0_0_40px_rgba(0,230,118,0.15)]" />
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-bull">Verification gate</p>
            <p className="max-w-md text-sm text-sky-300">Signals pass structure checks before they reach your desk.</p>
          </div>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                prefetch={false}
                className="block rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-bull/30 hover:bg-white/[0.05]"
              >
                <h3 className="font-syne text-lg font-bold text-white">{t.label}</h3>
                <p className="mt-1 text-sm text-sky-300">{t.desc}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
