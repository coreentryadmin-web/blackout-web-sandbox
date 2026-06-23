import type { Appearance } from "@clerk/types";

// BlackOut emerald theme for the Clerk SignIn/SignUp widgets. Built for READABILITY:
// a clear hierarchy of white (primary: title, labels, input text) / sky (one accent line) /
// emerald (actions, links) / dim (placeholders, hints) — not a monotone wall of one color.
// All class strings are STATIC LITERALS so Tailwind JIT emits them. No grey, no purple.
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#00e676",
    colorBackground: "#080a10",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorInputBackground: "rgba(4,4,7,0.7)",
    colorInputText: "#f4f6fb",
    colorDanger: "#ff2d55",
    colorSuccess: "#00e676",
    colorNeutral: "rgba(255,255,255,0.16)",
    borderRadius: "14px",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-syne), sans-serif",
    fontSize: "1rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full",
    // more opaque so the form is razor-crisp over the animated backdrop behind it
    card: "bg-[#080a10]/92 backdrop-blur-2xl border border-bull/15 rounded-2xl px-8 py-9 shadow-[0_0_0_1px_rgba(0,230,118,0.12),0_24px_80px_-24px_rgba(0,0,0,0.85),0_0_60px_-20px_rgba(0,230,118,0.3)]",
    headerTitle: "font-anton tracking-[0.04em] text-white text-3xl uppercase",
    headerSubtitle: "font-mono text-[10px] tracking-[0.3em] text-sky-300 uppercase",
    // labels read as PRIMARY structure (near-white), distinct from the sky subtitle
    formFieldLabel: "font-mono text-[11px] tracking-[0.14em] uppercase text-white/85",
    // "Optional" + hints clearly tertiary
    formFieldHintText: "font-mono text-[10px] text-white/40 normal-case tracking-normal",
    formFieldInput:
      "bg-[#040407]/70 border border-white/12 rounded-xl py-2.5 text-white placeholder:text-white/30 focus:border-bull/60 focus:ring-2 focus:ring-bull/30 transition-colors",
    formFieldInputShowPasswordButton: "text-sky-300 hover:text-bull",
    formFieldSuccessText: "text-bull",
    formFieldErrorText: "text-bear font-mono text-xs",
    formFieldAction: "text-sky-300 hover:text-bull",
    identityPreviewText: "text-white",
    identityPreviewEditButton: "text-sky-300 hover:text-bull",
    formButtonPrimary:
      "bg-bull text-[#021108] font-syne tracking-[0.18em] uppercase text-xs font-extrabold rounded-xl py-3.5 transition-all duration-200 hover:brightness-110 hover:shadow-glow-bull active:scale-[0.98] shadow-[0_8px_24px_-8px_rgba(0,230,118,0.6)]",
    socialButtonsBlockButton:
      "bg-white/[0.04] border border-white/12 rounded-xl text-white hover:border-bull/40 hover:bg-bull/[0.06] transition-colors py-2.5",
    socialButtonsBlockButtonText: "font-syne text-white font-semibold",
    dividerLine: "bg-white/10",
    dividerText: "font-mono text-[10px] tracking-[0.3em] text-white/40 uppercase",
    formResendCodeLink: "text-bull hover:brightness-125",
    otpCodeFieldInput: "border border-white/12 rounded-lg text-white focus:border-bull/60 focus:ring-2 focus:ring-bull/30",
    footer: "bg-transparent",
    footerPages: "text-sky-400",
    footerActionText: "text-white/65",
    footerActionLink: "text-bull font-semibold hover:text-bull hover:brightness-125 underline-offset-4 hover:underline transition",
    badge: "bg-bull/12 text-bull border border-bull/30 rounded-full",
    spinner: "text-bull",
    alert: "rounded-xl border border-bear/30 bg-bear/10 text-white",
    logoBox: "hidden",
  },
};
