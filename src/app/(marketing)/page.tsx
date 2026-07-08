export const dynamic = "force-static";

import { StaticLandingHero } from "@/components/landing/StaticLandingHero";
import { StaticBieSection } from "@/components/landing/StaticBieSection";
import { StaticEdgeSection } from "@/components/landing/StaticEdgeSection";
import { StaticLandingFooter } from "@/components/landing/StaticLandingFooter";

/** Legacy hash anchors + iOS app desk skip — inline only (no Clerk / client bundle). */
const LANDING_REDIRECT_SCRIPT =
  "try{var h=location.hash.slice(1);if(h==='faq')location.replace('/faq');else if(h==='pricing')location.replace('/pricing');else if(document.documentElement.classList.contains('ios-app'))location.replace('/dashboard')}catch(e){}";

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen void-bg text-white">
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <main id="main">
        <StaticLandingHero />
        <StaticBieSection />
        <StaticEdgeSection />
      </main>
      <StaticLandingFooter />
    </div>
  );
}
