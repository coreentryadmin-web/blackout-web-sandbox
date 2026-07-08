import Link from "next/link";
import { SITE } from "@/lib/site";
import { StaticHeroDeskMock } from "./StaticHeroDeskMock";

/** Server-rendered hero with CSS-only motion — split layout + desk mock on desktop. */
export function StaticLandingHero() {
  return (
    <section className="mkt-section mkt-hero border-b-0">
      <div className="mkt-section-inner mkt-hero-grid">
        <div className="mkt-hero-copy mkt-reveal">
          <p className="mkt-kicker">
            <span className="mkt-kicker-dot" aria-hidden />
            Institutional options desk
          </p>
          <h1 className="mkt-headline mkt-headline-left">
            <span className="block">See the structure.</span>
            <span className="block mkt-gradient-text">Make the call.</span>
          </h1>
          <p className="mkt-lede mkt-lede-left">{SITE.description}</p>
          <div className="mkt-cta-row mkt-cta-row-left">
            <Link
              href="/sign-up"
              prefetch={false}
              className="landing-btn-primary inline-flex min-w-[200px] items-center justify-center px-8 py-3 font-syne text-sm font-bold uppercase tracking-[0.2em]"
            >
              Start trading
            </Link>
          <Link
            href="/sign-in"
            prefetch={false}
            className="landing-btn-ghost hide-in-ios-app inline-flex min-w-[200px] items-center justify-center border border-white/20 px-8 py-3 font-syne text-sm font-bold uppercase tracking-[0.2em] text-white"
          >
            Sign in
          </Link>
          </div>
          <ul className="mkt-cred-strip mkt-cred-strip-left">
            {["Professional-grade feeds", "Recorded at generation time", "Your broker, your trigger"].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="mkt-hero-visual mkt-reveal">
          <StaticHeroDeskMock />
        </div>
      </div>
    </section>
  );
}
