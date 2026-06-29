"use client";

import Link from "next/link";
import { useState } from "react";
import { LearnDoc } from "@/components/learn/LearnDoc";

const VERDICTS = [
  {
    id: "hold",
    label: "HOLD",
    color: "text-green-400",
    border: "border-green-500/30",
    bg: "bg-green-500/5",
    description: "The position is within expected parameters. No action required. The setup remains intact, theta decay is within tolerance, and no GEX or flow signals suggest the thesis has changed.",
    triggers: [
      "DTE is adequate for the expected move",
      "P&L is within normal drawdown range",
      "IV has not moved adversarially",
      "GEX alignment still supports the direction",
      "No significant counter-flow detected",
    ],
  },
  {
    id: "trim",
    label: "TRIM",
    color: "text-yellow-400",
    border: "border-yellow-500/30",
    bg: "bg-yellow-500/5",
    description: "Partial exit is advisable. The position has either reached a partial profit target, theta decay is accelerating toward an unfavorable threshold, or the GEX or flow context has shifted against the trade but not materially invalidated it. Trim to reduce exposure.",
    triggers: [
      "P&L is at a meaningful gain and DTE is declining",
      "IV has moved partially against the position",
      "GEX structure has weakened but not reversed",
      "Position is significantly in-the-money — delta near 1",
      "A partial exit improves the risk profile without abandoning the thesis",
    ],
  },
  {
    id: "sell",
    label: "SELL",
    color: "text-red-400",
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    description: "Full exit is recommended. The original thesis has been invalidated, stop-loss criteria have been met, or time decay has reduced the position to a lottery ticket without meaningful remaining delta.",
    triggers: [
      "Stop level has been breached",
      "Profit target reached",
      "GEX structure has inverted against the position",
      "Strong counter-flow confirms reversal",
      "DTE is critically low relative to remaining move potential",
    ],
  },
];

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "verdict-engine", label: "Verdict Engine" },
  { id: "key-features", label: "Key Features" },
  { id: "usage", label: "Step-by-Step Usage" },
  { id: "dos-donts", label: "Dos & Don'ts" },
  { id: "cross-references", label: "Cross-References" },
  { id: "glossary", label: "Glossary" },
  { id: "faq", label: "FAQ" },
];

