export const dynamic = "force-static";

import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { StaticPricingSection } from "@/components/landing/StaticPricingSection";

export const metadata: Metadata = {
  title: "Pricing · BlackOut",
  description: "Premium membership — full desk access: HELIX flow, SPX Slayer, Largo, Night Hawk, and more.",
};

export default function PricingPage() {
  return (
    <MarketingPageShell showChart={false}>
      <div className="hide-in-ios-app pt-24">
        <StaticPricingSection />
      </div>
      <div className="show-in-ios-app px-6 py-32 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-bull">Membership</p>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-sky-300">
          Your membership is managed on the web. Once active, sign in here to access the full desk.
        </p>
      </div>
    </MarketingPageShell>
  );
}
