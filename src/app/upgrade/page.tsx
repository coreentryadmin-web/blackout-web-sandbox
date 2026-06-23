import Link from "next/link";
import { Nav } from "@/components/Nav";
import { PricingBackdrop } from "@/components/landing/PricingBackdrop";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";
import { PlanLadder } from "@/components/upgrade/PlanLadder";
import { FeatureComparison } from "@/components/upgrade/FeatureComparison";
import { AuthProofRail } from "@/components/auth/AuthProofRail";

export default function UpgradePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040407]">
      <Nav />
      <PricingBackdrop />
      <main className="relative z-10 mx-auto max-w-5xl px-6 pt-28 pb-24 text-center">
        <p className="mb-4 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.45em] uppercase text-bull">
          <span className="badge-live-dot" aria-hidden /> Membership required
        </p>
        <h1 className="font-anton text-6xl leading-[0.95] tracking-[0.03em] text-white text-glow-green md:text-7xl">
          One pass. <span className="auth-grad">The whole floor.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-sky-300 md:text-base">
          One membership unlocks the live desk — HELIX flow, the SPX dashboard, Largo, Night Hawk and
          more. Pick the plan that fits, pay on Whop with the same email as your BlackOut account, then
          refresh your access below.
        </p>

        {/* proof tiles render only when verified stats exist; otherwise null */}
        <div className="mx-auto mt-10 max-w-3xl">
          <AuthProofRail variant="upgrade" />
        </div>

        <div className="mt-12">
          <PlanLadder />
        </div>

        <div className="mx-auto mt-10 flex max-w-md flex-col items-center justify-center gap-4 rounded-xl border border-bull/15 bg-[#080a10]/50 px-5 py-4 sm:flex-row">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-sky-300">Already paid on Whop?</span>
          <SyncMembershipButton />
        </div>

        <FeatureComparison />

        <div className="mt-10 space-y-2">
          <Link href="/" className="font-mono text-xs text-sky-300 transition-colors hover:text-bull">
            ← Back to home
          </Link>
          <p className="font-mono text-[10px] text-sky-400/70">
            Sign up on BlackOut, then unlock on Whop with the same email — instant access.
          </p>
        </div>
      </main>
    </div>
  );
}
