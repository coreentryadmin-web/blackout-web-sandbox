"use client";

import { clsx } from "clsx";
import { FaqSection } from "@/components/landing/FaqSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** /faq — landing bento on web; compact native accordion in the iOS shell. */
export function FaqPageShell() {
  const native = useIosNativeShell();

  return (
    <div
      className={clsx(
        "landing-page min-h-screen void-bg text-white overflow-x-hidden",
        native && "faq-page-native ios-native-page-faq"
      )}
    >
      <main id="main">
        <FaqSection />
      </main>
      {!native && <LandingFooter />}
    </div>
  );
}
