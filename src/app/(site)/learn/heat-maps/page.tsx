"use client";

import Link from "next/link";
import { useState } from "react";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "four-views", label: "The Four Views" },
  { id: "key-metrics", label: "Key Metrics & Levels" },
  { id: "usage", label: "Step-by-Step Usage" },
  { id: "dos-donts", label: "Dos & Don'ts" },
  { id: "cross-references", label: "Cross-References" },
  { id: "glossary", label: "Glossary" },
  { id: "faq", label: "FAQ" },
];

const VIEWS = [
  {
    id: "profile",
    label: "GEX Profile",
    tag: "Bar Chart",
    body: ["The primary view. Each bar represents the net gamma exposure the dealer community holds at that strike. The tallest positive bar above spot is the Call Wall — the strongest mechanical resistance. The tallest positive bar below spot is the Put Wall — structural support.", "The bar that dominates across all strikes is the King Node: wherever price is trading when the session opens, it will spend most of the day gravitating toward the King Node unless a catalyst drives a regime shift."],
  },
  {
    id: "curve",
    label: "GEX Curve",
    tag: "Smooth Distribution",
    body: ["A smoothed, continuous representation of the gamma distribution across strikes. Where the Profile gives you discrete bar magnitudes, the Curve shows you the shape — peaks, troughs, and the width of concentration.", "The Gamma Flip crossover (where the curve crosses zero) is visible here with precision. A narrow, tall peak means gamma is tightly concentrated — expect strong pinning but a sharp transition once price moves away."],
  },
  {
    id: "shift",
    label: "GEX Shift",
    tag: "Overnight Change",
    body: ["A differential view: today's gamma distribution minus yesterday's. Green areas indicate strikes where gamma has increased overnight; red areas show where it has decreased.", "Significant shifts often precede meaningful price movement. If the Call Wall has shifted 50 points higher overnight, dealers have repositioned defensively."],
  },
  {
    id: "matrix",
    label: "GEX Matrix",
    tag: "Strike Ã— Expiry Grid",
    body: ["A two-dimensional heat map: rows are strikes, columns are expiries. Each cell shows the gamma concentration at that exact strike-expiry intersection.", "This view answers which expiry is driving the dominant GEX structure at a given strike. 0DTE-heavy walls are volatile and can flip during the session. Multi-expiry walls are structurally more persistent."],
  },
];