export default function NightsWatchPage() {
  const [activeVerdict, setActiveVerdict] = useState("hold");
  const selected = VERDICTS.find((v) => v.id === activeVerdict)!;
  return (
    <LearnDoc
      title="Night's Watch"
      description="Your personal options position manager. Live P&L, Greeks tracking, and structured exit guidance — wired directly to live options chain data."
      sections={TOC}
    >

            <section id="overview">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Overview</h2>
              <div className="space-y-4 text-secondary leading-relaxed">
                <p>
                  Night&apos;s Watch is your options position manager — the place where trades go after they are placed. While SPX Slayer and HELIX focus on entry decisions, Night&apos;s Watch focuses entirely on what to do after you are in a position.
                </p>
                <p>
                  The tool tracks every open position across your portfolio with live mark-to-market pricing sourced from the live options chain. For each position, it surfaces real-time P&amp;L, live Greeks (Delta, Gamma, Theta, Vega), valuation status, and a continuous AI verdict recommending whether to HOLD, TRIM, or SELL.
                </p>
                <p>
                  Night&apos;s Watch is designed for SPX and single-name short-dated options. 0DTE positions receive continuous monitoring given their accelerating time decay. Multi-day positions receive verdict updates on each valuation cycle.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
                {[
                  { label: "Data Source", value: "Live Chain", sub: "Live options chain via our market data engine" },
                  { label: "Valuation", value: "Mark-to-Market", sub: "Continuous bid/ask mid pricing" },
                  { label: "Exit Verdicts", value: "3 States", sub: "HOLD / TRIM / SELL" },
                ].map((stat) => (
                  <div key={stat.label} className="border border-cyan-900/30 rounded-lg bg-white/[0.02] p-4">
                    <p className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">{stat.label}</p>
                    <p className="text-white font-semibold">{stat.value}</p>
                    <p className="text-mute text-sm mt-1">{stat.sub}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="how-it-works">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">How It Works</h2>
              <div className="space-y-5 text-secondary leading-relaxed">
                <p>
                  Each position in Night&apos;s Watch is defined by the standard options contract parameters: ticker, strike, expiry, side (call/put), size, and your average entry price. You can add positions via Largo&apos;s <code className="text-cyan-400 bg-cyan-950/50 px-1.5 py-0.5 rounded text-sm font-mono">add_position</code> natural-language command, or directly from the Night&apos;s Watch interface.
                </p>
                <p>
                  Once tracked, the position enters the valuation pipeline. The pipeline fetches the current bid-ask spread for your exact contract from the live options chain, computes the mid-price, and marks your position to market. Greeks are extracted from the chain response for the same contract.
                </p>
                <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-950/10">
                  <p className="text-amber-400 font-semibold text-sm mb-1">Valuation Status</p>
                  <p className="text-secondary text-sm leading-relaxed">
                    Every position displays one of three valuation status indicators: <span className="text-cyan-400 font-mono">live</span> (chain data fresh within 30 seconds), <span className="text-sky-300 font-mono">stale</span> (chain data present but older than 30 seconds), or <span className="text-mute font-mono">unavailable</span> (options chain cannot be fetched — market closed or contract has expired). Do not rely on P&amp;L figures when status shows <span className="text-mute font-mono">unavailable</span>.
                  </p>
                </div>
              </div>
            </section>

            <section id="verdict-engine">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Verdict Engine</h2>
              <p className="text-secondary leading-relaxed mb-6">
                The verdict engine runs continuously during Regular Trading Hours. For each open position, it evaluates a multi-factor model and emits one of three verdicts. Select each to see what drives it.
              </p>

              {/* Interactive verdict tabs */}
              <div className="flex gap-3 mb-4">
                {VERDICTS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setActiveVerdict(v.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors border ${
                      activeVerdict === v.id
                        ? `${v.border} ${v.bg} ${v.color}`
                        : "border-white/10 text-secondary hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <div className={`rounded-lg border ${selected.border} ${selected.bg} p-6 mb-8`}>
                <p className={`font-bold text-lg mb-3 ${selected.color}`}>{selected.label}</p>
                <p className="text-secondary text-sm leading-relaxed mb-4">{selected.description}</p>
                <p className="text-xs uppercase tracking-widest text-white/50 mb-2">Common Triggers</p>
                <ul className="space-y-1">
                  {selected.triggers.map((t) => (
                    <li key={t} className="text-sm text-secondary flex gap-2">
                      <span className={`mt-0.5 ${selected.color}`}></span> {t}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-cyan-900/30 rounded-xl bg-white/[0.02] p-6">
                <p className="text-cyan-400 font-semibold mb-4">Verdict Inputs</p>
                <p className="text-secondary text-sm leading-relaxed mb-4">The verdict engine evaluates the following signals for each position on every cycle:</p>
                <ul className="space-y-2">
                  {[
                    "Current P&L as a percentage of entry premium (profit-target and stop-loss thresholds)",
                    "Time to expiry and theta decay rate relative to position size",
                    "Delta and Gamma values — whether the contract retains meaningful directional sensitivity",
                    "Current GEX regime (positive/negative) relative to trade direction",
                    "Recent HELIX flow bias aligned or opposed to the trade thesis",
                    "Current SPX spot position relative to key GEX levels (Call Wall, Gamma Flip, Put Wall)",
                  ].map((signal, i) => (
                    <li key={i} className="flex gap-2 text-sm text-secondary">
                      <span className="text-cyan-400 shrink-0 mt-0.5">—</span>
                      <span className="leading-relaxed">{signal}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="key-features">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Key Features</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { title: "Live P&L", description: "Continuous mark-to-market against live bid/ask mid price. Unrealized P&L updates with each valuation cycle." },
                  { title: "Live Greeks Panel", description: "Delta, Gamma, Theta, and Vega for each position sourced from the live options chain — not Black-Scholes estimates." },
                  { title: "Valuation Status Indicator", description: "Clear live/stale/unavailable status so you always know whether the P&L figure is trustworthy." },
                  { title: "Natural Language Entry", description: "Add positions via Largo AI terminal with plain-English commands: 'Add 5 SPX 5800 calls expiring today at $3.20'" },
                  { title: "Closed Position History", description: "All closed positions move to the history view with realized P&L, entry and exit prices, and trade duration." },
                  { title: "GEX Level Annotations", description: "Each open position displays the current Call Wall, Put Wall, and Gamma Flip relative to the contract's strike, providing structural context at a glance." },
                ].map((f) => (
                  <div key={f.title} className="border border-cyan-900/25 rounded-lg bg-white/[0.015] p-5">
                    <p className="text-cyan-400 font-semibold mb-2 text-sm">{f.title}</p>
                    <p className="text-secondary text-sm leading-relaxed">{f.description}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="usage">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Step-by-Step Usage</h2>
              <div className="space-y-6">
                {[
                  { step: "01", title: "Add Your Position", body: "After executing a trade in your broker, add it to Night's Watch. You can use the manual entry form (ticker, strike, expiry, side, size, entry price) or tell Largo: 'Track my SPX 5800C 0DTE, 10 contracts, avg $2.15'." },
                  { step: "02", title: "Monitor Valuation Status", body: "During RTH, your position's valuation status should be live. If you see stale, wait one valuation cycle — the chain fetch may be delayed. If it shows unavailable, verify your broker's position status and check the market hours indicator." },
                  { step: "03", title: "Read the Verdict Continuously", body: "Night's Watch runs the verdict engine continuously. Treat a HOLD verdict as confirmation, not complacency. A TRIM verdict should prompt immediate position sizing review. A SELL verdict is a hard exit signal — act on it." },
                  { step: "04", title: "Use Greeks to Guide Sizing", body: "As a 0DTE approaches expiry, Gamma spikes and Theta accelerates. When Theta is consuming premium faster than your thesis is playing out, the verdict engine will reflect this — typically as a TRIM or SELL." },
                  { step: "05", title: "Cross-Reference Structural Levels", body: "The GEX level annotations show you how your strike relates to the current Call Wall, Put Wall, and Gamma Flip. If SPX is moving away from your strike and through a structural wall, the verdict engine will factor this." },
                  { step: "06", title: "Close and Archive", body: "When you exit a position in your broker, mark it as closed in Night's Watch. The realized P&L will be calculated and archived to your history. Review closed positions periodically to identify thesis errors and timing patterns." },
                ].map((s) => (
                  <div key={s.step} className="flex gap-5">
                    <div className="shrink-0 w-10 h-10 rounded-full border border-cyan-700/50 bg-cyan-950/30 flex items-center justify-center">
                      <span className="text-cyan-400 text-xs font-mono font-bold">{s.step}</span>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold mb-2">{s.title}</h3>
                      <p className="text-secondary leading-relaxed text-sm">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="dos-donts">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Dos & Don&apos;ts</h2>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="border border-cyan-800/40 rounded-xl bg-cyan-950/10 p-6">
                  <p className="text-cyan-400 font-bold font-mono text-sm uppercase tracking-wider mb-4">Do</p>
                  <ul className="space-y-3 text-secondary text-sm">
                    {["Log every position immediately after execution — don't batch-enter at end of day.", "Respect SELL verdicts as hard signals, not suggestions.", "Check valuation status before acting on a P&L figure.", "Use Largo to add positions if you prefer natural language over forms.", "Review closed position history weekly to identify recurrent errors.", "Monitor Theta decay rate on 0DTE positions — trim early if decay is outpacing the trade."].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-cyan-400 mt-0.5 shrink-0">+</span><span className="leading-relaxed">{item}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="border border-sky-900/40 rounded-xl bg-sky-950/10 p-6">
                  <p className="text-sky-300 font-bold font-mono text-sm uppercase tracking-wider mb-4">Don&apos;t</p>
                  <ul className="space-y-3 text-secondary text-sm">
                    {["Don't use P&L figures when valuation status shows unavailable.", "Don't override a SELL verdict without a concrete reason grounded in updated live data.", "Don't use Night's Watch for long-dated positions (LEAPS, multi-week swing trades) — it's calibrated for 0DTE and 1–5 DTE.", "Don't confuse the Night's Watch verdict with broker trade recommendations.", "Don't ignore TRIM verdicts — partial exits often save capital that loses value holding through the close."].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-sky-300 mt-0.5 shrink-0">–</span><span className="leading-relaxed">{item}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section id="cross-references">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Cross-References</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { href: "/learn/spx-slayer", name: "SPX Slayer", rel: "The primary source of trade ideas that Night's Watch then monitors." },
                  { href: "/learn/largo-ai", name: "Largo AI Terminal", rel: "Add positions and ask structured questions about your portfolio via natural language." },
                  { href: "/learn/heat-maps", name: "Heat Maps", rel: "The GEX level annotations in Night's Watch are sourced from Heat Maps." },
                  { href: "/learn/helix-flows", name: "HELIX Options Flow", rel: "Flow bias from HELIX feeds into Night's Watch verdict computation." },
                  { href: "/learn/night-hawk", name: "Night Hawk", rel: "Night Hawk play ideas are a primary source of positions tracked in Night's Watch." },
                  { href: "/learn/blackout-grid", name: "BlackOut Grid", rel: "For any position tracking an underlying with a scheduled catalyst, the Grid provides earnings, analyst, and news context." },
                ].map((ref) => (
                  <Link key={ref.href} href={ref.href} className="block border border-cyan-900/30 rounded-xl bg-white/[0.02] p-5 hover:border-cyan-700/50 hover:bg-cyan-950/20 transition-all group">
                    <p className="text-cyan-400 font-semibold group-hover:text-cyan-300 transition-colors mb-2">{ref.name} &rarr;</p>
                    <p className="text-secondary text-sm leading-relaxed">{ref.rel}</p>
                  </Link>
                ))}
              </div>
            </section>

            <section id="glossary">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Glossary</h2>
              <div className="space-y-3">
                {[
                  { term: "Delta", def: "The rate of change of an option's price relative to a $1 move in the underlying. For calls: 0 to +1. For puts: −1 to 0." },
                  { term: "Gamma", def: "The rate of change of Delta per $1 move in the underlying. High Gamma means Delta — and therefore P&L sensitivity — changes rapidly." },
                  { term: "Theta", def: "The time decay of an option's value per day. Theta accelerates for 0DTE options, particularly in the final hours before expiry." },
                  { term: "Vega", def: "The sensitivity of an option's value to a 1% change in implied volatility." },
                  { term: "Mark-to-Market", def: "Valuing a position at its current market price (bid/ask mid) rather than cost basis." },
                  { term: "Valuation Status", def: "Live / Stale / Unavailable — the freshness indicator for Night's Watch chain data." },
                  { term: "TRIM", def: "A partial exit verdict: reduce position size to lock in partial gains or limit further loss exposure." },
                  { term: "SELL", def: "A full exit verdict: close the entire position. Triggered by thesis invalidation, stop-loss, or terminal theta decay." },
                ].map((g) => (
                  <div key={g.term} className="flex gap-4 border-l-2 border-cyan-900/50 pl-4 py-1">
                    <div className="shrink-0 w-28">
                      <span className="text-cyan-400 font-mono text-sm font-semibold">{g.term}</span>
                    </div>
                    <p className="text-secondary text-sm leading-relaxed">{g.def}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="faq">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">FAQ</h2>
              <div className="space-y-5">
                {[
                  { q: "Night's Watch is showing stale valuation status. What does this mean?", a: "Stale means the chain data backing your P&L is more than 30 seconds old. This typically happens during brief data latency windows. Wait 60 seconds and refresh. If the status persists and market is open, check the platform status page. Do not make sizing decisions based on stale marks." },
                  { q: "Why is my closed position showing no Realized P&L?", a: "Realized P&L is computed from your entry price and the price at which you marked the position as closed. Ensure you entered your exit price when closing the position. If the exit price field was left empty, the system cannot compute a realized figure." },
                  { q: "Can Night's Watch automatically exit positions at my broker?", a: "No. Night's Watch is a monitoring and advisory tool — it does not connect to broker APIs or place orders. All order execution happens in your broker platform." },
                  { q: "Night's Watch issued a SELL verdict but my broker fill looks fine. Should I follow it?", a: "Night's Watch verdicts are advisory, not mandatory. However, treat a SELL verdict seriously. The engine has evaluated the position against live GEX, flow, and decay inputs. If your reason for overriding the verdict is based on live data you have that the system does not, that is valid. If it is purely emotional, follow the verdict." },
                ].map((item, i) => (
                  <div key={i} className="border border-cyan-900/25 rounded-xl bg-white/[0.015] p-6">
                    <p className="text-white font-semibold mb-3 leading-snug">{item.q}</p>
                    <p className="text-secondary text-sm leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

    </LearnDoc>
  );
}
