import Link from "next/link";

const TOOLS = [
  { label: "SPX Slayer", href: "/dashboard", desc: "0DTE structure desk", accent: "#00e676" },
  { label: "HELIX", href: "/flows", desc: "Institutional options flow", accent: "#22d3ee" },
  { label: "BlackOut Thermal", href: "/heatmap", desc: "Dealer gamma map", accent: "#bf5fff" },
  { label: "Largo", href: "/terminal", desc: "AI desk analyst", accent: "#ffd23f" },
  { label: "Night Hawk", href: "/nighthawk", desc: "Playbook command", accent: "#ff6b2b" },
];

export function StaticBieSection() {
  return (
    <section id="features" className="mkt-section">
      <div className="mkt-section-inner">
        <p className="mkt-kicker">
          <span className="mkt-kicker-dot" aria-hidden />
          BlackOut Intelligence
        </p>
        <h2 className="mt-3 font-anton text-4xl text-white md:text-5xl">One engine. Five surfaces.</h2>
        <p className="mkt-lede !mx-0 !mt-4 !max-w-2xl !text-left !text-sm md:!text-base">
          BIE scores setups, gates alerts, and keeps every tool on the same live tape — without a chat box or
          broker connection.
        </p>
        <div className="mkt-card-glow mt-10 text-center" aria-hidden>
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-bull/40 bg-bull/10 shadow-[0_0_48px_rgba(0,230,118,0.2)]">
            <span className="font-mono text-2xl text-bull">✓</span>
          </div>
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.35em] text-bull">Verification gate</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-sky-300">
            Signals pass structure checks before they reach your desk.
          </p>
        </div>
        <ul className="mkt-tool-grid">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} prefetch={false} className="mkt-card block h-full no-underline">
                <span className="mb-3 inline-block h-2 w-2 rounded-full" style={{ background: t.accent }} />
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
