export const dynamic = "force-static";

import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, PageHeader, Button } from "@/components/ui";
import { PricingBackdrop } from "@/components/landing/PricingBackdrop";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";
import { PlanLadder } from "@/components/upgrade/PlanLadder";
import { FeatureComparison } from "@/components/upgrade/FeatureComparison";
import { AuthProofRail } from "@/components/auth/AuthProofRail";

export const metadata: Metadata = {
  title: "Upgrade · BlackOut",
  description: "Unlock the live BlackOut desk — HELIX flow, SPX Slayer, Largo, and Night Hawk.",
};

export default function UpgradePage() {
  return (
    <PageShell backdropSlot={<PricingBackdrop />}>
      <div className="content-rail mx-auto max-w-4xl py-8 pb-20 text-center md:py-12">
        <PageHeader
          kicker="Premium access"
          title="Unlock the desk"
          titleAccent="full floor"
          subtitle="One membership opens every instrument — live flow, SPX structure, AI analyst, and overnight playbook."
          className="mb-10 justify-center text-center [&_h1]:mx-auto [&_p]:mx-auto"
        />

        <div className="mx-auto max-w-3xl">
          <AuthProofRail variant="upgrade" />
        </div>

        <div className="show-in-ios-app mx-auto mt-12 max-w-md rounded-2xl border border-white/10 bg-[rgba(8,9,14,0.55)] px-6 py-7 text-center backdrop-blur-md">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-bull">Membership</p>
          <p className="mt-3 text-sm leading-relaxed text-secondary">
            Your membership is managed on the web. Once active, sign in here to access the full
            desk.
          </p>
          <Button href="/dashboard" variant="outline" size="sm" className="mt-5">
            Open SPX desk
          </Button>
        </div>

        <div className="hide-in-ios-app mt-12">
          <PlanLadder />
        </div>

        <div className="hide-in-ios-app mx-auto mt-10 flex max-w-md flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-[rgba(8,9,14,0.45)] px-5 py-4 backdrop-blur-md sm:flex-row">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-mute">
            Already paid on Whop?
          </span>
          <SyncMembershipButton />
        </div>

        <div className="hide-in-ios-app">
          <FeatureComparison />
        </div>

        <div className="mt-10 space-y-2">
          <Link
            href="/"
            className="font-mono text-xs text-secondary transition-colors duration-base hover:text-white"
          >
            ← Back to home
          </Link>
          <p className="hide-in-ios-app font-mono text-[10px] text-mute">
            Pay on Whop with the same email as your BlackOut account, then sync access above.
            Educational tools only — not financial advice.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
