import Link from "next/link";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

const PREMIUM = [
  "HELIX live options-flow feed",
  "SPX Slayer · 0DTE desk",
  "Largo desk analyst",
  "Dealer gamma / GEX positioning",
  "Dark-pool prints",
  "Night Hawk evening playbook",
  "Strike-level heatmaps",
  "Transparent play log, graded A–F",
];

/** Static pricing — no framer-motion; both plans visible (no toggle JS). */
export function StaticPricingSection() {
  const yearlyHref = WHOP_CHECKOUT.yearly || WHOP_CHECKOUT.store || "/sign-up";
  const monthlyHref = WHOP_CHECKOUT.monthly || WHOP_CHECKOUT.store || "/sign-up";

  return (
    <section id="pricing" className="mkt-section border-b-0">
      <div className="mkt-section-inner max-w-5xl">
        <p className="mkt-kicker justify-center">
          <span className="mkt-kicker-dot" aria-hidden />
          Pricing
        </p>
        <h2 className="mt-3 text-center font-anton text-4xl leading-[0.92] text-white md:text-[4rem]">
          THE INSTITUTIONAL EDGE,
          <br />
          <span className="mkt-gradient-text">PRICED FOR RETAIL.</span>
        </h2>
        <p className="mkt-lede text-center">
          One membership. Every instrument on the desk. No tiers, no add-ons.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="mkt-card mkt-card-glow flex flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-bull">Recommended</p>
            <p className="mt-4 font-anton text-5xl text-white">
              $1,999<span className="font-syne text-lg font-semibold text-sky-300"> / year</span>
            </p>
            <p className="mt-2 text-sm text-sky-300">≈ $167/mo · Save $389 vs monthly</p>
            <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-white/85">
              {PREMIUM.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-bull">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={yearlyHref}
              prefetch={false}
              className="landing-btn-primary mt-8 inline-flex items-center justify-center px-6 py-3 font-syne text-sm font-bold uppercase tracking-[0.18em]"
              {...(yearlyHref.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              Join yearly
            </Link>
          </div>

          <div className="mkt-card flex flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-sky-300">Monthly</p>
            <p className="mt-4 font-anton text-5xl text-white">
              $199<span className="font-syne text-lg font-semibold text-sky-300"> / month</span>
            </p>
            <p className="mt-2 text-sm text-sky-300">Billed monthly · stand down anytime</p>
            <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-white/85">
              {PREMIUM.slice(0, 5).map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-bull">✓</span>
                  {f}
                </li>
              ))}
              <li className="text-sky-300/70">+ full desk access</li>
            </ul>
            <Link
              href={monthlyHref}
              prefetch={false}
              className="landing-btn-ghost mt-8 inline-flex items-center justify-center border border-white/20 px-6 py-3 font-syne text-sm font-bold uppercase tracking-[0.18em] text-white"
              {...(monthlyHref.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              Join monthly
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
