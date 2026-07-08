import { FAQ_CATEGORIES, FAQ_ITEMS } from "@/lib/faq/content";

/** Native details accordion — zero client JS on web FAQ. */
export function StaticFaqSection() {
  return (
    <section id="faq" className="mkt-section border-b-0">
      <div className="mkt-section-inner max-w-3xl">
        <p className="mkt-kicker">
          <span className="mkt-kicker-dot" aria-hidden />
          The Briefing
        </p>
        <h2 className="mt-3 font-anton text-4xl text-white md:text-5xl">
          EVERYTHING, <span className="mkt-gradient-text">EXPLAINED.</span>
        </h2>
        <p className="mkt-lede !mx-0 !mt-4 !max-w-xl !text-left !text-sm">
          Platform, instruments, signals, and membership — no sales script.
        </p>

        <div className="mt-10 flex flex-wrap gap-2">
          {FAQ_CATEGORIES.map((c) => (
            <span
              key={c.key}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300"
            >
              {c.label}
            </span>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3">
          {FAQ_ITEMS.map((item) => (
            <details key={item.id} id={item.id} className="mkt-card group">
              <summary className="cursor-pointer list-none font-syne text-base font-bold text-white marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="mr-2 font-mono text-xs text-bull/80">{item.cat}</span>
                {item.q}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-sky-300">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
