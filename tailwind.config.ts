import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
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
        purple: {
          DEFAULT: "#bf5fff",
          light: "#d580ff",
          dark: "#9333ea",
          dim: "#7c3aed",
          glow: "rgba(191,95,255,0.35)",
        },
        // Canonical semantic tokens.
        bull: "#00e676",
        bear: "#ff2d55",
        // AA-safe bear for SMALL/inline bearish numbers (#ff2d55 is ~4.0:1 on
        // the void bg — sub-AA). Use text-bear-text for header % change,
        // structure values, GEX dist/net, level distances and P&L; reserve
        // bear (#ff2d55) for LARGE display text, glows and borders.
        "bear-text": "#ff5c78",
        // Non-grey neutral for secondary copy (authors must NOT reach for zinc/neutral).
        // Matches the existing secondary-text value on the marketing/auth surface.
        mute: "#9fb4d4",
        // Readable secondary text — brighter than mute, clears WCAG AA on the void
        // bg (~9:1). Use `text-secondary` for muted-but-readable body / sublabels /
        // microcopy instead of dim white/45–55. Backed by the --text-secondary var.
        secondary: "var(--text-secondary)",
        cyan: {
          DEFAULT: "#22d3ee",
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
          // Defused: these were banned-grey "loaded guns" (#8888a0 / #4a4a60) per the
          // UI audit — unused, but repointed off grey so they can't introduce it.
          // Use `text-secondary` (readable) or `text-mute` (quiet, non-grey) instead.
          secondary: "var(--text-secondary)",
          muted: "#9fb4d4",
          dim: "#22222c",
        },
        warning: "#ffd23f",
        elite: "#bf5fff",
      },
      // VITALS motion system — "The One Clock". Maps the canonical CSS motion
      // tokens (defined in globals.css :root) onto Tailwind utilities so authors
      // can write e.g. ease-snap / duration-base. Additive; no defaults changed.
      transitionTimingFunction: {
        snap: "var(--ease-snap)",
        draw: "var(--ease-draw)",
        breath: "var(--ease-breath)",
        sweep: "var(--ease-sweep)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
      },
      fontFamily: {
        display: ["var(--font-anton)", "sans-serif"],
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
