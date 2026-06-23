"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { PricingBackdrop } from "@/components/landing/PricingBackdrop";
import { AuthProofRail } from "@/components/auth/AuthProofRail";

const paneStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const riseItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * Cinematic split-screen shell wrapping the Clerk widget. Left = animated brand pitch;
 * right = the themed form in a pool of light. Stacks to a single column on mobile (the
 * pitch pane is dropped, a compact brand header replaces it). All motion is gated by the
 * root MotionConfig reducedMotion="user". The shell never double-wraps the Clerk card —
 * the card IS the glass surface (see clerkAppearance).
 */
export function AuthShell({ mode, children }: { mode: "signin" | "signup"; children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden bg-[#040407] lg:grid-cols-[1.05fr_0.95fr]">
      {/* ── LEFT — the pitch ── */}
      <motion.section
        variants={paneStagger}
        initial="hidden"
        animate="show"
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16"
      >
        <PricingBackdrop />
        <div aria-hidden className="auth-seam absolute right-0 top-0 bottom-0 w-px" />

        <motion.div variants={riseItem} className="relative z-10">
          <Link
            href="/"
            aria-label="Back to BlackOut home"
            className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.35em] uppercase text-sky-300 transition-colors hover:text-bull"
          >
            <span className="nav-dot" aria-hidden /> ← BLACKOUT.TERMINAL
          </Link>
        </motion.div>

        <div className="relative z-10 max-w-[30rem]">
          <motion.h1
            variants={riseItem}
            className="font-anton text-7xl leading-none tracking-[0.04em] text-white text-glow-green xl:text-8xl"
          >
            BLACKOUT
          </motion.h1>
          <motion.p variants={riseItem} className="mt-3 font-mono text-[11px] tracking-[0.45em] uppercase text-bull">
            Institutional 0DTE · Options Flow
          </motion.p>
          <motion.p variants={riseItem} className="mt-7 font-syne text-3xl font-extrabold leading-[1.05] text-white xl:text-4xl">
            {mode === "signin" ? (
              <>
                Welcome back to <span className="auth-grad">the desk.</span>
              </>
            ) : (
              <>
                Step onto <span className="auth-grad">the floor.</span>
              </>
            )}
          </motion.p>
          <motion.div variants={riseItem} className="mt-10">
            <AuthProofRail variant="auth" />
          </motion.div>
        </div>

        <motion.div variants={riseItem} className="relative z-10 flex flex-wrap items-center gap-3">
          <span className="badge-live">
            <span className="badge-live-dot" aria-hidden /> Market Open
          </span>
          <span className="font-mono text-[10px] text-sky-300/80">Encrypted by Clerk · Built for the desk</span>
        </motion.div>
      </motion.section>

      {/* ── RIGHT — the form ── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex items-center justify-center p-6 sm:p-10"
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 80% at 50% -10%, rgba(0,230,118,0.06), transparent 60%), #050608" }}
        />
        <div className="relative z-10 mx-auto w-full max-w-[420px]">
          {/* mobile brand header (the pitch pane is hidden below lg) */}
          <div className="mb-8 text-center lg:hidden">
            <Link
              href="/"
              aria-label="Back to BlackOut home"
              className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.35em] uppercase text-sky-300 hover:text-bull"
            >
              <span className="nav-dot" aria-hidden /> ← Home
            </Link>
            <h1 className="mt-4 font-anton text-5xl tracking-[0.04em] text-white text-glow-green">BLACKOUT</h1>
            <p className="mt-2 font-mono text-[10px] tracking-[0.4em] uppercase text-bull">Institutional 0DTE · Options Flow</p>
          </div>

          <div className="relative">
            <div aria-hidden className="absolute -inset-4 rounded-3xl bg-bull/10 opacity-60 blur-2xl" />
            <div className="auth-card-frame relative">{children}</div>
          </div>
        </div>
      </motion.section>
    </main>
  );
}
