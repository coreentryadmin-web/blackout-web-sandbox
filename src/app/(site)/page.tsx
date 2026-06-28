export const dynamic = "force-static";

import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesGrid } from "@/components/landing/FeaturesGrid";
import { EdgeSection } from "@/components/landing/EdgeSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { FaqSection } from "@/components/landing/FaqSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen void-bg text-white overflow-x-hidden">
      <main id="main">
        <HeroSection />
        <FeaturesGrid />
        <EdgeSection />
        <FaqSection />
        {/* Pricing hidden inside the iOS app (App Store guideline 3.1.1 — no in-app
            pricing / external-purchase links). Visible normally on the web. */}
        <div className="hide-in-ios-app">
          <PricingSection />
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
