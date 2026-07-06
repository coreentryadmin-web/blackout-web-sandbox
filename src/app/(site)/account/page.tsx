import type { Metadata } from "next";
import { UserProfile } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Account · BlackOut",
  description: "Manage your BlackOut Trades account settings, security, and connected devices.",
  robots: { index: false },
};

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
    formButtonPrimary:
      "!bg-bull !text-[#040407] font-bold hover:!bg-bull/80",
    badge: "!bg-white/8 !text-sky-300",
    profileSectionTitle: "!text-white",
    profileSectionContent: "!text-sky-200",
    dividerLine: "!bg-white/8",
    headerTitle: "!text-white",
    headerSubtitle: "!text-sky-300",
  },
};

export default function AccountPage() {
  return (
    <main className="ios-account-page ios-native-page ios-native-page-account min-h-screen px-4 flex flex-col items-center">
      <div className="w-full max-w-4xl">
        <div className="account-page-title-block mb-6">
          <h1 className="font-syne text-2xl font-bold text-white">Account Settings</h1>
          <p className="font-mono text-[12px] text-sky-300/60 mt-1 uppercase tracking-[0.14em]">
            Profile · Security · Connected devices
          </p>
        </div>
        <UserProfile appearance={CLERK_APPEARANCE} />
      </div>
    </main>
  );
}
