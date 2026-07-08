import Link from "next/link";

export function StaticClosingCta() {
  return (
    <section className="mkt-closing-cta">
      <div className="mkt-section-inner mkt-closing-inner">
        <p className="mkt-kicker justify-center">
          <span className="mkt-kicker-dot" aria-hidden />
          Ready when you are
        </p>
        <h2 className="mt-3 text-center font-anton text-4xl leading-[0.92] text-white md:text-6xl">
          STOP TRADING <span className="mkt-gradient-text">BLIND.</span>
        </h2>
        <p className="mkt-lede text-center">
          Six modules. One verified tape. Your broker, your trigger — start with the full desk today.
        </p>
        <div className="mkt-cta-row mt-8">
          <Link
            href="/sign-up"
            prefetch={false}
            className="landing-btn-primary inline-flex min-w-[220px] items-center justify-center px-8 py-3.5 font-syne text-sm font-bold uppercase tracking-[0.2em]"
          >
            Get started
          </Link>
          <Link
            href="/pricing"
            prefetch={false}
            className="landing-btn-ghost hide-in-ios-app inline-flex min-w-[220px] items-center justify-center border border-white/20 px-8 py-3.5 font-syne text-sm font-bold uppercase tracking-[0.2em] text-white"
          >
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
