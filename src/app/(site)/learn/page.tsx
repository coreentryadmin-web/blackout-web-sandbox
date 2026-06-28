export const dynamic = "force-static";

import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Learn Â· BlackOut",
  description: "Documentation and guides for every BlackOut Trading tool.",
};

const TOOLS = [
  {
    slug: "getting-started",
    emoji: "ðŸš€",
    label: "Getting Started",
    desc: "Platform overview and how all tools connect. Start here if you are new.",
    accent: "border-cyan-400/30 hover:border-cyan-400/60",
    tag: "Start Here",
  },
  {
    slug: "spx-slayer",
    emoji: "âš”ï¸",
    label: "SPX Slayer",
    desc: "Real-time SPX options desk with GEX walls, play engine, and 0DTE war-room setup.",
    accent: "border-emerald-400/30 hover:border-emerald-400/60",
    tag: null,
  },
  {
    slug: "helix-flows",
    emoji: "ðŸ§¬",
    label: "HELIX Options Flow",
    desc: "Live institutional options flow tape â€” whale alerts, dark-pool prints, anomaly scanner.",
    accent: "border-purple-400/30 hover:border-purple-400/60",
    tag: null,
  },
  {
    slug: "largo-ai",
    emoji: "ðŸ¤–",
    label: "Largo AI Terminal",
    desc: "AI-powered market analysis desk with live tool access, GEX context, and flow data.",
    accent: "border-sky-400/30 hover:border-sky-400/60",
    tag: null,
  },
  {
    slug: "night-hawk",
    emoji: "ðŸ¦…",
    label: "Night Hawk",
    desc: "Evening SPX play scanner â€” tomorrow's setups, tonight. Curated playbook delivery.",
    accent: "border-red-400/30 hover:border-red-400/60",
    tag: null,
  },
  {
    slug: "heat-maps",
    emoji: "ðŸŒ¡ï¸",
    label: "Heat Maps",
    desc: "GEX, VEX, DEX, and CHARM dealer-positioning heatmaps. Read the regime at a glance.",
    accent: "border-orange-400/30 hover:border-orange-400/60",
    tag: null,
  },
  {
    slug: "nights-watch",
    emoji: "ðŸ›¡ï¸",
    label: "Night's Watch",
    desc: "Personal options position manager with live P&L, greeks, and expiry tracking.",
    accent: "border-indigo-400/30 hover:border-indigo-400/60",
    tag: null,
  },
  {
    slug: "blackout-grid",
    emoji: "âš¡",
    label: "BlackOut Grid",
    desc: "Market intelligence command center â€” news, flows, earnings, catalysts, analyst moves.",
    accent: "border-yellow-400/30 hover:border-yellow-400/60",
    tag: null,
  },
  {
    slug: "glossary",
    emoji: "ðŸ“–",
    label: "Glossary",
    desc: "Key terms, metrics, and concepts used across the platform, clearly defined.",
    accent: "border-slate-400/30 hover:border-slate-400/60",
    tag: null,
  },
] as const;

export default function LearnPage() {
  return (
    <PageShell>
      <div className="content-rail py-12">
        <PageHeader
          kicker="â—† DOCUMENTATION"
          title="BlackOut Docs"
          subtitle="Everything you need to master the platform."
        />

        {/* Start Here callout */}
        <Link
          href="/learn/getting-started"
          className="mt-10 flex items-center gap-4 rounded-xl border border-cyan-400/40 bg-cyan-400/5 px-5 py-4 transition-colors hover:border-cyan-400/70 hover:bg-cyan-400/10"
        >
          <span className="text-2xl" aria-hidden>ðŸš€</span>
          <div>
            <p className="font-syne text-sm font-semibold uppercase tracking-widest text-cyan-400">Start Here</p>
            <p className="mt-0.5 font-mono text-base text-white">Getting Started â€” Platform overview and how all tools connect</p>
          </div>
          <span className="ml-auto font-mono text-cyan-400" aria-hidden>â†’</span>
        </Link>

        {/* Tool grid */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.filter((t) => t.slug !== "getting-started").map((tool) => (
            <Link
              key={tool.slug}
              href={`/learn/${tool.slug}`}
              className={`group flex flex-col gap-3 rounded-xl border bg-white/[0.02] p-5 transition-all duration-200 hover:bg-white/[0.05] ${tool.accent}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl" aria-hidden>{tool.emoji}</span>
                <span className="font-syne text-sm font-semibold text-white">{tool.label}</span>
              </div>
              <p className="font-mono text-sm leading-relaxed text-slate-300">{tool.desc}</p>
              <span className="mt-auto font-mono text-xs text-sky-300 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
                Read docs â†’
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-12 font-mono text-xs text-slate-300">
          BlackOut Trading Â· Documentation is updated continuously as features ship.
        </p>
      </div>
    </PageShell>
  );
}
