export const dynamic = "force-static";

import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { StaticFaqSection } from "@/components/landing/StaticFaqSection";

export const metadata: Metadata = {
  title: "FAQ · BlackOut",
  description:
    "Everything explained — platform, instruments, signals, membership, and getting started with BlackOut.",
};

export default function FaqPage() {
  return (
    <MarketingPageShell>
      <div className="pt-20">
        <StaticFaqSection />
      </div>
    </MarketingPageShell>
  );
}
