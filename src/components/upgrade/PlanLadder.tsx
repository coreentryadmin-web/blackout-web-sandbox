import {
  WHOP_CHECKOUT,
  WHOP_PREMIUM_CHECKOUT_OPTIONS,
  WHOP_CHECKOUT_UNAVAILABLE_MESSAGE,
} from "@/lib/whop-checkout";
import { valuePropFor } from "@/lib/upsell-features";

// Presentational only. Renders the EXISTING Whop checkout options as a value-framed
// ladder. Hrefs/labels/value-props are unchanged (already wired to Whop). No billing
// logic, no new tiers. Prices are parsed from the option label — never hardcoded.
export function PlanLadder() {
  if (WHOP_PREMIUM_CHECKOUT_OPTIONS.length === 0) {
    return WHOP_CHECKOUT.store ? (
      <a href={WHOP_CHECKOUT.store} target="_blank" rel="noopener noreferrer" className="btn-primary">
        View plans →
      </a>
    ) : (
      <p className="text-bear text-sm">{WHOP_CHECKOUT_UNAVAILABLE_MESSAGE}</p>
    );
  }

  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-3">
      {WHOP_PREMIUM_CHECKOUT_OPTIONS.map((option) => {
        const vp = valuePropFor(option.label);
        const [term, price] = option.label.split("—").map((s) => s.trim());
        return (
          <div
            key={option.label}
            className={
              "relative flex flex-col rounded-2xl border bg-[#080a10]/60 p-6 text-left backdrop-blur-md transition-all duration-300 hover:-translate-y-1 " +
              (vp.featured
                ? "upgrade-card-sheen border-bull/60 shadow-glow-bull md:scale-[1.02]"
                : "border-white/10 hover:border-bull/40")
            }
          >
            {vp.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-bull px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-black">
                {vp.badge}
              </span>
            )}
            <p className="font-syne text-[11px] font-bold uppercase tracking-[0.22em] text-bull">{term}</p>
            <p className="mt-1 font-anton text-4xl leading-none text-white">{price}</p>
            {vp.subline && <p className="mt-2 text-xs text-sky-300">{vp.subline}</p>}
            {vp.savings && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-bull">{vp.savings}</p>
            )}
            <a
              href={option.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Unlock Premium — ${option.label}`}
              className={
                "mt-6 inline-flex w-full items-center justify-center rounded-xl py-3 font-syne text-xs font-extrabold uppercase tracking-[0.2em] transition-all duration-200 " +
                (vp.featured
                  ? "bg-bull text-[#021108] hover:scale-105 hover:shadow-glow-bull"
                  : "border-2 border-white/15 text-sky-100 hover:border-bull hover:bg-bull/5 hover:text-bull")
              }
            >
              Unlock Premium →
            </a>
          </div>
        );
      })}
    </div>
  );
}