export default function HeatMapsPage() {
  const [activeView, setActiveView] = useState("profile");
  const selected = VIEWS.find((v) => v.id === activeView)!;
  return (
    <div className="min-h-screen text-white" style={{ background: "#040407" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Page Header */}
        <div className="mb-12 border-b border-cyan-900/40 pb-10">
          <p className="text-cyan-400 text-sm font-mono uppercase tracking-widest mb-3">BlackOut Intelligence Suite</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight">Heat Maps</h1>
          <p className="text-sky-300 text-xl max-w-3xl leading-relaxed">
            Dealer gamma, vanna, delta, and charm exposure mapped across every SPX strike and expiry — the structural skeleton behind price action.
          </p>
        </div>

        <div className="flex gap-10 items-start">
          <aside className="hidden lg:block w-56 shrink-0">
            <div className="sticky top-8 border border-cyan-900/30 rounded-xl bg-white/[0.02] p-5">
              <p className="text-cyan-400 text-xs font-mono uppercase tracking-widest mb-4">On This Page</p>
              <nav className="space-y-1">
                {TOC.map((item) => (
                  <a key={item.id} href={`#${item.id}`} className="block text-sm text-secondary hover:text-cyan-400 transition-colors py-1 px-2 rounded hover:bg-cyan-950/30">
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <main className="flex-1 min-w-0 space-y-16">

            <section id="overview">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Overview</h2>
              <div className="space-y-4 text-secondary leading-relaxed">
                <p>
                  Heat Maps renders the complete dealer options positioning picture for SPX — every strike, every expiry, four analytical lenses. Rather than charting price or volume, it surfaces the <span className="text-cyan-400 font-medium">mechanical obligations</span> dealers carry as market makers.
                </p>
                <p>
                  Dealer positioning is a structural constraint — it shapes how price moves because hedging activity is non-discretionary. Understanding where those constraints concentrate gives you a measurable, repeatable edge in identifying support, resistance, and regime character before price touches those levels.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
                {[
                  { label: "GEX", desc: "Gamma Exposure", color: "cyan" },
                  { label: "VEX", desc: "Vanna Exposure", color: "sky" },
                  { label: "DEX", desc: "Delta Exposure", color: "cyan" },
                  { label: "CHARM", desc: "Delta Decay / Time", color: "sky" },
                ].map((m) => (
                  <div key={m.label} className="border border-cyan-900/40 rounded-lg bg-white/[0.025] p-4 text-center">
                    <p className={`text-2xl font-bold font-mono ${m.color === "cyan" ? "text-cyan-400" : "text-sky-300"} mb-1`}>{m.label}</p>
                    <p className="text-xs text-mute">{m.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="how-it-works">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">How It Works</h2>
              <div className="space-y-6 text-secondary leading-relaxed">
                <p>
                  Options market makers (dealers) are on the opposite side of most retail and institutional options flow. When a trader buys a call, the dealer sells it and must maintain a delta-neutral book by continuously buying and selling the underlying.
                </p>
                <div className="border-l-2 border-cyan-500/50 pl-5 space-y-4">
                  <div>
                    <p className="text-cyan-400 font-semibold mb-1">Positive GEX Regime (above Gamma Flip)</p>
                    <p>Dealers are net long gamma. As spot rises, dealers sell the underlying — creating selling pressure. As spot falls, they buy — providing support. Net effect: price is attracted toward high-GEX strikes and ranges are compressed.</p>
                  </div>
                  <div>
                    <p className="text-sky-300 font-semibold mb-1">Negative GEX Regime (below Gamma Flip)</p>
                    <p>Dealers are net short gamma. As spot rises, they must buy more to hedge — amplifying the move. As spot falls, they sell — accelerating the decline. Moves become larger and more sustained.</p>
                  </div>
                </div>
                <p>
                  The <span className="text-cyan-400 font-medium">Gamma Flip</span> — the strike where net GEX crosses zero — is therefore the single most important structural level on the chart.
                </p>
              </div>
            </section>

            <section id="four-views">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">The Four Views</h2>

              {/* Interactive tabs */}
              <div className="flex flex-wrap gap-2 mb-6">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setActiveView(v.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      activeView === v.id
                        ? "border-cyan-400 bg-cyan-400/10 text-cyan-400"
                        : "border-white/10 text-secondary hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="border border-cyan-900/30 rounded-xl bg-white/[0.02] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="text-lg font-bold text-white">{selected.label}</h3>
                  <span className="text-xs font-mono px-2 py-0.5 rounded border text-cyan-400 border-cyan-700/50 bg-cyan-950/30">{selected.tag}</span>
                </div>
                <div className="space-y-3 text-secondary leading-relaxed">
                  {selected.body.map((para, i) => <p key={i}>{para}</p>)}
                </div>
              </div>
            </section>

            <section id="key-metrics">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Key Metrics & Levels</h2>
              <div className="space-y-4">
                {[
                  { term: "King Node", color: "cyan", def: "The dominant positive GEX strike across all expiries — the single level with the greatest magnetic pull on price. On a typical session, intraday reversion often terminates within 5–10 SPX points of the King Node." },
                  { term: "Call Wall", color: "sky", def: "The highest positive GEX strike above current spot. Dealers accumulate long gamma hedges here; approaching this level triggers mechanical selling into rallies, creating resistance." },
                  { term: "Put Wall", color: "cyan", def: "The highest positive GEX strike below current spot. Dealer buying into declines creates support. A breach of the Put Wall on high volume often precedes an acceleration lower." },
                  { term: "Gamma Flip", color: "sky", def: "The strike at which net GEX crosses zero. Trading above it favors mean-reversion; trading below it favors directional momentum." },
                  { term: "VEX (Vanna Exposure)", color: "cyan", def: "The sensitivity of dealer delta to changes in implied volatility. Critical to monitor around FOMC, CPI, and earnings events." },
                  { term: "DEX (Delta Exposure)", color: "sky", def: "The aggregate directional hedge position of the dealer community. A large positive DEX means dealers are net long delta and must sell into rallies." },
                  { term: "CHARM", color: "cyan", def: "The rate of change of delta with respect to time. As options approach expiry, CHARM flows create measurable directional pressure in the final hours before the close." },
                ].map((m) => (
                  <div key={m.term} className="flex gap-4 border border-cyan-900/20 rounded-lg bg-white/[0.015] p-5">
                    <div className="shrink-0 w-32">
                      <p className={`font-bold font-mono text-sm ${m.color === "cyan" ? "text-cyan-400" : "text-sky-300"}`}>{m.term}</p>
                    </div>
                    <p className="text-secondary text-sm leading-relaxed">{m.def}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="usage">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Step-by-Step Usage</h2>
              <div className="space-y-6">
                {[
                  { step: "01", title: "Pre-Market: Establish the Structural Range", body: "Open Heat Maps 30 minutes before the open. Load the GEX Profile. Identify the Call Wall, Put Wall, King Node, and Gamma Flip level. If SPX futures are trading above the Gamma Flip, assume a pinning, range-bound character unless a catalyst forces a breach." },
                  { step: "02", title: "Check the GEX Shift for Overnight Repositioning", body: "Toggle to the GEX Shift view. Look for large green or red differentials. If a previously strong Call Wall has absorbed more gamma overnight, dealers are more committed to defending that level." },
                  { step: "03", title: "Use the Matrix to Qualify Wall Durability", body: "For any level you plan to trade against, open the GEX Matrix and examine which expiries are driving the gamma. Walls anchored in weekly and monthly contracts are more durable than those driven primarily by 0DTE contracts." },
                  { step: "04", title: "Monitor the Gamma Flip in Real Time", body: "During the session, note whether SPX is holding above or below the Gamma Flip. A clean reclaim of the Gamma Flip after an early dip is a mechanical setup. A sustained break below the Gamma Flip on volume triggers a momentum thesis." },
                  { step: "05", title: "Into OpEx: Layer in CHARM Flows", body: "Wednesday through Friday of options expiry week, monitor the CHARM panel. These flows are time-mechanistic and often explain the final 90-minute directional pressure on expiry day." },
                  { step: "06", title: "Use VEX Around Vol Events", body: "Before FOMC decisions or CPI prints, assess the VEX positioning. VEX creates predictable dealer hedge flows that are directional even on an inline data print." },
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
                  <ul className="space-y-3 text-secondary text-sm leading-relaxed">
                    {["Check Heat Maps pre-market every session — structural levels are recalculated overnight.", "Use the Gamma Flip as your primary regime indicator before selecting a directional bias.", "Cross-reference GEX walls with the SPX Slayer desk — when a wall appears in both surfaces simultaneously, it carries higher conviction.", "Apply CHARM analysis specifically in the 48 hours before major expiries.", "Scale position sizing with regime: smaller positions in negative GEX."].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-cyan-400 mt-0.5 shrink-0">+</span><span>{item}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="border border-sky-900/40 rounded-xl bg-sky-950/10 p-6">
                  <p className="text-sky-300 font-bold font-mono text-sm uppercase tracking-wider mb-4">Don&apos;t</p>
                  <ul className="space-y-3 text-secondary text-sm leading-relaxed">
                    {["Don't treat GEX walls as absolute price targets — they are zones of mechanical behavior.", "Don't use Heat Maps in isolation. Combine with HELIX flow tape and SPX Slayer.", "Don't ignore the GEX Shift on days following large events.", "Don't fade momentum when price is trending through negative GEX territory.", "Don't confuse SPX and SPY levels. SPX GEX strikes are approximately 10x SPY equivalents."].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-sky-300 mt-0.5 shrink-0">–</span><span>{item}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section id="cross-references">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Cross-References</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { href: "/learn/spx-slayer", name: "SPX Slayer", rel: "The flagship desk displays the same Call Wall, Put Wall, and King Node derived from Heat Maps. When both surfaces agree on a level, treat it as high-conviction structure." },
                  { href: "/learn/night-hawk", name: "Night Hawk", rel: "The evening SPX play scanner uses GEX walls from Heat Maps to calibrate overnight position targets. The GEX levels in every Night Hawk edition are sourced live from this tool." },
                  { href: "/learn/largo-ai", name: "Largo AI Terminal", rel: "Largo's get_spx_structure tool call draws directly from Heat Maps data when assessing structural support and resistance." },
                  { href: "/learn/helix-flows", name: "HELIX Options Flow", rel: "Combine HELIX institutional flow prints with GEX structure: a large call sweep at the Call Wall in positive GEX signals a breakout attempt." },
                  { href: "/learn/nights-watch", name: "Night's Watch", rel: "Use GEX walls from Heat Maps to set alert levels and monitor when price approaches structurally significant strikes in your position range." },
                  { href: "/learn/blackout-grid", name: "BlackOut Grid", rel: "The market intelligence dashboard surfaces GEX regime context alongside news, analyst updates, and macro catalysts." },
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
              <div className="space-y-8">
                {[
                  {
                    cat: "Greek Exposures",
                    terms: [
                      { term: "CHARM", def: "The second-order Greek measuring how delta changes with time (dDelta/dTime). CHARM-driven delta decay forces dealers to unwind hedges near expiry." },
                      { term: "DEX — Delta Exposure", def: "The aggregate delta position held by dealer market makers across all outstanding SPX options, expressed as an equivalent share count." },
                      { term: "GEX — Gamma Exposure", def: "Net gamma across all dealer positions at a given strike. Positive GEX = stabilizing hedging. Negative GEX = amplifying hedging." },
                      { term: "VEX — Vanna Exposure", def: "The sensitivity of dealer delta to changes in implied volatility (dDelta/dIV). Particularly important around scheduled macro events." },
                    ],
                  },
                  {
                    cat: "Structural Levels",
                    terms: [
                      { term: "Call Wall", def: "The highest positive GEX strike above current SPX spot price. The primary mechanical resistance level for the session." },
                      { term: "Gamma Flip", def: "The strike level where net aggregate GEX crosses from positive to negative. The single most important regime indicator." },
                      { term: "King Node", def: "The dominant GEX strike of the day — the level with the greatest total gamma magnitude. Price exhibits the strongest magnetic attraction toward the King Node." },
                      { term: "Put Wall", def: "The highest positive GEX strike below current SPX spot price. The primary mechanical support level." },
                    ],
                  },
                ].map((group) => (
                  <div key={group.cat}>
                    <p className="text-sky-300 font-mono text-xs uppercase tracking-widest mb-4">{group.cat}</p>
                    <div className="space-y-3">
                      {group.terms.map((g) => (
                        <div key={g.term} className="border-l-2 border-cyan-900/50 pl-4">
                          <p className="text-cyan-400 font-mono text-sm font-semibold mb-1">{g.term}</p>
                          <p className="text-secondary text-sm leading-relaxed">{g.def}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="faq">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">FAQ</h2>
              <div className="space-y-6">
                {[
                  { q: "How often does the GEX data update?", a: "GEX positioning updates continuously during regular trading hours as the options chain refreshes. Pre-market and post-market, the data reflects the prior session's close. The GEX Shift view is computed fresh each morning." },
                  { q: "The Call Wall and Put Wall sometimes appear very close together — what does that mean?", a: "A compressed range indicates high gamma density in a narrow strike band. This is the most forceful pinning environment — the market has strong mechanical incentive to remain in a tight range." },
                  { q: "How does Heat Maps relate to what Largo AI returns about market structure?", a: "Largo's get_spx_structure function queries the same underlying GEX data powering Heat Maps. You can use Heat Maps to visually verify what Largo reports numerically." },
                ].map((item, i) => (
                  <div key={i} className="border border-cyan-900/25 rounded-xl bg-white/[0.015] p-6">
                    <p className="text-white font-semibold mb-3 leading-snug">{item.q}</p>
                    <p className="text-secondary text-sm leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="border-t border-cyan-900/30 pt-8 flex flex-col sm:flex-row gap-4 justify-between">
              <Link href="/learn/spx-slayer" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">&larr; SPX Slayer</Link>
              <Link href="/learn/helix-flows" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">HELIX Options Flow &rarr;</Link>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
