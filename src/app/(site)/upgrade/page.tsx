export const dynamic = "force-static";

import type { Metadata } from "next";
import Link from "next/link";
import { PricingBackdrop } from "@/components/landing/PricingBackdrop";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";
import { PlanLadder } from "@/components/upgrade/PlanLadder";
import { FeatureComparison } from "@/components/upgrade/FeatureComparison";
import { AuthProofRail } from "@/components/auth/AuthProofRail";

export const metadata: Metadata = {
  title: "Upgrade · BlackOut",
  description: "Unlock the live BlackOut desk — HELIX flow, the SPX dashboard, Largo and Night Hawk.",
};

export default function UpgradePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040407]">
      <PricingBackdrop />
      <main id="main" className="relative z-10 mx-auto max-w-5xl px-6 pt-28 pb-24 text-center">
        <p className="mb-4 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.45em] uppercase text-bull">
          <span className="badge-live-dot" aria-hidden /> Clearance required
        </p>
        <h1 className="font-anton text-6xl leading-[0.95] tracking-[0.03em] text-white text-glow-green md:text-7xl">
          One pass. <span className="auth-grad">The whole floor.</span>
        </h1>
        <p className="hide-in-ios-app mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-sky-300 md:text-base">
          One pass arms every instrument on the floor — no tiers, nothing held back. Pick a plan below.
        </p>
        <p className="show-in-ios-app mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-sky-300 md:text-base">
          One pass arms every instrument on the floor — no tiers, nothing held back.
        </p>

        {/* proof tiles render only when verified stats exist; otherwise null */}
        <div className="mx-auto mt-10 max-w-3xl">
          <AuthProofRail variant="upgrade" />
        </div>

        {/* In-app (iOS): membership is managed on the web — no pricing / purchase shown. */}
        <div className="show-in-ios-app mx-auto mt-12 max-w-md rounded-xl border border-bull/15 bg-[#080a10]/50 px-6 py-7 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-bull">Membership</p>
          <p className="mt-3 text-sm leading-relaxed text-sky-200">
            Your BlackOut membership is managed from your account. Once active, sign in here to
            access the full desk.
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-block rounded-lg border border-bull/40 px-5 py-2 font-mono text-xs uppercase tracking-[0.2em] text-bull transition-colors hover:bg-bull/10"
          >
            Go to the desk →
          </Link>
        </div>

        <div className="hide-in-ios-app mt-12">
          <PlanLadder />
        </div>

        <div className="hide-in-ios-app mx-auto mt-10 flex max-w-md flex-col items-center justify-center gap-4 rounded-xl border border-bull/15 bg-[#080a10]/50 px-5 py-4 sm:flex-row">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-sky-300">Already paid on Whop?</span>
          <SyncMembershipButton />
        </div>

        <div className="hide-in-ios-app">
          <FeatureComparison />
        </div>

        <div className="mt-10 space-y-2">
          <Link href="/" className="font-mono text-xs text-sky-300 transition-colors hover:text-bull">
            ← Stand down
          </Link>
          <p className="hide-in-ios-app font-mono text-[10px] text-sky-400/70">
            Pay on Whop with the same email as your BlackOut account, then refresh your access above. Educational tools only — not financial advice.
          </p>
          <p className="show-in-ios-app font-mono text-[10px] text-sky-400/70">
            Educational tools only — not financial advice.
          </p>
        </div>
      </main>
    </div>
  );
}
