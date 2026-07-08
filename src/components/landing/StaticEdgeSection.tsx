const GRAD = "linear-gradient(90deg,#00e676,#34d399 55%,#7dd3fc)";

const STEPS = [
  {
    n: "01",
    title: "Read the structure",
    accent: "#00e676",
    desc: "Live SPX, options flow, dealer gamma and dark-pool prints on one surface.",
  },
  {
    n: "02",
    title: "Score the setup",
    accent: "#22d3ee",
    desc: "Graded reads and Largo surface the setup, strike, and invalidation.",
  },
  {
    n: "03",
    title: "Execute on your broker",
    accent: "#bf5fff",
    desc: "We surface structure before price moves. You trade where you already execute.",
  },
];

const PILLARS = [
  { claim: "Professional-grade feeds", proof: "Feeds professional desks pay a premium for.", c: "#00e676" },
  { claim: "Real-time, tick by tick", proof: "Live streams — no 15-minute delays.", c: "#22d3ee" },
  { claim: "Pure intelligence layer", proof: "No order routing — intel, then your trigger.", c: "#bf5fff" },
  { claim: "Built for focused traders", proof: "One decision surface — no noise.", c: "#ff6b2b" },
];

export function StaticEdgeSection() {
  return (
    <section id="edge" className="px-4 py-16 md:px-8 md:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-cyan-400">How it works</p>
        <h2 className="font-anton text-4xl leading-none text-white md:text-6xl">
          READ. SCORE.{" "}
          <span style={{ background: GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            EXECUTE.
          </span>
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              style={{ borderColor: `${s.accent}33` }}
            >
              <span className="font-mono text-sm font-bold" style={{ color: s.accent }}>
                {s.n}
              </span>
              <h3 className="mt-2 font-syne text-xl font-extrabold text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-sky-300">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <div key={p.claim} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="mb-3 inline-block h-2 w-2 rounded-full" style={{ background: p.c }} />
              <h4 className="font-syne text-base font-bold text-white">{p.claim}</h4>
              <p className="mt-2 text-xs leading-relaxed text-sky-300/80">{p.proof}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
