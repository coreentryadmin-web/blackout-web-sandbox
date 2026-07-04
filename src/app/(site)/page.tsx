export const dynamic = "force-static";

import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesGrid } from "@/components/landing/FeaturesGrid";
import { EdgeSection } from "@/components/landing/EdgeSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingHashRedirect } from "@/components/landing/LandingHashRedirect";

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen void-bg text-white overflow-x-hidden">
      <LandingHashRedirect />
      <main id="main">
        <HeroSection />
        <FeaturesGrid />
        <EdgeSection />
      </main>
      <LandingFooter />
    </div>
  );
}
