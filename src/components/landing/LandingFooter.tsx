"use client";

import { MarqueeBlock } from "./MarqueeStrip";
import { SITE } from "@/lib/site";

export function LandingFooter() {
  return (
    <footer className="landing-section landing-section-cut relative border-t border-bull/20 overflow-hidden">
      <MarqueeBlock />
      <div className="px-8 py-10 flex flex-col md:flex-row items-center justify-between gap-6 bg-black">
        <span className="font-anton text-3xl tracking-[0.15em] text-gradient-fire">BLACKOUT</span>
        <p className="font-mono text-[10px] text-cyan-400 tracking-[0.15em] uppercase text-center">
          © 2026 {SITE.domain} — {SITE.tagline}
        </p>
        <a
          href={SITE.url}
          className="font-mono text-[9px] text-bull uppercase tracking-widest hover:text-bull/80 transition-colors"
        >
          {SITE.domain}
        </a>
        <p className="font-mono text-[9px] text-cyan-500 uppercase tracking-widest">
          Not financial advice
        </p>
      </div>
    </footer>
  );
}
