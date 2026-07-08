"use client";

import Link from "next/link";
import { useAppAuth } from "@/lib/auth-client";
import { isClientCognitoAuth } from "@/lib/auth-provider";

export function AuthUserMenu() {
  const { isSignedIn, isLoaded, email, signOut } = useAppAuth();

  if (!isLoaded) {
    return <span className="inline-block h-9 w-9 rounded-full bg-white/5" aria-hidden />;
  }

  if (!isSignedIn) {
    return (
      <Link href="/sign-in" className="nav-cta">
        Sign in
      </Link>
    );
  }

  if (isClientCognitoAuth()) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/account" className="text-sm text-sky-200 hover:text-white truncate max-w-[140px]">
          {email ?? "Account"}
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="text-xs text-sky-300/80 hover:text-white px-2 py-1 rounded-md border border-white/10"
        >
          Sign out
        </button>
      </div>
    );
  }

  const { UserButton } = require("@clerk/nextjs") as typeof import("@clerk/nextjs");
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
      avatarBox: "w-9 h-9 ring-1 ring-bull/40",
      userButtonPopoverCard:
        "!bg-[#040407] border border-white/10 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.9)]",
      userButtonPopoverActionButton: "text-sky-200 hover:text-white hover:!bg-white/5",
      userButtonPopoverActionButtonText: "text-sky-200",
      userButtonPopoverFooter: "!bg-[#040407] border-t border-white/8",
    },
  } as const;

  return <UserButton appearance={CLERK_APPEARANCE} userProfileUrl="/account" />;
}
