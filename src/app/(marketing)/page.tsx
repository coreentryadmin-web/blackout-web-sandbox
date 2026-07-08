export const dynamic = "force-static";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { StaticLandingHero } from "@/components/landing/StaticLandingHero";
import { StaticAudienceStrip } from "@/components/landing/StaticAudienceStrip";
import { StaticModuleShowcase } from "@/components/landing/StaticModuleShowcase";
import { StaticTerminalDemo } from "@/components/landing/StaticTerminalDemo";
import { StaticEdgeSection } from "@/components/landing/StaticEdgeSection";
import { StaticPricingCompare } from "@/components/landing/StaticPricingCompare";

const LANDING_REDIRECT_SCRIPT =
  "try{var h=location.hash.slice(1);if(h==='faq')location.replace('/faq');else if(h==='pricing')location.replace('/pricing');else if(document.documentElement.classList.contains('ios-app'))location.replace('/dashboard')}catch(e){}";

export default function LandingPage() {
  return (
    <MarketingPageShell>
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <StaticLandingHero />
      <StaticAudienceStrip />
      <StaticModuleShowcase />
      <StaticTerminalDemo />
      <StaticEdgeSection />
      <StaticPricingCompare />
    </MarketingPageShell>
  );
}
