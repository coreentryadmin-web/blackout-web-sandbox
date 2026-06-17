import type { Appearance } from "@clerk/types";

export const clerkAppearance: Appearance = {
  variables: {
    colorBackground: "#0a0a0a",
    colorText: "#f0f0f0",
    colorInputBackground: "#111111",
    colorInputText: "#f0f0f0",
    colorPrimary: "#8b5cf6",
    colorTextSecondary: "#888888",
    colorDanger: "#ef4444",
    borderRadius: "0px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  elements: {
    card: "border border-grey-700 shadow-glow-purple bg-grey-900",
    headerTitle: "font-display tracking-[0.2em] text-white uppercase",
    headerSubtitle: "text-purple-light tracking-widest uppercase text-[10px]",
    formButtonPrimary:
      "bg-purple text-white hover:bg-purple-light shadow-glow-purple uppercase tracking-[0.2em] text-xs font-bold rounded-none transition-all",
    formFieldInput: "border-grey-700 rounded-none bg-grey-800 focus:ring-1 focus:ring-purple/50",
    footerActionLink: "text-purple-light hover:text-purple transition-colors",
    socialButtonsBlockButton:
      "border border-grey-700 bg-grey-800 hover:bg-grey-700 rounded-none transition-colors",
    dividerLine: "bg-grey-700",
    dividerText: "text-grey-400 uppercase text-[10px] tracking-widest",
  },
};
