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
 * Cinematic split-screen shell wrapping the Clerk widget. A single animated backdrop
 * spans the WHOLE screen (behind both panes) so the form side is never dead black —
 * there is continuous motion on every viewport. Left = brand pitch; right = the themed
 * form floating in a darkened pool of light over the live backdrop. Below lg the pitch
 * pane drops and a compact brand header takes its place. All motion is gated by the root
 * MotionConfig reducedMotion="user".
 */
export function AuthShell({ mode, children }: { mode: "signin" | "signup"; children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden bg-[#040407] lg:grid-cols-[1.05fr_0.95fr]">
      {/* full-bleed animated backdrop (behind both panes) */}
      <PricingBackdrop />

      {/* ── LEFT — the pitch ── */}
      <motion.section
        variants={paneStagger}
        initial="hidden"
        animate="show"
        className="relative z-10 hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16"
      >
        <div aria-hidden className="auth-seam absolute right-0 top-0 bottom-0 w-px" />

        <motion.div variants={riseItem} className="relative z-10">
          <Link
            href="/"
            aria-label="Back to BlackOut home"
            className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.35em] uppercase text-sky-300 transition-colors hover:text-bull"
          >
            <span className="nav-dot" aria-hidden /> ← BlackOut
          </Link>
        </motion.div>

        <div className="relative z-10 max-w-[30rem]">
          <motion.h1
            variants={riseItem}
            className="font-anton text-7xl leading-none tracking-[0.04em] text-white xl:text-8xl"
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
                Create your account. <span className="auth-grad">Open the desk.</span>
              </>
            )}
          </motion.p>
          <motion.div variants={riseItem} className="mt-10">
            <AuthProofRail variant="auth" />
          </motion.div>
        </div>

        <motion.div variants={riseItem} className="relative z-10 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] text-secondary">End-to-end encrypted · Brokerless by design</span>
        </motion.div>
      </motion.section>

      {/* ── RIGHT — the form ── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="auth-mobile-pane relative z-10 flex items-center justify-center p-6 sm:p-10"
      >
        {/* legibility scrim — darkens behind the form, edges keep the backdrop motion */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 100% 90% at 50% 50%, rgba(4,4,7,0.86), rgba(4,4,7,0.5) 70%, transparent), linear-gradient(to right, rgba(4,4,7,0.6), transparent)",
          }}
        />
        <div className="relative z-10 mx-auto w-full max-w-[420px]">
          {/* mobile brand header (the pitch pane is hidden below lg) */}
          <div className="mb-8 text-center lg:hidden">
            <Link
              href="/"
              aria-label="Back to BlackOut home"
              className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.35em] uppercase text-sky-300 hover:text-bull"
            >
              <span className="nav-dot" aria-hidden /> ← Back home
            </Link>
            <h1 className="mt-4 font-anton text-5xl tracking-[0.04em] text-white">BLACKOUT</h1>
            <p className="mt-2 font-mono text-[10px] tracking-[0.4em] uppercase text-bull">Institutional 0DTE · Options Flow</p>
          </div>

          <div className="relative">
            <div aria-hidden className="absolute -inset-4 rounded-3xl bg-bull/10 opacity-60 blur-2xl" />
            <p className="show-in-ios-app relative z-10 mb-4 text-center font-mono text-[11px] leading-relaxed text-sky-300">
              Use email sign-in in the app. Google OAuth is not supported inside the iOS shell — use your email and the one-time code.
            </p>
            <div className="auth-card-frame relative">{children}</div>
          </div>
        </div>
      </motion.section>
    </main>
  );
}
