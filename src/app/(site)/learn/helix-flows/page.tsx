import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HELIX Options Flow | BlackOut Trading",
  description:
    "Real-time institutional options flow tape. Learn how HELIX filters, reads, and acts on large-premium prints, sweeps, dark pool activity, and net flow bias.",
};

const sections = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "key-features", label: "Key Features" },
  { id: "usage", label: "Step-by-Step Usage" },
  { id: "dos-donts", label: "Dos & Don'ts" },
  { id: "cross-references", label: "Cross-References" },
  { id: "glossary", label: "Glossary" },
  { id: "faq", label: "FAQ" },
];

export default function HelixFlowsPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#040407" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <p className="text-cyan-400 text-sm font-mono tracking-widest uppercase mb-3">
            BlackOut Learn — Tool Documentation
          </p>
          <h1 className="text-4xl font-bold text-white mb-4 tracking-tight">
            HELIX Options Flow
          </h1>
          <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">
            Real-time institutional options flow tape. Filter noise. Read conviction. Act with precision.
          </p>
          <div className="mt-6 flex items-center gap-4 flex-wrap">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-semibold bg-cyan-400/10 text-cyan-400 border border-cyan-400/20">LIVE FEED</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-semibold bg-sky-400/10 text-sky-300 border border-sky-400/20">SSE REAL-TIME</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-semibold bg-white/5 text-slate-300 border border-white/10">INSTITUTIONAL FLOW</span>
          </div>
        </div>

        <div className="flex gap-12 items-start">
          {/* Sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0 sticky top-8">
            <p className="text-xs font-mono text-cyan-400 uppercase tracking-widest mb-4">On This Page</p>
            <nav className="space-y-1">
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="block text-sm text-slate-300 hover:text-white py-1.5 px-3 rounded hover:bg-white/5 transition-colors border-l border-transparent hover:border-cyan-400/50">
                  {s.label}
                </a>
              ))}
            </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 space-y-16">

            <section id="overview">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">Overview</h2>
              <p className="text-slate-300 leading-relaxed mb-4">
                HELIX is BlackOut&apos;s live institutional options flow tape. Every print that crosses the tape above the configured premium threshold is delivered to your session in real time via server-sent events — no polling, no stale data. The feed is purpose-built to surface what institutional participants are doing, not what retail is speculating on.
              </p>
              <p className="text-slate-300 leading-relaxed mb-4">
                Raw options tape is noise. HELIX applies premium and structural filters to reduce that stream to the prints that carry institutional weight: large-dollar sweeps, coordinated multi-exchange fills, dark pool blocks, and concentrated strike stacks.
              </p>
              <p className="text-slate-300 leading-relaxed">
                HELIX does not generate signals. It shows you what the market&apos;s largest participants are doing so you can build context, confirm bias, and size positions with the weight of institutional order flow behind you.
              </p>
              <div className="mt-6 p-4 rounded-lg border border-cyan-400/20 bg-cyan-400/5">
                <p className="text-cyan-400 text-sm font-semibold mb-1">When to use HELIX</p>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Use HELIX before entering any SPX or high-conviction single-name trade. Confirm that institutional flow is aligned with your directional thesis before sizing up. Do not trade flow prints in isolation — always cross-reference with GEX levels in SPX Slayer.
                </p>
              </div>
            </section>

            <section id="how-it-works">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">How It Works</h2>
              <div className="space-y-6">
                {[
                  { step: "01", title: "Ingestion & Normalization", body: "Raw options tape is ingested from the options exchange feed. Each print is normalized to a canonical structure: ticker, strike, expiry, side, size, price, exchange, and timestamp." },
                  { step: "02", title: "Premium Filtering", body: "Prints below the configured premium floor are dropped before they ever reach the tape. The default threshold removes the vast majority of retail-sized orders." },
                  { step: "03", title: "Structural Classification", body: "Each print is evaluated for sweep characteristics (simultaneous exchange fills), dark pool routing, 0DTE flag, and fill price relative to the bid-ask midpoint." },
                  { step: "04", title: "Sentiment Assignment", body: "Sentiment (BULLISH / BEARISH / NEUTRAL) is derived from the combination of side, fill-price aggressiveness, and any linked multi-leg context." },
                  { step: "05", title: "Broadcast via SSE", body: "Qualifying prints are pushed to all connected HELIX sessions. Your tape updates in real time without a page refresh." },
                  { step: "06", title: "Strike Stack Aggregation", body: "As prints arrive, HELIX aggregates premium at each strike. The strike stack panel shows a ranked view of where cumulative institutional money is concentrated." },
                ].map(({ step, title, body }) => (
                  <div key={step} className="flex gap-5">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center">
                      <span className="text-cyan-400 text-xs font-mono font-bold">{step}</span>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold mb-1">{title}</h3>
                      <p className="text-slate-300 text-sm leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="key-features">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">Key Features</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {[
                  { title: "Live Flow Tape", body: "Every print above the premium threshold delivered via SSE as it occurs. Ticker, strike, expiry, side, size, premium, and timestamp visible at-a-glance." },
                  { title: "Sweep Indicator", body: "Prints that hit multiple exchanges simultaneously are flagged as sweeps. Sweep activity is the clearest structural signal of institutional urgency." },
                  { title: "0DTE Flags", body: "Same-day expiry contracts are highlighted distinctly. 0DTE flow demands immediate attention — these positions expire within hours." },
                  { title: "Strike Stacks", body: "Aggregated premium at each strike, ranked in real time. Identifies where the market's largest participants are concentrating positioning." },
                  { title: "Alert Premium Ticker", body: "A scrolling marquee surfaces the highest-premium single prints as they arrive." },
                  { title: "Net Flow Bias", body: "Session-level call vs. put premium ratio sourced from our flow intelligence engine. Provides the macro directional lean from institutional flow." },
                  { title: "Dark Pool Prints", body: "Off-exchange block trades reported to the tape. Shows large institutional positioning without the real-time price impact of lit-market execution." },
                  { title: "Advanced Filtering", body: "Filter the tape by minimum premium, specific ticker, call or put side, and sentiment classification." },
                ].map(({ title, body }) => (
                  <div key={title} className="p-5 rounded-lg border border-white/10 bg-white/[0.02] hover:border-cyan-400/20 transition-colors">
                    <h3 className="text-white font-semibold mb-2">{title}</h3>
                    <p className="text-slate-300 text-sm leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="usage">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">Step-by-Step Usage</h2>
              <div className="space-y-8">
                {[
                  { step: "1", title: "Open HELIX at market open", body: "Launch HELIX as part of your pre-market routine. The tape is most signal-rich in the first 90 minutes of the session when institutional order flow is heaviest." },
                  { step: "2", title: "Set your premium floor", body: "In the filter panel, configure the minimum premium threshold. For SPX context, a $500K+ floor surfaces meaningful institutional prints." },
                  { step: "3", title: "Monitor the sweep feed first", body: "Sweeps are the highest-conviction structural prints. Watch whether sweeps are clustering on calls or puts before reading individual large prints." },
                  { step: "4", title: "Cross-reference strikes with SPX Slayer", body: "For any print that appears significant, open SPX Slayer and locate the strike on the GEX wall chart. Prints at or beyond key GEX levels carry structural weight." },
                  { step: "5", title: "Review the strike stack panel", body: "Check the strike stack panel periodically for developing concentrations. A strike stack that builds over 30-60 minutes indicates sustained institutional positioning." },
                  { step: "6", title: "Read net flow bias directionally", body: "Use the net flow bias as a session-level directional lean. Bias above 60% calls suggests institutions are positioning for upside." },
                  { step: "7", title: "Escalate to Largo for complex prints", body: "If you observe a pattern of prints you cannot classify, bring the context to Largo AI Terminal for structured analysis." },
                  { step: "8", title: "Log positions in Night's Watch", body: "If you act on a flow print, immediately open the corresponding position in Night's Watch to track P&L against the thesis." },
                ].map(({ step, title, body }) => (
                  <div key={step} className="flex gap-5">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                      <span className="text-sky-300 text-sm font-bold font-mono">{step}</span>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold mb-2">{title}</h3>
                      <p className="text-slate-300 text-sm leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="dos-donts">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">Dos & Don&apos;ts</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 rounded-lg border border-green-500/20 bg-green-500/5">
                  <h3 className="text-white font-semibold mb-4">Do</h3>
                  <ul className="space-y-3">
                    {[
                      "Set a meaningful premium floor. Noise below your threshold obscures the signal above it.",
                      "Watch sweep clusters, not individual prints. Three bullish sweeps in 10 minutes outweigh one large isolated print.",
                      "Cross-reference every significant strike with SPX Slayer GEX walls before acting.",
                      "Track the direction of strike stacks over time — building stacks are more meaningful than single prints.",
                      "Log every flow-based trade in Night's Watch immediately after entry.",
                      "Treat 0DTE prints with urgency — they expire today.",
                    ].map((item) => (
                      <li key={item} className="text-slate-300 text-sm leading-relaxed flex gap-2">
                        <span className="text-green-400 mt-0.5 flex-shrink-0">+</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-5 rounded-lg border border-red-500/20 bg-red-500/5">
                  <h3 className="text-white font-semibold mb-4">Don&apos;t</h3>
                  <ul className="space-y-3">
                    {[
                      "Chase a single large print without context. Institutions hedge and institutions are wrong.",
                      "Treat a single bullish print as a buy signal. Confirm with bias, structure, and GEX.",
                      "Ignore the fill price context. A large put filled at the bid may be a closing print, not a new bearish bet.",
                      "Trade against a strong sweep cluster without a structural reason.",
                      "Use HELIX as your sole input. It is one layer of a multi-tool framework.",
                      "Lower your premium filter mid-session to chase action. Noise increases; signal does not.",
                    ].map((item) => (
                      <li key={item} className="text-slate-300 text-sm leading-relaxed flex gap-2">
                        <span className="text-red-400 mt-0.5 flex-shrink-0">-</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section id="cross-references">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">Cross-References</h2>
              <div className="space-y-4">
                {[
                  { href: "/learn/spx-slayer", title: "SPX Slayer", desc: "Overlay HELIX strike activity against live GEX walls to determine whether a large print sits at a dealer support or resistance level." },
                  { href: "/learn/heat-maps", title: "Heat Maps", desc: "Visualize where cumulative premium is concentrating across strikes. Strike stacks in HELIX align directly with GEX, VEX, and DEX concentration bands." },
                  { href: "/learn/largo-ai", title: "Largo AI Terminal", desc: "Paste a specific print or a sequence of sweeps into Largo for on-demand institutional intent analysis." },
                  { href: "/learn/nights-watch", title: "Night's Watch", desc: "After acting on a flow print, open a position in Night's Watch to track live P&L and manage the trade to expiry." },
                  { href: "/learn/night-hawk", title: "Night Hawk", desc: "Evening sweep clusters in HELIX often precede the setups Night Hawk surfaces the following session." },
                  { href: "/learn/blackout-grid", title: "BlackOut Grid", desc: "Cross-reference flow prints against the Grid's earnings calendar, analyst upgrades, and dark pool summary for catalyst-driven context." },
                ].map((r) => (
                  <Link key={r.href} href={r.href} className="flex gap-5 p-5 rounded-lg border border-white/10 bg-white/[0.02] hover:border-cyan-400/20 hover:bg-cyan-400/5 transition-all group">
                    <div className="flex-1">
                      <h3 className="text-cyan-400 font-semibold mb-1 group-hover:text-white transition-colors">{r.title}</h3>
                      <p className="text-slate-300 text-sm leading-relaxed">{r.desc}</p>
                    </div>
                    <div className="flex-shrink-0 text-slate-500 group-hover:text-cyan-400 transition-colors mt-1">&rarr;</div>
                  </Link>
                ))}
              </div>
            </section>

            <section id="glossary">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">Glossary</h2>
              <div className="space-y-10">
                {[
                  {
                    category: "Print Attributes",
                    terms: [
                      { term: "0DTE", def: "Zero days to expiry. A print with same-day expiration. Elevated gamma risk; highly directional or hedging in nature." },
                      { term: "Premium", def: "Total dollar value of a single print (price per contract × size × 100). The primary filter for institutional significance." },
                      { term: "Side", def: "Whether the print is a call (bullish directional or hedge) or a put (bearish directional or hedge)." },
                      { term: "Size", def: "Number of contracts in a single print. Large size at mid or ask price is the strongest signal of directional conviction." },
                      { term: "Strike", def: "The price level the contract conveys the right to buy (call) or sell (put). Strike placement relative to GEX walls is critical context." },
                    ],
                  },
                  {
                    category: "Signal Types",
                    terms: [
                      { term: "Dark Pool Print", def: "A block trade executed off-exchange and reported post-trade. Indicates large institutional positioning without real-time price impact." },
                      { term: "Net Flow Bias", def: "The aggregate call vs. put premium ratio across all prints in a session window. Indicates broad institutional directional lean." },
                      { term: "Sentiment", def: "BULLISH, BEARISH, or NEUTRAL classification derived from print side, fill price relative to mid, and multi-leg context." },
                      { term: "Strike Stack", def: "Aggregated premium concentrated at a single strike across multiple prints. A deep stack indicates institutional price-level conviction." },
                      { term: "Sweep", def: "A coordinated series of prints crossing multiple exchanges simultaneously. High-conviction institutional signal." },
                    ],
                  },
                ].map(({ category, terms }) => (
                  <div key={category}>
                    <h3 className="text-sky-300 text-sm font-mono font-semibold uppercase tracking-widest mb-4">{category}</h3>
                    <div className="space-y-4">
                      {terms.map(({ term, def }) => (
                        <div key={term} className="grid grid-cols-[160px_1fr] gap-4 py-3 border-b border-white/5 last:border-0">
                          <span className="text-white font-semibold text-sm">{term}</span>
                          <span className="text-slate-300 text-sm leading-relaxed">{def}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="faq">
              <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-white/10">Frequently Asked Questions</h2>
              <div className="space-y-8">
                {[
                  { q: "How delayed is the HELIX feed?", a: "HELIX delivers prints via server-sent events as they clear BlackOut's ingestion pipeline. In normal market conditions, prints appear within seconds of exchange execution." },
                  { q: "What does it mean when a large put sweep prints at the ask during a rally?", a: "A put sweep at the ask during an uptrend is typically a hedging print — an institution buying protection against a long equity book. Context matters: if SPX is near a GEX resistance wall and multiple put sweeps appear, the probability of a directional bet increases." },
                  { q: "What is the difference between a sweep and a block?", a: "A sweep executes across multiple exchanges simultaneously. A block is a single large print — often a dark pool print — that executes as one transaction. Sweeps signal urgency; blocks signal scale." },
                  { q: "Can I use HELIX for single-name stocks as well as SPX?", a: "Yes. HELIX displays flow across all tickers that produce prints above your configured premium threshold. You can filter the tape to a specific ticker using the ticker filter in the panel." },
                ].map(({ q, a }) => (
                  <div key={q} className="p-5 rounded-lg border border-white/10 bg-white/[0.02]">
                    <h3 className="text-white font-semibold mb-3">{q}</h3>
                    <p className="text-slate-300 text-sm leading-relaxed">{a}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="pt-8 border-t border-white/10 flex items-center justify-between">
              <Link href="/learn" className="text-sm text-slate-400 hover:text-cyan-400 transition-colors">&larr; Back to Learn</Link>
              <Link href="/learn/spx-slayer" className="text-sm text-slate-400 hover:text-cyan-400 transition-colors">Next: SPX Slayer &rarr;</Link>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
