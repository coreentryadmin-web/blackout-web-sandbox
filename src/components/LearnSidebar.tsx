"use client";

import Link from "next/link";
import { clsx } from "clsx";

export type LearnSlug =
  | "getting-started"
  | "spx-slayer"
  | "helix-flows"
  | "largo-ai"
  | "night-hawk"
  | "heat-maps"
  | "nights-watch"
  | "blackout-grid"
  | "glossary";

const NAV_ITEMS: { slug: LearnSlug; emoji: string; label: string }[] = [
  { slug: "getting-started", emoji: "🚀", label: "Getting Started" },
  { slug: "spx-slayer",      emoji: "⚔️", label: "SPX Slayer" },
  { slug: "helix-flows",     emoji: "🧬", label: "HELIX Options Flow" },
  { slug: "largo-ai",        emoji: "🤖", label: "Largo AI Terminal" },
  { slug: "night-hawk",      emoji: "🦅", label: "Night Hawk" },
  { slug: "heat-maps",       emoji: "🌡️", label: "Heat Maps" },
  { slug: "nights-watch",    emoji: "🛡️", label: "Night's Watch" },
  { slug: "blackout-grid",   emoji: "⚡", label: "BlackOut Grid" },
  { slug: "glossary",        emoji: "📖", label: "Glossary" },
];

export function LearnSidebar({ activeSlug }: { activeSlug?: LearnSlug }) {
  return (
    <nav
      aria-label="Documentation navigation"
      className="sticky top-20 flex flex-col gap-0.5 rounded-xl border border-white/10 bg-white/[0.02] p-3"
    >
      <p className="mb-2 px-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-cyan-400">
        Documentation
      </p>
      {NAV_ITEMS.map((item) => {
        const active = item.slug === activeSlug;
        return (
          <Link
            key={item.slug}
            href={`/learn/${item.slug}`}
            className={clsx(
              "flex items-center gap-2.5 rounded-lg px-2 py-2 font-mono text-sm transition-colors",
              active
                ? "bg-cyan-400/10 text-cyan-400"
                : "text-slate-300 hover:bg-white/[0.04] hover:text-white"
            )}
            aria-current={active ? "page" : undefined}
          >
            <span className="shrink-0 text-base" aria-hidden>{item.emoji}</span>
            <span className="leading-snug">{item.label}</span>
            {active && (
              <span className="ml-auto text-cyan-400" aria-hidden>◆</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
