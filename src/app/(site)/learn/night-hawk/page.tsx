export const dynamic = "force-static";

import Link from "next/link";
import type { Metadata } from "next";
import { LearnDoc } from "@/components/learn/LearnDoc";

export const metadata: Metadata = {
  title: "Night Hawk — Evening SPX Play Scanner | BlackOut Trading",
  description:
    "Night Hawk scans overnight GEX positioning, catalyst calendars, and historical patterns each evening to identify directional SPX setups for the next trading day.",
};

const sections = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "edition-structure", label: "Edition Structure" },
  { id: "key-features", label: "Key Features" },
  { id: "usage", label: "Step-by-Step Usage" },
  { id: "dos-and-donts", label: "Dos & Don'ts" },
  { id: "cross-references", label: "Cross-References" },
  { id: "faq", label: "FAQ" },
  { id: "glossary", label: "Glossary" },
];

export default function Page() {
  return (
    <LearnDoc
      title="Night Hawk"
      description="Evening SPX play scanner. Each night, Night Hawk synthesizes GEX positioning, the next-day catalyst calendar, and historical pattern data into a structured edition — directional theses, key levels, and specific play ideas for the following session."
      sections={sections}
    >


            <section id="overview">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">01</span>Overview
              </h2>
              <div className="space-y-5 text-secondary leading-relaxed">
                <p>
                  Night Hawk runs each evening after market close, before the next session opens. The scanner ingests three primary data streams — dealer GEX positioning, the next-day economic and earnings catalyst calendar, and historical overnight pattern data — and produces a structured edition for the following day.
                </p>
                <p>
                  Unlike intraday signals, Night Hawk operates on positioning data that is inherently forward-looking. Dealer hedging flows create measurable structural levels — call walls, put walls, and gamma flip points — that tend to act as gravitational zones throughout the next session.
                </p>
                <p>
                  The output is a play edition: a structured document containing a market context summary, catalyst scan, GEX level map, directional thesis, and specific play ideas with strikes, expiries, and risk parameters. A morning confirmation update at 9:15 AM ET refreshes the edition with pre-market price action.
                </p>
              </div>
            </section>

            <section id="how-it-works">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">02</span>How It Works
              </h2>
              <div className="space-y-4">
                {[
                  { step: "4:30 PM ET", title: "Backup Scan Window", description: "An early pass runs against options chain data immediately after regular-hours close. This backup ensures an edition is available even if the primary run encounters data latency." },
                  { step: "5:30 PM ET", title: "Primary Scan & Edition Publish", description: "The primary scan runs after options market close, when dealer positioning data is most complete. Night Hawk pulls the full GEX surface across SPX strikes, cross-references the next-day catalyst calendar, and evaluates historical overnight patterns." },
                  { step: "9:15 AM ET", title: "Morning Confirmation Update", description: "Before the open, Night Hawk appends a morning confirmation block incorporating pre-market price action and any overnight news catalysts." },
                  { step: "9:30 AM ET", title: "Your Responsibility: Live Validation", description: "Night Hawk editions do not auto-execute. At the open, validate the overnight thesis against live data: SPX Slayer for real-time desk context, HELIX for institutional flow direction, and Thermal to confirm GEX walls are holding." },
                ].map((item, i) => (
                  <div key={i} className="flex gap-5 p-5 bg-white/3 border border-white/10 rounded-xl hover:border-cyan-400/30 transition-colors">
                    <div className="flex-shrink-0">
                      <span className="text-xs font-mono text-cyan-400 bg-cyan-400/10 border border-cyan-400/30 px-2 py-1 rounded whitespace-nowrap">{item.step}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-white mb-2">{item.title}</p>
                      <p className="text-sm text-secondary leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="edition-structure">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">03</span>Edition Structure
              </h2>
              <p className="text-secondary leading-relaxed mb-6">Every Night Hawk edition follows a standardized six-block structure.</p>
              <div className="mt-6 space-y-3">
                {[
                  { label: "Market Context", color: "cyan", description: "A brief assessment of where SPX closed relative to key structural levels, the prevailing volatility regime, and any relevant macro backdrop." },
                  { label: "Catalyst Scan", color: "sky", description: "Next-day economic releases, Fed speakers, major earnings, and any events that could affect overnight or intraday positioning." },
                  { label: "GEX Positioning", color: "cyan", description: "The key gamma exposure levels for the next session: call wall, put wall, and the gamma flip point." },
                  { label: "Directional Thesis", color: "sky", description: "The core view for the next session — bullish, bearish, or range-bound — anchored to GEX structure, catalyst risk, and historical pattern context." },
                  { label: "Play Ideas", color: "cyan", description: "Specific option play concepts with suggested strike ranges, expiry (0DTE or 1DTE), and risk-reward parameters. Strike prices are priced at prior day's close — always verify live pricing at open." },
                  { label: "Invalidation Levels", color: "sky", description: "The price levels at which the thesis is no longer valid. If SPX breaks through these levels at open, Night Hawk's directional bias should be abandoned." },
                ].map((block, i) => (
                  <div key={i} className={`p-5 rounded-xl border ${block.color === "cyan" ? "bg-cyan-400/5 border-cyan-400/20" : "bg-sky-300/5 border-sky-300/20"}`}>
                    <div className="flex items-start gap-4">
                      <span className={`text-xs font-mono font-bold uppercase tracking-widest flex-shrink-0 mt-0.5 ${block.color === "cyan" ? "text-cyan-400" : "text-sky-300"}`}>{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <p className={`font-semibold mb-2 ${block.color === "cyan" ? "text-cyan-400" : "text-sky-300"}`}>{block.label}</p>
                        <p className="text-sm text-secondary leading-relaxed">{block.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="usage">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">05</span>Step-by-Step Usage
              </h2>
              <div className="space-y-6">
                {[
                  {
                    time: "Evening (5:30–7:00 PM ET)",
                    steps: [
                      "Open the Night Hawk feed and read the current edition in full — do not skip directly to the play ideas.",
                      "Identify the three GEX levels (call wall, put wall, gamma flip) and mark them on your chart.",
                      "Note the directional thesis and its stated confidence level.",
                      "Review the invalidation levels. Write them down.",
                      "If there are high-impact catalysts flagged for the next day, mentally discount the thesis — catalyst days require tighter risk framing.",
                      "Review the play ideas as frameworks, not orders. The strikes are yesterday's prices.",
                    ],
                  },
                  {
                    time: "Pre-Market (8:30–9:15 AM ET)",
                    steps: [
                      "Read the morning confirmation block when it publishes at 9:15 AM ET.",
                      "Compare overnight futures positioning to the Night Hawk call wall and put wall.",
                      "Note whether SPX futures are above or below the gamma flip.",
                      "Check the BlackOut Grid for any overnight news catalysts.",
                    ],
                  },
                  {
                    time: "Market Open (9:30–10:00 AM ET)",
                    steps: [
                      "Open SPX Slayer to monitor the live desk at the open.",
                      "Check HELIX for the direction of institutional flow in the first 5–10 minutes.",
                      "Confirm that flow direction aligns with Night Hawk's directional bias.",
                      "If SPX opens beyond your invalidation level: stand down. Do not force the Night Hawk thesis against contrary live data.",
                    ],
                  },
                ].map((phase, i) => (
                  <div key={i} className="border border-white/10 rounded-xl overflow-hidden">
                    <div className="bg-cyan-400/8 border-b border-white/10 px-5 py-3">
                      <p className="font-mono text-sm text-cyan-400 font-semibold">{phase.time}</p>
                    </div>
                    <div className="p-5">
                      <ol className="space-y-3">
                        {phase.steps.map((step, j) => (
                          <li key={j} className="flex gap-3 text-sm">
                            <span className="text-cyan-400 font-mono font-bold flex-shrink-0">{j + 1}.</span>
                            <span className="text-secondary leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="dos-and-donts">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">06</span>Dos & Don&apos;ts
              </h2>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="p-6 bg-cyan-400/5 border border-cyan-400/20 rounded-xl">
                  <p className="font-semibold text-cyan-400 mb-4 text-sm uppercase tracking-wider font-mono">Do</p>
                  <ul className="space-y-3">
                    {["Read the entire edition, including context and catalyst scan, before jumping to play ideas.", "Mark all three GEX levels on your chart before the open.", "Wait for the morning confirmation update before finalizing your plan.", "Validate the Night Hawk thesis with SPX Slayer, HELIX, and Thermal at open.", "Respect invalidation levels as hard stops on the thesis.", "Treat Night Hawk plays as directional frameworks and re-price strikes at open."].map((item, i) => (
                      <li key={i} className="flex gap-3 text-sm"><span className="text-cyan-400 flex-shrink-0 mt-0.5">+</span><span className="text-secondary leading-relaxed">{item}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="p-6 bg-red-400/5 border border-red-400/20 rounded-xl">
                  <p className="font-semibold text-red-400 mb-4 text-sm uppercase tracking-wider font-mono">Don&apos;t</p>
                  <ul className="space-y-3">
                    {["Place limit orders overnight based on Night Hawk strike prices — premiums will be different at open.", "Ignore the morning confirmation update.", "Trade the Night Hawk thesis if SPX opens through an invalidation level.", "Use Night Hawk plays without confirming live flow direction on HELIX at the open.", "Mistake Night Hawk's directional bias for a guaranteed outcome.", "Skip the catalyst scan section. Macro risk can overwhelm GEX structure."].map((item, i) => (
                      <li key={i} className="flex gap-3 text-sm"><span className="text-red-400 flex-shrink-0 mt-0.5">—</span><span className="text-secondary leading-relaxed">{item}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section id="cross-references">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">07</span>Cross-References
              </h2>
              <div className="space-y-4">
                {[
                  { name: "SPX Slayer", href: "/learn/spx-slayer", role: "Live Open Validation", description: "The primary tool for validating Night Hawk levels at the open." },
                  { name: "Thermal", href: "/learn/heat-maps", role: "GEX Wall Confirmation", description: "Confirm in Thermal that the call wall and put wall identified in the edition are still structurally intact." },
                  { name: "HELIX Options Flow", href: "/learn/helix-flows", role: "Flow Direction Confirmation", description: "Verify that the direction of large-order flow aligns with Night Hawk's directional bias at the open." },
                  { name: "BlackOut Grid", href: "/learn/blackout-grid", role: "Overnight Catalyst Monitoring", description: "Check the Grid in the pre-market window to identify any overnight developments Night Hawk's catalyst scan could not have captured." },
                  { name: "Largo AI Terminal", href: "/learn/largo-ai", role: "Thesis Stress-Testing", description: "Largo can stress-test the thesis before committing capital, particularly when the edition flags elevated uncertainty." },
                  { name: "Night's Watch", href: "/learn/nights-watch", role: "Position Tracking", description: "Once you execute a Night Hawk play, Night's Watch is where you manage it." },
                ].map((tool, i) => (
                  <Link key={i} href={tool.href} className="flex gap-5 p-5 bg-white/3 border border-white/10 rounded-xl hover:border-cyan-400/30 hover:bg-cyan-400/3 transition-all group">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <span className="font-semibold text-white group-hover:text-cyan-400 transition-colors">{tool.name}</span>
                        <span className="text-xs font-mono text-sky-300 bg-sky-300/10 border border-sky-300/20 px-2 py-0.5 rounded">{tool.role}</span>
                      </div>
                      <p className="text-sm text-secondary leading-relaxed">{tool.description}</p>
                    </div>
                    <span className="text-secondary group-hover:text-cyan-400 transition-colors flex-shrink-0 mt-1">→</span>
                  </Link>
                ))}
              </div>
            </section>

            <section id="faq">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">08</span>FAQ
              </h2>
              <div className="space-y-5">
                {[
                  { q: "Night Hawk published an edition but I don't see a morning confirmation. What happened?", a: "The morning confirmation publishes at 9:15 AM ET on trading days. If it is after 9:15 AM and you do not see an update, the system may have detected no material changes to the thesis from overnight data — in which case the prior evening's edition stands." },
                  { q: "The Night Hawk thesis is bullish but SPX opens below the gamma flip. Should I still take the trade?", a: "No. Opening below the gamma flip is a structural negative — dealer positioning shifts from a stabilizing regime to an amplifying one. If Night Hawk's thesis was predicated on SPX holding above the gamma flip, an open below that level constitutes a thesis invalidation." },
                  { q: "If Night Hawk and HELIX are giving opposite signals at the open, which do I follow?", a: "HELIX represents live institutional positioning; Night Hawk represents overnight structural analysis. When they conflict at the open, live flow takes precedence over overnight positioning. Do not force a Night Hawk trade against contrary institutional flow." },
                ].map((item, i) => (
                  <div key={i} className="p-6 bg-white/3 border border-white/10 rounded-xl">
                    <p className="font-semibold text-white mb-3 leading-relaxed">{item.q}</p>
                    <p className="text-sm text-secondary leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="glossary">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-cyan-400 font-mono text-lg">09</span>Glossary
              </h2>
              <div className="space-y-4">
                {[
                  { term: "Call Wall", definition: "The strike level with the highest concentration of call-side gamma. Dealers must sell SPX as price rises to remain delta-neutral, creating structural resistance." },
                  { term: "Gamma Flip", definition: "The strike level where aggregate dealer gamma crosses zero. Above: stabilizing dealer flows. Below: amplifying flows." },
                  { term: "Invalidation Level", definition: "The price level defined in a Night Hawk edition at which the directional thesis is no longer valid." },
                  { term: "0DTE", definition: "Zero days to expiration. Night Hawk 0DTE plays must be executed at open and closed before end of session." },
                  { term: "Edition", definition: "The structured document Night Hawk publishes each evening containing six analysis blocks." },
                  { term: "Morning Confirmation", definition: "The 9:15 AM ET update appended to each edition incorporating pre-market price action and any thesis revisions." },
                ].map((item, j) => (
                  <div key={j} className="flex gap-4 p-4 bg-white/3 border border-white/10 rounded-lg">
                    <div className="flex-shrink-0 w-40">
                      <span className="font-mono text-sm font-semibold text-sky-300">{item.term}</span>
                    </div>
                    <p className="text-sm text-secondary leading-relaxed">{item.definition}</p>
                  </div>
                ))}
              </div>
            </section>
    </LearnDoc>
  );
}
