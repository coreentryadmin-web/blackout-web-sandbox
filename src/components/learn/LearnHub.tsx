"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen, Compass } from "lucide-react";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { CURRICULUM } from "@/lib/learn/curriculum";
import { LEARN_NAV, learnHref } from "@/lib/learn/nav";
import { LearnHeroGlow, LearnStagger, LearnStaggerItem } from "@/components/learn/LearnMotion";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

export function LearnHub() {
  const reduced = useReducedMotion();
  const native = useIosNativeShell();
  const start = LEARN_NAV[0]!;
  const chapters = LEARN_NAV.slice(1);

  return (
    <div className={clsx("relative", native && "learn-hub-native")}>
      {!native && <LearnHeroGlow />}

      <motion.header
        className={clsx("learn-hub-hero", native ? "learn-hub-hero-native mb-6" : "mb-12")}
        initial={reduced || native ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        {!native && (
          <p className="learn-hub-kicker">
            <BookOpen className="size-3.5" aria-hidden />
            BlackOut Academy
          </p>
        )}
        {!native && <h1 className="learn-hub-title">Learn the platform</h1>}
        <p className={clsx(native ? "text-sm leading-relaxed text-sky-300" : "learn-hub-subtitle")}>
          {native
            ? "Structured chapters from first login to advanced workflows — cross-linked to live desks."
            : "A structured textbook from first login to advanced workflows. Each chapter connects tools, navigation, and dealer intelligence — with cross-links to live desks and related guides."}
        </p>
        <div className={clsx(native ? "mt-3 flex flex-wrap gap-x-2 font-mono text-[10px] text-cyan-400" : "learn-hub-meta")}>
          <span>{CURRICULUM.length} chapters</span>
          <span aria-hidden>·</span>
          <span>Educational only</span>
        </div>
      </motion.header>

      <Link href={learnHref(start.slug)} className={clsx("group block", native ? "mb-6" : "mb-10")}>
        <motion.div
          className={clsx("learn-hub-featured", native && "learn-hub-featured-native")}
          whileHover={reduced ? undefined : { y: -2 }}
          transition={{ duration: 0.25 }}
        >
          <div className="learn-hub-featured-glow" aria-hidden />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10">
              <Compass className="size-7 text-cyan-300" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
                {start.tag ?? "Chapter 1"}
              </p>
              <p className="mt-1 font-syne text-2xl font-bold text-white">{start.label}</p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">{start.description}</p>
            </div>
            <span className="font-mono text-sm text-cyan-300 opacity-80 transition group-hover:opacity-100">
              Begin →
            </span>
          </div>
        </motion.div>
      </Link>

      <LearnStagger className={clsx("grid gap-4", native ? "grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-3")}>
        {chapters.map((guide, i) => (
          <LearnStaggerItem key={guide.slug}>
            <Link href={learnHref(guide.slug)} className="group block h-full">
              <div className="learn-hub-card h-full">
                <div className="flex items-center gap-3">
                  <span className="learn-hub-chapter-num">{String(i + 2).padStart(2, "0")}</span>
                  {guide.product === "docs" ? (
                    <span className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] font-mono text-xs text-cyan-300">
                      Abc
                    </span>
                  ) : (
                    <ProductMark product={guide.product} size={40} animated={false} />
                  )}
                  <span className="font-sans text-sm font-semibold text-white">{guide.label}</span>
                </div>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-secondary">{guide.description}</p>
                <span className="mt-4 font-mono text-[11px] text-cyan-300/80 opacity-0 transition group-hover:opacity-100">
                  Open chapter →
                </span>
              </div>
            </Link>
          </LearnStaggerItem>
        ))}
      </LearnStagger>
    </div>
  );
}
