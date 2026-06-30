export const dynamic = "force-static";

import Link from "next/link";
import type { Metadata } from "next";
import { LearnDoc } from "@/components/learn/LearnDoc";

export const metadata: Metadata = {
  title: "Largo AI Terminal | BlackOut Trading",
  description:
    "Largo is BlackOut'\''s AI-powered market analysis terminal. Ask structured market questions, get grounded answers using live GEX, flow, and positioning data.",
};

const sections = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "key-capabilities", label: "Key Capabilities" },
  { id: "usage", label: "Step-by-Step Usage" },
  { id: "dos-donts", label: "Dos & Don'\''ts" },
  { id: "cross-references", label: "Cross-References" },
  { id: "faq", label: "FAQ" },
  { id: "glossary", label: "Glossary" },
];

export default function Page() {
  return (
    <LearnDoc
      title="Largo AI Terminal"
      description="Our AI engine wired to live BlackOut data. Ask hard questions about current dealer positioning, flow context, and structural market mechanics."
      sections={sections}
    >


            <section id="overview">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">Overview</h2>
              <div className="space-y-4 text-secondary leading-relaxed">
                <p>
                  Largo is BlackOut&apos;s AI analysis terminal, powered by our AI engine. It is not a chatbot. It is a market analyst with live read access to the platform&apos;s core data — GEX structure, flow tape, dealer positioning, and open positions.
                </p>
                <p>
                  The key distinction from a general AI assistant: Largo does not rely on training data to answer market questions. When you ask about current SPX dealer positioning, Largo calls the live GEX API. When you ask about recent flow, it queries the flow database.
                </p>
                <p>
                  Largo is designed for traders who know what questions to ask. It will not tell you what to trade. It will tell you what the current data shows, what it implies, and what structural factors bear on your decision.
                </p>
              </div>
              <div className="mt-6 p-4 rounded-lg border border-amber-400/20 bg-amber-400/5">
                <p className="text-amber-400 text-sm font-semibold mb-1">When not to use Largo</p>
                <p className="text-secondary text-sm leading-relaxed">
                  Do not query Largo for live price quotes. Use SPX Slayer for current price, bid/ask, and option marks. Largo interprets data — it does not stream it.
                </p>
              </div>
            </section>

            <section id="how-it-works">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">How It Works</h2>
              <p className="text-secondary leading-relaxed mb-6">
                Largo operates through a tool-calling architecture. When you submit a query, Largo evaluates which live data it needs and executes the appropriate tool calls before composing a response.
              </p>
              <div className="space-y-4">
                {[
                  { tool: "get_spx_structure", desc: "Fetches live GEX walls, gamma flip, king node, call wall, put wall, and regime assessment from the current SPX options chain computation." },
                  { tool: "get_market_context", desc: "Retrieves VWAP, moving averages, IV percentile, and the SPX Slayer play engine current verdict state." },
                  { tool: "get_flow_context", desc: "Queries recent HELIX flow tape for sweep clusters, net flow bias, and notable prints in the specified time window." },
                  { tool: "get_my_positions", desc: "Reads your open positions from Night'\''s Watch, including current marks, Greeks, and the active verdict for each leg." },
                  { tool: "add_position", desc: "Allows you to log a new position to Night'\''s Watch via natural language in the Largo interface." },
                ].map((t) => (
                  <div key={t.tool} className="flex gap-4 p-4 rounded-lg border border-white/10 bg-white/[0.02]">
                    <code className="text-cyan-400 text-sm font-mono shrink-0 mt-0.5">{t.tool}</code>
                    <p className="text-secondary text-sm leading-relaxed">{t.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="key-capabilities">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">Key Capabilities</h2>
              <div className="grid sm:grid-cols-2 gap-5">
                {[
                  { title: "Live GEX Structure Analysis", body: "Ask Largo to describe current dealer positioning — call walls, put walls, gamma flip, and regime character. It retrieves and interprets live GEX data, not training-time knowledge." },
                  { title: "Flow Context Synthesis", body: "Request a summary of recent institutional flow. Largo reads the HELIX tape and synthesizes sweep clusters, directional bias, and notable prints into a structured narrative." },
                  { title: "Position Management", body: "Ask what to do with your positions. Largo reads your Night'\''s Watch ledger, evaluates each leg against current conditions, and provides structured Hold/Trim/Sell reasoning." },
                  { title: "Natural Language Position Entry", body: "Describe a trade in plain English and Largo parses the contract details and logs the position directly to Night'\''s Watch." },
                  { title: "Thesis Stress-Testing", body: "Describe a directional thesis and ask Largo to challenge it. It surfaces structural factors from live GEX and flow data that support or undermine the trade." },
                  { title: "Contextual Options Education", body: "Ask Largo to explain why a GEX wall behaves a certain way. Explanations are grounded in current data, not abstract examples." },
                ].map(({ title, body }) => (
                  <div key={title} className="p-5 rounded-lg border border-white/10 bg-white/[0.02]">
                    <h3 className="text-white font-semibold mb-2">{title}</h3>
                    <p className="text-secondary text-sm leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="usage">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">Step-by-Step Usage</h2>
              <ol className="space-y-6">
                {[
                  { n: "1", title: "Open Largo from the navigation", body: "Access Largo via the main nav. The terminal loads your session history and current position context automatically." },
                  { n: "2", title: "Start with a structural query", body: "Begin each session by asking Largo to describe the current GEX regime. This anchors your analysis to live dealer positioning before you evaluate any trade idea." },
                  { n: "3", title: "Ask about flow context", body: "Follow with a flow question to get both the structural layer and the flow layer before making any decision." },
                  { n: "4", title: "Describe your thesis and ask for stress-testing", body: "If you have a directional bias from Night Hawk or SPX Slayer, ask Largo what structural factors would invalidate it." },
                  { n: "5", title: "Use natural language for position entry", body: "After executing a trade, log it in Largo: 'Add 5 SPX 5500 calls expiring today at $2.40.' Largo will add the position to Night'\''s Watch." },
                  { n: "6", title: "Query your positions before major moves", body: "When price approaches a key GEX level with open positions, ask Largo for a structured verdict against current market structure." },
                ].map((item) => (
                  <li key={item.n} className="flex gap-4">
                    <div className="flex-none w-8 h-8 rounded-full bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center">
                      <span className="text-cyan-400 text-sm font-bold">{item.n}</span>
                    </div>
                    <div>
                      <p className="text-white font-semibold mb-1">{item.title}</p>
                      <p className="text-secondary text-sm leading-relaxed">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="dos-donts">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">Dos &amp; Don&apos;ts</h2>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="bg-emerald-900/10 border border-emerald-500/20 rounded-lg p-5">
                  <p className="text-emerald-400 font-semibold mb-4 uppercase text-xs tracking-widest">Do</p>
                  <ul className="space-y-3">
                    {["Ask Largo to challenge your thesis, not confirm it.", "Use natural language for position logging.", "Ask about data freshness when making time-sensitive decisions.", "Use Largo'\''s GEX analysis alongside Thermal for visual context.", "Bring unusual flow patterns from HELIX to Largo for interpretation."].map((t, i) => (
                      <li key={i} className="flex gap-2 text-secondary text-sm"><span className="text-emerald-400 shrink-0">+</span>{t}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-red-900/10 border border-red-500/20 rounded-lg p-5">
                  <p className="text-red-400 font-semibold mb-4 uppercase text-xs tracking-widest">Don&apos;t</p>
                  <ul className="space-y-3">
                    {["Do not ask Largo for real-time price quotes.", "Do not treat a HOLD verdict as permission to add size.", "Do not over-query during rapidly moving markets.", "Do not expect Largo to hallucinate data it does not have.", "Do not use Largo as a replacement for your own judgment."].map((t, i) => (
                      <li key={i} className="flex gap-2 text-secondary text-sm"><span className="text-red-400 shrink-0">-</span>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section id="cross-references">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">Cross-References</h2>
              <div className="space-y-4">
                {[
                  { href: "/learn/heat-maps", name: "Thermal", desc: "Largo'\''s get_spx_structure tool queries the same GEX data that powers Thermal. Use Thermal for the visual surface; use Largo for the analytical interpretation." },
                  { href: "/learn/helix-flows", name: "HELIX Options Flow", desc: "Largo'\''s get_flow_context tool reads from the HELIX flow database. Bring unusual print patterns to Largo for structured synthesis." },
                  { href: "/learn/nights-watch", name: "Night'\''s Watch", desc: "Largo reads Night'\''s Watch positions and can add positions via natural language. Largo is the natural-language interface to position management." },
                  { href: "/learn/spx-slayer", name: "SPX Slayer", desc: "Largo reads SPX Slayer'\''s live desk data via get_market_context. Use SPX Slayer for live streaming; use Largo for analytical context." },
                  { href: "/learn/night-hawk", name: "Night Hawk", desc: "Largo can stress-test Night Hawk theses against live morning data before the open." },
                  { href: "/learn/blackout-grid", name: "BlackOut Grid", desc: "Paste a specific news headline into Largo and ask for impact analysis against current GEX and flow positioning." },
                ].map((ref) => (
                  <Link key={ref.href} href={ref.href} className="flex gap-4 p-5 rounded-lg border border-white/10 bg-white/[0.02] hover:border-cyan-400/20 transition-all group">
                    <div className="flex-1">
                      <p className="text-cyan-400 font-semibold mb-1 group-hover:text-white transition-colors">{ref.name}</p>
                      <p className="text-secondary text-sm leading-relaxed">{ref.desc}</p>
                    </div>
                    <span className="text-mute group-hover:text-cyan-400 transition-colors mt-1">&rarr;</span>
                  </Link>
                ))}
              </div>
            </section>

            <section id="faq">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">FAQ</h2>
              <div className="space-y-6">
                {[
                  { q: "Does Largo have access to my brokerage account?", a: "No. Largo reads positions from Night'\''s Watch only — a position manager you populate manually or through Largo'\''s natural language entry." },
                  { q: "How does Largo know the GEX data is current?", a: "Every tool call Largo makes returns a data timestamp. Largo includes this in its responses and will explicitly flag when data is older than expected." },
                  { q: "Why does Largo sometimes give different answers to the same question?", a: "Largo'\''s answers are grounded in live data that changes continuously. The same question at 10:00 am and 2:00 pm may produce different answers because the GEX structure and flow bias have changed." },
                ].map((item) => (
                  <div key={item.q} className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
                    <p className="text-white font-semibold mb-3">{item.q}</p>
                    <p className="text-secondary text-sm leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="glossary">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-white/10">Glossary</h2>
              <div className="space-y-3">
                {[
                  { term: "Tool Call", def: "A structured API request Largo makes to a live BlackOut data source when composing a response." },
                  { term: "Grounded Response", def: "A response derived from live data retrieved via tool calls, not from the model'\''s training knowledge." },
                  { term: "get_spx_structure", def: "Queries live GEX computation — call wall, put wall, gamma flip, king node, and regime assessment." },
                  { term: "get_my_positions", def: "Reads your Night'\''s Watch position ledger, including live marks and verdicts." },
                  { term: "add_position", def: "Logs a new position to Night'\''s Watch from a natural-language description." },
                ].map((t) => (
                  <div key={t.term} className="flex gap-4 bg-white/3 border border-white/8 rounded-lg p-3">
                    <code className="text-cyan-400 text-sm font-mono w-40 shrink-0">{t.term}</code>
                    <p className="text-secondary text-sm leading-relaxed">{t.def}</p>
                  </div>
                ))}
              </div>
            </section>
    </LearnDoc>
  );
}
