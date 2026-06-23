import type { Appearance } from "@clerk/types";

// BlackOut emerald theme for the Clerk SignIn/SignUp widgets. All class strings are
// STATIC LITERALS (no concatenation) so Tailwind JIT emits them. No grey, no purple,
// rounded corners, brand fonts, glass card. Element keys verified against @clerk/types.
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#00e676",
    colorBackground: "#080a10",
    colorText: "#f0f0f8",
    colorTextSecondary: "#7dd3fc",
    colorInputBackground: "rgba(4,4,7,0.6)",
    colorInputText: "#f0f0f8",
    colorDanger: "#ff2d55",
    colorSuccess: "#00e676",
    colorNeutral: "rgba(255,255,255,0.14)",
    borderRadius: "14px",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-syne), sans-serif",
    fontSize: "0.95rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full",
    card: "bg-[#080a10]/70 backdrop-blur-xl border border-bull/15 rounded-2xl px-8 py-9 shadow-[0_0_0_1px_rgba(0,230,118,0.12),0_24px_80px_-24px_rgba(0,0,0,0.85),0_0_60px_-20px_rgba(0,230,118,0.3)]",
    headerTitle: "font-anton tracking-[0.04em] text-white text-3xl uppercase",
    headerSubtitle: "font-mono text-[10px] tracking-[0.35em] text-sky-300 uppercase",
    formButtonPrimary:
      "bg-bull text-[#021108] font-syne tracking-[0.18em] uppercase text-xs font-extrabold rounded-xl py-3 transition-all duration-200 hover:brightness-110 hover:shadow-glow-bull active:scale-[0.98] shadow-[0_8px_24px_-8px_rgba(0,230,118,0.6)]",
    formFieldInput:
      "bg-[#040407]/60 border border-white/10 rounded-xl text-white placeholder:text-sky-400/50 focus:border-bull/60 focus:ring-2 focus:ring-bull/30 transition-colors",
    formFieldLabel: "font-mono text-[10px] tracking-[0.2em] uppercase text-sky-300",
    formFieldInputShowPasswordButton: "text-sky-300 hover:text-bull",
    formFieldSuccessText: "text-bull",
    formFieldErrorText: "text-bear font-mono text-xs",
    formFieldAction: "text-sky-300 hover:text-bull",
    identityPreviewText: "text-white",
    identityPreviewEditButton: "text-sky-300 hover:text-bull",
    socialButtonsBlockButton:
      "bg-white/[0.03] border border-white/10 rounded-xl text-white hover:border-bull/40 hover:bg-bull/[0.06] transition-colors",
    socialButtonsBlockButtonText: "font-syne text-sky-100",
    dividerLine: "bg-white/10",
    dividerText: "font-mono text-[10px] tracking-[0.3em] text-sky-400 uppercase",
    formResendCodeLink: "text-bull hover:brightness-125",
    otpCodeFieldInput:
      "border border-white/10 rounded-lg text-white focus:border-bull/60 focus:ring-2 focus:ring-bull/30",
    footer: "bg-transparent",
    footerPages: "text-sky-400",
    footerActionText: "text-sky-300",
    footerActionLink:
      "text-bull hover:text-bull hover:brightness-125 underline-offset-4 hover:underline transition",
    badge: "bg-bull/12 text-bull border border-bull/30 rounded-full",
    spinner: "text-bull",
    alert: "rounded-xl border border-bear/30 bg-bear/10 text-white",
    logoBox: "hidden",
  },
};
