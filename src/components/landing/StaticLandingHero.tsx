import Link from "next/link";
import { SITE } from "@/lib/site";

const GRAD = "linear-gradient(90deg,#00e676,#34d399 55%,#7dd3fc)";

/** Server-rendered hero — no banner image, no framer-motion, no client JS. */
export function StaticLandingHero() {
  return (
    <section className="relative border-b border-white/10 px-4 pb-16 pt-20 md:px-8 md:pb-20 md:pt-24">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 text-center">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.32em] text-bull">
          Institutional options desk
        </p>
        <h1 className="font-anton text-4xl leading-[0.95] tracking-tight text-white md:text-6xl lg:text-7xl">
          <span className="block">See the structure.</span>
          <span
            className="block"
            style={{
              background: GRAD,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Make the call.
          </span>
        </h1>
        <p className="mx-auto max-w-2xl text-base leading-relaxed text-sky-300 md:text-lg">
          {SITE.description}
        </p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
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
            className="landing-btn-ghost hide-in-ios-app inline-flex min-w-[200px] items-center justify-center px-8 py-3 font-syne text-sm font-bold uppercase tracking-[0.2em]"
          >
            Sign in
          </Link>
        </div>
        <ul className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-sky-300/90">
          {["Professional-grade feeds", "Recorded at generation time", "Your broker, your trigger"].map((t) => (
            <li key={t} className="font-mono uppercase tracking-[0.18em]">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
