import { Nav } from "@/components/Nav";
import { HeroSection } from "@/components/landing/HeroSection";
import { MarqueeBlock } from "@/components/landing/MarqueeStrip";
import { FeaturesGrid } from "@/components/landing/FeaturesGrid";
import { OverlapShowcase } from "@/components/landing/OverlapShowcase";
import { PricingSection } from "@/components/landing/PricingSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { IMAGES } from "@/lib/images";

export default function LandingPage() {
  return (
    <div className="min-h-screen void-bg text-white overflow-x-hidden">
      <Nav />
      <HeroSection />
      <MarqueeBlock />
      <FeaturesGrid />
      <OverlapShowcase
        image={IMAGES.spxSniper}
        alt="SPX Sniper Bot"
        label="0DTE Precision"
        title="SPX SNIPER BOT"
        tagline="Precision. Patience. Profit."
        description="Real-time GEX levels, VWAP, regime detection, dealer positioning, and live 0DTE play alerts — built for traders who wait for the perfect shot."
        cta="Open Dashboard"
        href="/dashboard"
        accent="green"
      />
      <OverlapShowcase
        image={IMAGES.largo}
        alt="BlackOut Largo AI Terminal"
        label="AI Terminal"
        title="BLACKOUT LARGO"
        tagline="Execute. Dominate. Repeat."
        description="Largo synthesizes live flows, GEX, VWAP, news, analyst ratings, and options data — then answers like a desk trader, not a chatbot."
        cta="Try the Terminal"
        href="/terminal"
        reverse
        accent="purple"
      />
      <PricingSection />
      <LandingFooter />
    </div>
  );
}
