export const dynamic = "force-static";

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SPX Slayer â€” Real-Time SPX Options Desk | BlackOut Trading",
  description:
    "SPX Slayer is BlackOut's flagship real-time SPX options desk. Live GEX walls, gamma flip, VWAP, IV percentile, AI play engine, and dark pool activity â€” all in one institutional-grade terminal.",
};

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "key-metrics", label: "Key Metrics & Features" },
  { id: "usage", label: "Step-by-Step Usage" },
  { id: "dos-donts", label: "Dos & Don'ts" },
  { id: "cross-references", label: "Cross-References" },
  { id: "faq", label: "FAQ" },
  { id: "glossary", label: "Glossary" },
];

export default function SpxSlayerPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: "#040407" }}>
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-10 md:px-12">
        <p className="text-xs uppercase tracking-widest text-cyan-400 mb-2">
          BlackOut Platform â€” Learn
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
          SPX Slayer
        </h1>
        <p className="mt-3 text-lg text-sky-300 max-w-2xl">
          The flagship real-time SPX options desk. Dealer positioning, AI play
          verdicts, live flow, and 0DTE execution â€” integrated into a single
          institutional terminal.
        </p>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-col md:flex-row gap-0">
        {/* Sticky Sidebar */}
        <aside className="hidden md:block md:w-64 shrink-0 border-r border-white/10">
          <nav className="sticky top-8 px-6 py-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              On This Page
            </p>
            <ul className="space-y-2">
              {TOC.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="block text-sm text-slate-300 hover:text-cyan-400 transition-colors py-0.5"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 px-6 md:px-12 py-10 max-w-4xl space-y-16">

          {/* OVERVIEW */}
          <section id="overview">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              Overview
            </h2>
            <p className="text-slate-300 leading-relaxed mb-4">
              SPX Slayer is BlackOut&apos;s primary real-time trading desk, purpose-built for
              same-day (0DTE) SPX options. It consolidates the inputs that matter most for
              intraday index options â€” dealer gamma exposure, price structure, volatility
              regime, and institutional order flow â€” into a single, unified view that
              updates continuously during Regular Trading Hours (RTH).
            </p>
            <p className="text-slate-300 leading-relaxed mb-4">
              Rather than presenting raw data and leaving interpretation to the trader, SPX
              Slayer runs a structured play engine every 30 seconds. The engine evaluates
              multiple entry conditions in sequence and, when all gates pass, surfaces a
              vetted trade idea complete with entry, target, and stop. Only actionable
              setups reach the active play card â€” noise is filtered at the engine layer.
            </p>
            <p className="text-slate-300 leading-relaxed">
              SPX options are cash-settled and European-style. AM-settled contracts expire
              at 9:30 am ET; PM-settled contracts expire at 4:00 pm ET. The desk is
              calibrated for PM-settled 0DTE, the highest-liquidity instrument available
              intraday.
            </p>
          </section>

          {/* HOW IT WORKS */}
          <section id="how-it-works">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              How It Works
            </h2>

            <h3 className="text-lg font-semibold text-cyan-400 mt-6 mb-2">
              Data Sources
            </h3>
            <p className="text-slate-300 leading-relaxed mb-4">
              GEX walls and the gamma flip level are computed from the live SPX options
              chain sourced from our market data engine. The chain is re-fetched every engine
              cycle, so wall levels reflect the current open-interest and gamma distribution
              rather than a static snapshot. VWAP and price data are sourced from the
              same live feed. Options flow context is pulled from our flow intelligence engine and
              surfaces within the desk as a directional bias signal.
            </p>

            <h3 className="text-lg font-semibold text-cyan-400 mt-6 mb-2">
              Play Engine â€” Sequential Gate Logic
            </h3>
            <p className="text-slate-300 leading-relaxed mb-2">
              The play engine runs on a 30-second heartbeat during RTH. It evaluates four
              gates in order; a failure at any gate stops evaluation and the desk remains
              in SCANNING state.
            </p>
            <ol className="list-decimal list-inside space-y-3 text-slate-300 ml-2">
              <li>
                <span className="text-white font-medium">Entry Gates</span> â€” GEX regime
                check (is price near a significant wall?), VWAP position (above for calls,
                below for puts), moving average alignment (5/9/21 EMA stack direction),
                flow bias (institutional flow confirms directional lean), and minimum risk-to-reward
                ratio.
              </li>
              <li>
                <span className="text-white font-medium">AI Verdict</span> â€” The
                full live context is submitted to our AI engine, which returns APPROVE_BUY,
                APPROVE_SELL, or SCANNING. A veto at this stage overrides all passing entry
                gates; the desk stays in SCANNING until the next cycle.
              </li>
              <li>
                <span className="text-white font-medium">Option Ticket Builder</span> â€”
                When approved, the engine fetches the live 0DTE SPX chain and selects the
                optimal strike and expiry based on delta, liquidity, and bid/ask spread.
                No static strike hardcoding.
              </li>
              <li>
                <span className="text-white font-medium">Play Open</span> â€” All four gates
                passed. The active play card appears with entry price, target, stop, and
                live P&L tracking.
              </li>
            </ol>

            <h3 className="text-lg font-semibold text-cyan-400 mt-6 mb-2">
              Verdict States
            </h3>
            <div className="rounded-lg border border-white/10 overflow-hidden mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="text-left px-4 py-2 text-cyan-400 font-semibold">Verdict</th>
                    <th className="text-left px-4 py-2 text-cyan-400 font-semibold">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-white/10">
                    <td className="px-4 py-2 text-green-400 font-mono">APPROVE_BUY</td>
                    <td className="px-4 py-2 text-slate-300">All gates pass, bullish setup confirmed â€” call play opened.</td>
                  </tr>
                  <tr className="border-b border-white/10">
                    <td className="px-4 py-2 text-red-400 font-mono">APPROVE_SELL</td>
                    <td className="px-4 py-2 text-slate-300">All gates pass, bearish setup confirmed â€” put play opened.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 text-sky-300 font-mono">SCANNING</td>
                    <td className="px-4 py-2 text-slate-300">One or more gates failed. Engine continues monitoring; no play is open.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* KEY METRICS */}
          <section id="key-metrics">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              Key Metrics & Features
            </h2>

            <div className="space-y-6">
              {[
                {
                  title: "Live SPX Price â€” Bid / Ask",
                  body: "Real-time index quote with bid and ask. The spread context matters for 0DTE sizing â€” wide markets at open or near expiry compress option value faster than the underlying move.",
                },
                {
                  title: "GEX Walls â€” Call Wall & Put Wall",
                  body: "Gamma Exposure walls derived from the live options chain. The call wall is the strike with the largest positive gamma concentration â€” dealers become long gamma above it, which suppresses volatility (resistance). The put wall is the strike with the largest negative gamma concentration â€” dealers are short gamma below it, which amplifies moves (support, but fragile). These levels reprice each engine cycle as open interest shifts.",
                },
                {
                  title: "Gamma Flip Level",
                  body: "The price at which aggregate dealer gamma crosses zero. Above the flip, dealer hedging is stabilizing (buy dips, sell rips). Below the flip, dealer hedging is destabilizing (sell dips, buy rips), producing accelerated directional moves. Knowing which side of the flip price is trading on is foundational to 0DTE directional bias.",
                },
                {
                  title: "VWAP",
                  body: "Volume-Weighted Average Price anchored to the RTH open. The desk tracks whether SPX is above or below VWAP in real time. VWAP acts as the intraday institutional reference; a confirmed hold above VWAP strengthens bull setups, and a confirmed break below strengthens bear setups.",
                },
                {
                  title: "Moving Averages",
                  body: "The desk monitors two timeframe stacks simultaneously: Intraday 5, 9, and 21 EMA for momentum confirmation, and Daily 50 SMA and 200 SMA for macro context.",
                },
                {
                  title: "IV Percentile",
                  body: "IV Percentile measures where current implied volatility sits relative to its one-year range expressed as a percentile rank. High IVP means options are expensive relative to history; low IVP means they are cheap. This is distinct from IV Rank â€” the desk displays IVP.",
                },
                {
                  title: "King Node",
                  body: "The single strike with the highest absolute GEX concentration for the session. The King Node acts as a gravitational center â€” price frequently oscillates around it during low-volatility periods, and a decisive break of the King Node often precedes accelerated directional moves.",
                },
                {
                  title: "Active Play Card",
                  body: "Appears when the engine opens a play. Displays: direction (call/put), entry price, target price, stop level, current option mark, and live unrealized P&L updated each engine cycle.",
                },
                {
                  title: "Dark Pool Activity Card",
                  body: "Surfaces notable dark pool (off-exchange) print activity in SPX/SPY. Large dark pool sweeps at key GEX levels can confirm institutional conviction in a direction.",
                },
              ].map((m) => (
                <div key={m.title}>
                  <h3 className="text-base font-semibold text-cyan-400 mb-1">{m.title}</h3>
                  <p className="text-slate-300 text-sm leading-relaxed">{m.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* STEP-BY-STEP USAGE */}
          <section id="usage">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              Step-by-Step Usage
            </h2>

            <ol className="space-y-6 text-slate-300">
              {[
                {
                  n: "1",
                  title: "Pre-market: check Night Hawk",
                  body: "Review the prior evening's Night Hawk playbook for key GEX levels, overnight bias, and any flagged catalyst. SPX Slayer updates live at open, but having the pre-market framework reduces cognitive load during the first 30 minutes.",
                },
                {
                  n: "2",
                  title: "At RTH open: orient on the GEX structure",
                  body: "Identify the call wall, put wall, gamma flip, and King Node immediately. These four levels define the day's structural trading range.",
                },
                {
                  n: "3",
                  title: "Monitor VWAP position and EMA stack",
                  body: "During the first 15â€“30 minutes, let price establish its VWAP relationship. A strong open that holds VWAP with a bullish EMA stack is the setup the engine will lean into.",
                },
                {
                  n: "4",
                  title: "Watch for a verdict change from SCANNING",
                  body: "The engine will display SCANNING until all conditions align. When it transitions to APPROVE_BUY or APPROVE_SELL, review the active play card before entering.",
                },
                {
                  n: "5",
                  title: "Execute and track against the play card",
                  body: "Use Night's Watch to log your position for live P&L and exit tracking. Honor the stop level on the play card â€” the engine sized R:R at gate evaluation; widening the stop post-entry negates that calculation.",
                },
                {
                  n: "6",
                  title: "Cross-reference HELIX for flow confirmation",
                  body: "While in a play, monitor HELIX for large SPX/SPY flow prints that contradict or confirm your direction. Significant counter-flow from institutions is a valid reason to exit early.",
                },
              ].map((item) => (
                <li key={item.n} className="flex gap-4">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-bold flex items-center justify-center mt-0.5">{item.n}</span>
                  <div>
                    <p className="text-white font-medium mb-1">{item.title}</p>
                    <p className="text-sm leading-relaxed">{item.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* DOS AND DONTS */}
          <section id="dos-donts">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              Dos & Don&apos;ts
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-5">
                <p className="text-green-400 font-semibold text-sm uppercase tracking-wider mb-3">Do</p>
                <ul className="space-y-2 text-sm text-slate-300">
                  {[
                    "Wait for all engine gates to pass before treating a setup as valid.",
                    "Use the gamma flip level as your primary regime indicator â€” it changes how you interpret all other signals.",
                    "Combine GEX walls with Heat Maps for deeper dealer positioning context.",
                    "Check Night Hawk's playbook pre-market for overnight context.",
                    "Honor published stop levels. The engine's R:R calculation is invalidated when stops are moved.",
                    "Reduce sizing in high IVP environments â€” options are expensive.",
                  ].map((item) => (
                    <li key={item} className="flex gap-2"><span className="text-green-400 mt-0.5">+</span> {item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-5">
                <p className="text-red-400 font-semibold text-sm uppercase tracking-wider mb-3">Don&apos;t</p>
                <ul className="space-y-2 text-sm text-slate-300">
                  {[
                    "Trade against a SCANNING state by guessing what the engine will do next.",
                    "Confuse IV Rank with IV Percentile â€” the desk displays IVP, not IVR.",
                    "Treat dark pool prints as directional signals in isolation.",
                    "Over-size 0DTE positions. Gamma decay accelerates non-linearly through the afternoon.",
                    "Ignore the AM/PM settlement distinction for SPX options.",
                    "Assume GEX walls are static. They reprice every cycle.",
                  ].map((item) => (
                    <li key={item} className="flex gap-2"><span className="text-red-400 mt-0.5">-</span> {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* CROSS-REFERENCES */}
          <section id="cross-references">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              Cross-References to Other Tools
            </h2>

            <div className="space-y-4">
              {[
                { href: "/learn/heat-maps", name: "Heat Maps", desc: "SPX Slayer surfaces scalar GEX wall values. Heat Maps renders the full gamma exposure surface across all strikes and expirations." },
                { href: "/learn/helix-flows", name: "HELIX Options Flow", desc: "The flow bias fed into SPX Slayer's engine is a compressed signal. HELIX exposes the full institutional tape." },
                { href: "/learn/night-hawk", name: "Night Hawk", desc: "Night Hawk identifies next-day SPX setups based on end-of-day GEX. Those levels are the pre-market context that SPX Slayer operates within." },
                { href: "/learn/largo-ai", name: "Largo AI Terminal", desc: "Largo has full read access to SPX Slayer's live data â€” GEX levels, verdict state, active play, IV percentile." },
                { href: "/learn/nights-watch", name: "Night's Watch", desc: "Once you enter a play surfaced by SPX Slayer, log it in Night's Watch for live P&L tracking and exit management." },
                { href: "/learn/blackout-grid", name: "BlackOut Grid", desc: "Monitor macro catalysts in the BlackOut Grid. High-impact catalysts increase volatility risk for 0DTE positions." },
              ].map((ref) => (
                <div key={ref.href} className="rounded-lg border border-white/10 bg-white/5 p-5">
                  <Link href={ref.href} className="text-cyan-400 font-semibold hover:text-sky-300 transition-colors">
                    {ref.name}
                  </Link>
                  <p className="text-slate-300 text-sm mt-1 leading-relaxed">{ref.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section id="faq">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              FAQ
            </h2>

            <div className="space-y-6">
              {[
                {
                  q: "Why does the engine stay in SCANNING even when price is trending strongly?",
                  a: "A strong directional move is necessary but not sufficient. The engine requires all gates to pass concurrently: GEX regime, VWAP position, EMA stack alignment, flow confirmation, and AI approval. A trending move that is already well extended from VWAP, or that has poor R:R given current GEX walls, will fail one or more gates.",
                },
                {
                  q: "How are GEX wall levels different from traditional support and resistance?",
                  a: "Traditional S/R is historical price memory. GEX walls are derived from current options open interest and the gamma exposure of market makers who must hedge them. GEX walls are forward-looking and mechanistic â€” they represent strike prices where dealer hedging behavior creates real order flow.",
                },
                {
                  q: "What is the difference between IV Percentile and IV Rank?",
                  a: "IV Rank = (current IV - 52-week low) / (52-week high - 52-week low). It can be distorted by a single volatility spike. IV Percentile counts the percentage of days in the look-back where IV was lower than today â€” a frequency measure that is more stable across regimes. SPX Slayer displays IVP.",
                },
                {
                  q: "Can I use SPX Slayer for multi-day or swing trades?",
                  a: "The desk is calibrated for 0DTE intraday plays. The GEX walls, gamma flip, VWAP, and intraday EMA stack are all intraday constructs that reset each session. For swing setups, Night Hawk's evening scanner and Largo's analytical capabilities are more appropriate starting points.",
                },
              ].map((item) => (
                <div key={item.q}>
                  <p className="text-white font-semibold mb-2">{item.q}</p>
                  <p className="text-slate-300 text-sm leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* GLOSSARY */}
          <section id="glossary">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">
              Glossary
            </h2>

            <div className="space-y-8">
              {[
                {
                  cat: "Dealer Positioning & GEX",
                  terms: [
                    { term: "Call Wall", def: "The strike with the highest concentration of positive dealer gamma. Dealers long gamma above this strike sell into rallies, creating mechanical resistance." },
                    { term: "Put Wall", def: "The strike with the highest concentration of negative dealer gamma. Dealers short gamma below this level buy into declines, creating a floor â€” but one that breaks sharply if gamma exposure rolls off." },
                    { term: "Gamma Flip", def: "The price level where aggregate dealer gamma changes sign. Above the flip: stabilizing hedging. Below the flip: destabilizing hedging, amplifying moves." },
                    { term: "GEX (Gamma Exposure)", def: "The dollar value of SPX move per 1% change in the underlying that market makers must hedge across all open option positions." },
                    { term: "King Node", def: "The single strike with the highest absolute GEX for the session. Acts as a gravitational reference point for intraday price action." },
                  ],
                },
                {
                  cat: "Play Engine",
                  terms: [
                    { term: "APPROVE_BUY", def: "Engine verdict indicating all bullish entry gates have passed. A call play is opened." },
                    { term: "APPROVE_SELL", def: "Engine verdict indicating all bearish entry gates have passed. A put play is opened." },
                    { term: "SCANNING", def: "Default engine state. One or more entry gates have not passed. No play is open." },
                    { term: "R:R Ratio", def: "The ratio of potential profit (distance to target) vs. potential loss (distance to stop). The play engine enforces a minimum R:R threshold as one of the entry gates." },
                  ],
                },
                {
                  cat: "SPX Options Structure",
                  terms: [
                    { term: "0DTE", def: "Zero days to expiration. SPX offers 0DTE expirations every weekday. The play engine targets PM-settled 0DTE contracts." },
                    { term: "AM Settlement", def: "SPX contracts that stop trading at prior day's close and settle to the 9:30 am ET opening print. Not suitable for intraday 0DTE plays." },
                    { term: "PM Settlement", def: "SPX contracts settling to the 4:00 pm ET closing auction print. These trade throughout RTH and are the target instrument for SPX Slayer's play engine." },
                    { term: "Cash Settlement", def: "SPX options settle to cash, not shares. The payout is the difference between the settlement price and the strike." },
                  ],
                },
              ].map((group) => (
                <div key={group.cat}>
                  <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-3">{group.cat}</p>
                  <dl className="space-y-3 text-sm">
                    {group.terms.map((t) => (
                      <div key={t.term}>
                        <dt className="text-white font-medium">{t.term}</dt>
                        <dd className="text-slate-300 ml-4 leading-relaxed">{t.def}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
