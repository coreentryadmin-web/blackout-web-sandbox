"use client";

import { UserProfile } from "@clerk/nextjs";
import { useAppAuth } from "@/lib/auth-client";
import { isClientCognitoAuth } from "@/lib/auth-provider";

const CLERK_APPEARANCE = {
  variables: {
    colorBackground: "#040407",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorPrimary: "#00e676",
    colorNeutral: "rgba(255,255,255,0.16)",
    borderRadius: "12px",
  },
  elements: {
    card: "!bg-[rgba(8,9,14,0.6)] border border-white/10 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.9)]",
    navbar: "!bg-transparent border-r border-white/8",
    navbarButton: "text-sky-300 hover:!text-white hover:!bg-white/5",
    navbarButtonActive: "!text-white !bg-white/8",
    pageScrollBox: "!bg-transparent",
    formFieldInput:
      "!bg-[rgba(255,255,255,0.04)] !border-white/10 !text-white placeholder:!text-sky-300/40 focus:!border-bull/60",
    formFieldLabel: "!text-sky-300 text-[11px] uppercase tracking-[0.14em]",
    formButtonPrimary: "!bg-bull !text-[#040407] font-bold hover:!bg-bull/80",
    badge: "!bg-white/8 !text-sky-300",
    profileSectionTitle: "!text-white",
    profileSectionContent: "!text-sky-200",
    dividerLine: "!bg-white/8",
    headerTitle: "!text-white",
    headerSubtitle: "!text-sky-300",
  },
};

export function AccountProfilePanel() {
  const { email, tier, signOut, isLoaded } = useAppAuth();

  if (isClientCognitoAuth()) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sky-300/60">Email</p>
          <p className="text-white mt-1">{isLoaded ? email ?? "—" : "Loading…"}</p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sky-300/60">Membership</p>
          <p className="text-white mt-1 capitalize">{tier ?? "free"}</p>
        </div>
        <p className="font-mono text-xs text-sky-300/70">
          Password and profile changes are managed in the Cognito sign-in portal.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="btn-outline-bull"
        >
          Sign out
        </button>
      </div>
    );
  }

  return <UserProfile appearance={CLERK_APPEARANCE} />;
}
