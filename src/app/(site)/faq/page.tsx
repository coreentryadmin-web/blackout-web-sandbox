export const dynamic = "force-static";

import type { Metadata } from "next";
import { FaqSection } from "@/components/landing/FaqSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "FAQ · BlackOut",
  description:
    "Everything explained — platform, instruments, signals, membership, and getting started with BlackOut.",
};

export default function FaqPage() {
  return (
    <div className="landing-page min-h-screen void-bg text-white overflow-x-hidden">
      <main id="main">
        <FaqSection />
      </main>
      <LandingFooter />
    </div>
  );
}
