export const dynamic = "force-static";

import type { Metadata } from "next";
import { PricingSection } from "@/components/landing/PricingSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Pricing · BlackOut",
  description: "Premium membership — full desk access: HELIX flow, SPX Slayer, Largo, Night Hawk, and more.",
};

export default function PricingPage() {
  return (
    <div className="landing-page min-h-screen void-bg text-white overflow-x-hidden">
      <main id="main">
        {/* Hidden inside the iOS app (App Store guideline 3.1.1 — no in-app pricing). */}
        <div className="hide-in-ios-app">
          <PricingSection />
        </div>
        <div className="show-in-ios-app px-6 py-24 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-bull">Membership</p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-secondary">
            Your membership is managed on the web. Once active, sign in here to access the full desk.
          </p>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
