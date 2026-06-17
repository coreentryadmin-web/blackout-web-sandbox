import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        black: "#000000",
        void: {
          deep: "#0c0c0f",
          black: "#000000",
        },
        grey: {
          50: "#f5f5f5",
          100: "#e5e5e5",
          200: "#a3a3a3",
          300: "#737373",
          400: "#525252",
          500: "#404040",
          600: "#2a2a2a",
          700: "#1a1a1a",
          800: "#111111",
          900: "#0a0a0a",
        },
        purple: {
          DEFAULT: "#8b5cf6",
          light: "#a78bfa",
          dark: "#6d28d9",
          glow: "rgba(139, 92, 246, 0.35)",
        },
        bull: "#22c55e",
        bear: "#ef4444",
        surface: {
          1: "#0a0a0a",
          2: "#111111",
          3: "#1a1a1a",
          4: "#222222",
        },
        border: {
          DEFAULT: "#1a1a1a",
          subtle: "#111111",
          strong: "#2a2a2a",
        },
        text: {
          primary: "#f0f0f0",
          secondary: "#888888",
          muted: "#525252",
          dim: "#2a2a2a",
        },
        warning: "#f59e0b",
        elite: "#8b5cf6",
      },
      fontFamily: {
        display: ["var(--font-bebas)", "sans-serif"],
        anton: ["var(--font-anton)", "sans-serif"],
        syne: ["var(--font-syne)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
        sans: ["var(--font-inter)", "system-ui, sans-serif"],
      },
      backgroundImage: {
        "eclipse-glow":
          "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.18) 0%, transparent 55%)",
        "hero-mesh":
          "radial-gradient(ellipse 60% 50% at 50% -10%, rgba(139,92,246,0.22), transparent 50%), radial-gradient(ellipse 40% 30% at 10% 80%, rgba(34,197,94,0.08), transparent 50%), radial-gradient(ellipse 40% 30% at 90% 70%, rgba(239,68,68,0.08), transparent 50%)",
        "card-glow":
          "radial-gradient(ellipse at 50% -20%, rgba(139,92,246,0.12) 0%, transparent 55%)",
      },
      boxShadow: {
        eclipse: "0 0 120px 40px rgba(139,92,246,0.12), 0 0 300px 80px rgba(139,92,246,0.06)",
        glow: "0 0 24px rgba(139,92,246,0.35)",
        "glow-purple": "0 0 20px rgba(139,92,246,0.4)",
        "glow-bull": "0 0 16px rgba(34,197,94,0.35)",
        "glow-bear": "0 0 16px rgba(239,68,68,0.35)",
        "glow-green": "0 0 16px rgba(34,197,94,0.3)",
        "glow-red": "0 0 16px rgba(239,68,68,0.3)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        blink: "blink 1s step-end infinite",
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "glow-pulse": "glowPulse 4s ease-in-out infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        glowPulse: {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
