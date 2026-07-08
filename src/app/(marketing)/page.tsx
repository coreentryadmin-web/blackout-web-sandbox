export const dynamic = "force-static";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { StaticLandingHero } from "@/components/landing/StaticLandingHero";
import { StaticBieSection } from "@/components/landing/StaticBieSection";
import { StaticEdgeSection } from "@/components/landing/StaticEdgeSection";

const LANDING_REDIRECT_SCRIPT =
  "try{var h=location.hash.slice(1);if(h==='faq')location.replace('/faq');else if(h==='pricing')location.replace('/pricing');else if(document.documentElement.classList.contains('ios-app'))location.replace('/dashboard')}catch(e){}";

export default function LandingPage() {
  return (
    <MarketingPageShell>
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <StaticLandingHero />
      <StaticBieSection />
      <StaticEdgeSection />
    </MarketingPageShell>
  );
}
