export const dynamic = "force-static";

import { CustomCursor } from "@/components/CustomCursor";
import { HeroSection } from "@/components/landing/HeroSection";
import { MarqueeBlock } from "@/components/landing/MarqueeStrip";
import { FeaturesGrid } from "@/components/landing/FeaturesGrid";
import { EdgeSection } from "@/components/landing/EdgeSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { FaqSection } from "@/components/landing/FaqSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen void-bg text-white overflow-x-hidden">
      <CustomCursor />
      <main id="main">
        <HeroSection />
        <MarqueeBlock />
        <FeaturesGrid />
        <EdgeSection />
        <FaqSection />
        <PricingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
