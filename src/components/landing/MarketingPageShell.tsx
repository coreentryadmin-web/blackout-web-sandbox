import type { ReactNode } from "react";
import { StaticLandingBackdrop } from "./StaticLandingBackdrop";
import { StaticMarketingNav } from "./StaticMarketingNav";
import { StaticLandingFooter } from "./StaticLandingFooter";

type Props = {
  children: ReactNode;
  showChart?: boolean;
  footer?: boolean;
};

/** Shared marketing chrome — lean CSS, no Clerk, no desk Nav. */
export function MarketingPageShell({ children, showChart = true, footer = true }: Props) {
  return (
    <div className="landing-page mkt-page min-h-screen void-bg text-white">
      <StaticLandingBackdrop showChart={showChart} />
      <StaticMarketingNav />
      <main id="main" className="relative z-10">
        {children}
      </main>
      {footer ? <StaticLandingFooter /> : null}
    </div>
  );
}
