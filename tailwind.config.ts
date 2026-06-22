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
          DEFAULT: "#040407",
          deep: "#08080e",
          surface: "#0f0f1a",
          card: "#161628",
        },
        grey: {
          50: "#f5f5f7",
          100: "#e0e0e8",
          200: "#a8a8b8",
          300: "#707080",
          400: "#4a4a5a",
          500: "#32323f",
          600: "#22222c",
          700: "#16161e",
          800: "#0f0f16",
          900: "#08080e",
        },
        purple: {
          DEFAULT: "#bf5fff",
          light: "#d580ff",
          dark: "#9333ea",
          dim: "#7c3aed",
          glow: "rgba(191,95,255,0.35)",
        },
        bull: "#00e676",
        bear: "#ff2d55",
        cyan: {
          DEFAULT: "#00d4ff",
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
        },
        sky: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
        gold: "#ffd23f",
        ember: "#ff6b2b",
        surface: {
          1: "#08080e",
          2: "#0f0f1a",
          3: "#161628",
          4: "#1e1e32",
        },
        border: {
          DEFAULT: "#1e1e2e",
          subtle: "rgba(255,255,255,0.06)",
          mid: "rgba(255,255,255,0.12)",
          strong: "rgba(255,255,255,0.20)",
        },
        text: {
          primary: "#f0f0f8",
          secondary: "#8888a0",
          muted: "#4a4a60",
          dim: "#22222c",
        },
        warning: "#ffd23f",
        elite: "#bf5fff",
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
          "radial-gradient(ellipse at 50% 0%, rgba(0,230,118,0.15) 0%, rgba(191,95,255,0.08) 40%, transparent 65%)",
        "hero-mesh":
          "radial-gradient(ellipse 70% 50% at 50% -10%, rgba(0,230,118,0.14), transparent 55%), radial-gradient(ellipse 40% 30% at 5% 70%, rgba(191,95,255,0.10), transparent 50%), radial-gradient(ellipse 40% 30% at 95% 60%, rgba(255,45,85,0.08), transparent 50%)",
        "card-glow":
          "radial-gradient(ellipse at 50% -20%, rgba(0,230,118,0.10) 0%, transparent 60%)",
        aurora:
          "linear-gradient(135deg, rgba(191,95,255,0.15), rgba(0,212,255,0.10))",
      },
      boxShadow: {
        eclipse:
          "0 0 120px 40px rgba(0,230,118,0.10), 0 0 300px 80px rgba(191,95,255,0.08)",
        glow:
          "0 0 8px rgba(0,230,118,0.6), 0 0 30px rgba(0,230,118,0.3), 0 0 80px rgba(0,230,118,0.12)",
        "glow-bull":
          "0 0 8px rgba(0,230,118,0.6), 0 0 30px rgba(0,230,118,0.3)",
        "glow-bear":
          "0 0 8px rgba(255,45,85,0.6),  0 0 30px rgba(255,45,85,0.3)",
        "glow-purple":
          "0 0 8px rgba(191,95,255,0.6), 0 0 30px rgba(191,95,255,0.3)",
        "glow-cyan":
          "0 0 8px rgba(0,212,255,0.6),  0 0 30px rgba(0,212,255,0.3)",
        "glow-gold":
          "0 0 8px rgba(255,210,63,0.6), 0 0 30px rgba(255,210,63,0.3)",
        "glow-ember":
          "0 0 8px rgba(255,107,43,0.6), 0 0 30px rgba(255,107,43,0.3)",
        "glow-green":
          "0 0 8px rgba(0,230,118,0.5),  0 0 24px rgba(0,230,118,0.25)",
        "glow-red":
          "0 0 8px rgba(255,45,85,0.5),  0 0 24px rgba(255,45,85,0.25)",
        "card-hover":
          "0 0 0 1px rgba(0,230,118,0.2), 0 8px 32px rgba(0,0,0,0.6)",
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
