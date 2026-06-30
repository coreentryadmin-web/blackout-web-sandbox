export const dynamic = "force-static";

import Link from "next/link";
import type { Metadata } from "next";
import { LearnDoc } from "@/components/learn/LearnDoc";

export const metadata: Metadata = {
  title: "BlackOut Grid — Market Intelligence Hub | BlackOut Trading",
  description:
    "Eight-panel market intelligence dashboard: news, options flow, earnings, catalysts, analyst activity, dark pool, congressional trades, and economic data — all in one structured feed.",
};

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "panels", label: "The 8 Panels" },
  { id: "data-sources", label: "Data Sources" },
  { id: "usage", label: "Step-by-Step Usage" },
  { id: "dos-donts", label: "Dos & Don'ts" },
  { id: "cross-references", label: "Cross-References" },
  { id: "faq", label: "FAQ" },
];

export default function Page() {
  return (
    <LearnDoc
      title="BlackOut Grid"
      description="Eight panels of structured market intelligence — news, flow, catalysts, dark pool, analyst revisions, congressional trades, and economic events — unified in a single continuous feed."
      sections={TOC}
    >


            <section id="overview">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Overview</h2>
              <div className="space-y-4 text-secondary leading-relaxed">
                <p>
                  BlackOut Grid is the platform&apos;s macro and catalyst intelligence layer. While SPX Slayer and HELIX focus on real-time structural and flow data, the Grid aggregates the information streams that affect the context in which those signals operate.
                </p>
                <p>
                  Eight independent panels each cover a distinct data source: live news, institutional options activity, earnings schedules, market-moving catalysts, analyst revisions, dark pool block prints, congressional trading disclosures, and scheduled economic releases.
                </p>
                <p>
                  The Grid is not a trading signal generator. It is the context layer — the difference between trading a setup that happens to coincide with a hidden catalyst and trading the same setup with full awareness of the environment.
                </p>
              </div>
            </section>

            <section id="panels">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">The 8 Panels</h2>
              <div className="space-y-6">
                {[
                  {
                    num: "01",
                    name: "News",
                    color: "cyan",
                    description: "Real-time equity and macro news. Each story is tagged with sentiment (positive/negative/neutral) and relevance weight. The feed prioritizes market-moving headlines over general financial commentary.",
                    dataSource: "Real-time financial newswire aggregation",
                    usage: "Monitor this panel continuously during the first 30 minutes of RTH. Intraday reversals are frequently news-driven — Grid News surfaces the cause faster than most news terminals.",
                  },
                  {
                    num: "02",
                    name: "Options Flow",
                    color: "sky",
                    description: "Institutional-grade unusual options activity across the broad market, not just SPX. Large-premium prints, sweeps, and dark pool options activity on individual names appear here.",
                    dataSource: "Our flow intelligence engine — institutional options feed",
                    usage: "Use this panel to identify institutional conviction in single-name positions. When Grid Options Flow and HELIX SPX flow agree on direction, structural conviction is high.",
                  },
                  {
                    num: "03",
                    name: "Earnings",
                    color: "cyan",
                    description: "Upcoming earnings release calendar with consensus EPS and revenue estimates, historical earnings reaction magnitudes, and implied move from the options market.",
                    dataSource: "Structured earnings data with consensus estimates",
                    usage: "Scan 2–5 days ahead. Earnings-driven volatility can ripple through SPX, particularly if a mega-cap (AAPL, MSFT, NVDA) is reporting. Cross-reference with Night Hawk editions to confirm GEX levels account for implied move risk.",
                  },
                  {
                    num: "04",
                    name: "Catalysts",
                    color: "sky",
                    description: "Non-earnings, non-economic market-moving catalysts: FDA decisions, product launches, M&A announcements, analyst days, conference appearances, and geopolitical events.",
                    dataSource: "Curated catalyst calendar with real-time updates",
                    usage: "Catalyst events can be directionally powerful on individual names but also create cross-market volatility. Use this panel alongside the Earnings panel to assess the full catalyst risk picture for any given session.",
                  },
                  {
                    num: "05",
                    name: "Analyst Activity",
                    color: "cyan",
                    description: "Real-time analyst rating changes, price target revisions, and initiations of coverage. Includes the firm, the new and prior rating, price target change, and the analyst&apos;s historical accuracy for that name.",
                    dataSource: "Institutional analyst ratings feed",
                    usage: "Large-cap analyst upgrades from bulge-bracket and top-tier institutional firms can generate detectable order flow on HELIX within 15–30 minutes of the rating crossing the wire.",
                  },
                  {
                    num: "06",
                    name: "Dark Pool",
                    color: "sky",
                    description: "Large off-exchange (dark pool) block trade prints on major indices and single names. Dark pool activity represents institutional positioning that bypasses lit exchange book — the largest risk-capital moves happen here.",
                    dataSource: "Our market data engine — institutional dark pool feed",
                    usage: "Large dark pool blocks on SPX or SPY in pre-market are a reliable early indication of institutional directional bias. A large block short print in a negative GEX regime is a high-conviction setup.",
                  },
                  {
                    num: "07",
                    name: "Congress Trades",
                    color: "cyan",
                    description: "Congressional stock trading disclosures under the STOCK Act. Filters for statistically significant trades in names with relevant regulatory exposure. Not a primary trading signal — a macro context indicator.",
                    dataSource: "Congressional trading disclosure aggregator",
                    usage: "Most relevant for sector-level context: a cluster of congressional buys in defense names during a foreign policy event is noteworthy macro context, not a direct trade signal.",
                  },
                  {
                    num: "08",
                    name: "Economic Data",
                    color: "sky",
                    description: "Scheduled economic releases: CPI, PPI, FOMC decisions, unemployment, retail sales, and GDP. Each release includes the consensus estimate, prior reading, and the expected SPX volatility impact.",
                    dataSource: "Economic calendar with consensus aggregation",
                    usage: "The most critical panel to check before every session. A morning CPI print that deviates significantly from consensus can completely override GEX structural levels — the macro thesis takes precedence.",
                  },
                ].map((panel) => (
                  <div key={panel.num} className={`border rounded-xl p-6 ${panel.color === "cyan" ? "border-cyan-900/40 bg-white/[0.018]" : "border-sky-900/30 bg-white/[0.012]"}`}>
                    <div className="flex items-start gap-4 mb-4">
                      <span className={`text-xs font-mono font-bold px-2 py-1 rounded border shrink-0 ${panel.color === "cyan" ? "text-cyan-400 border-cyan-700/50 bg-cyan-950/30" : "text-sky-300 border-sky-700/50 bg-sky-950/30"}`}>{panel.num}</span>
                      <div>
                        <h3 className={`text-lg font-bold mb-1 ${panel.color === "cyan" ? "text-cyan-400" : "text-sky-300"}`}>{panel.name}</h3>
                        <p className="text-secondary text-sm leading-relaxed">{panel.description}</p>
                      </div>
                    </div>
                    <div className="ml-10 grid sm:grid-cols-2 gap-4">
                      <div className="border border-white/10 rounded-lg p-3">
                        <p className="text-xs font-mono text-white/40 uppercase tracking-wider mb-1">Data Source</p>
                        <p className="text-sm text-secondary">{panel.dataSource}</p>
                      </div>
                      <div className="border border-white/10 rounded-lg p-3">
                        <p className="text-xs font-mono text-white/40 uppercase tracking-wider mb-1">How To Use</p>
                        <p className="text-sm text-secondary leading-relaxed">{panel.usage}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="data-sources">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Data Sources</h2>
              <div className="space-y-4">
                {[
                  { provider: "Financial Newswire", panels: "News, Analyst Activity", notes: "Real-time newswire and analyst ratings. News is tagged with sentiment classification. Analyst ratings include historical accuracy scores for that specific analyst-name pairing." },
                  { provider: "Flow Intelligence Engine", panels: "Options Flow, Dark Pool, Congress Trades", notes: "Institutional-grade options and dark pool flow data powering large-block dark pool prints and congressional trading disclosures." },
                  { provider: "Structured Calendars", panels: "Earnings, Catalysts, Economic Data", notes: "Aggregated calendar data with consensus estimates for earnings and economic releases. Catalyst data is curated from multiple sources and updated continuously." },
                  { provider: "Market Data Engine", panels: "Supplementary price/volume reference", notes: "Used for supplementary real-time price reference in the options flow and dark pool panels." },
                ].map((source) => (
                  <div key={source.provider} className="flex gap-4 border border-cyan-900/20 rounded-lg bg-white/[0.015] p-5">
                    <div className="shrink-0 w-44">
                      <p className="font-mono font-bold text-cyan-400 text-sm">{source.provider}</p>
                      <p className="text-xs text-mute mt-1">{source.panels}</p>
                    </div>
                    <p className="text-secondary text-sm leading-relaxed">{source.notes}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="usage">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Step-by-Step Usage</h2>
              <div className="space-y-6">
                {[
                  { step: "01", title: "Pre-Market Scan (8:00–9:20 AM ET)", body: "Start with the Economic Data panel. Check all scheduled releases. A high-impact release (CPI, FOMC, NFP) in the first 90 minutes of trading fundamentally changes how GEX levels behave. If a major release is pending, hold off on entering the Night Hawk thesis until after the number." },
                  { step: "02", title: "Review Earnings Panel for Active Holdings", body: "Check if any position in Night's Watch has an earnings event scheduled. Night's Watch verdict engine does not account for binary event risk — you need to manually assess this using the Earnings panel and reduce position size accordingly." },
                  { step: "03", title: "Dark Pool Pre-Market Scan", body: "Look for large dark pool block prints in the pre-market window. A block above $50M on SPX or SPY is institutionally significant. Cross-reference with HELIX's opening flow in the first 5 minutes for directional confirmation." },
                  { step: "04", title: "Options Flow Panel: Identify Cross-Market Rotation", body: "When the Grid Options Flow panel shows persistent unusual activity in a sector ETF (XLF, XLK, QQQ), it signals institutional rotation that may affect SPX intraday structure. Combine with HELIX for confirmation." },
                  { step: "05", title: "Catalyst and Analyst Monitoring During RTH", body: "Keep the Grid open alongside your trading desk. Analyst upgrades from large firms, breaking news, or catalyst calendar events mid-session can trigger the institutional flow response before retail news sources pick it up." },
                  { step: "06", title: "Congress Trades: Sector-Level Context", body: "Review the Congress Trades panel weekly, not intraday. Look for patterns in sector concentration — clustered congressional activity in energy or healthcare during policy events is a macro context signal worth noting." },
                ].map((s) => (
                  <div key={s.step} className="flex gap-5">
                    <div className="shrink-0 w-10 h-10 rounded-full border border-cyan-700/50 bg-cyan-950/30 flex items-center justify-center">
                      <span className="text-cyan-400 text-xs font-mono font-bold">{s.step}</span>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold mb-2">{s.title}</h3>
                      <p className="text-secondary text-sm leading-relaxed">{s.body}</p>
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
                    {["Check the Economic Data panel before the open every single day.", "Use the Earnings panel to identify binary catalyst risk for any position in Night's Watch.", "Combine Grid Options Flow with HELIX for cross-market institutional confirmation.", "Monitor the Dark Pool panel in the pre-market window for large block prints.", "Use the Analyst Activity panel to anticipate institutional flow responses to rating changes."].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-cyan-400 mt-0.5 shrink-0">+</span><span className="leading-relaxed">{item}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="border border-sky-900/40 rounded-xl bg-sky-950/10 p-6">
                  <p className="text-sky-300 font-bold font-mono text-sm uppercase tracking-wider mb-4">Don&apos;t</p>
                  <ul className="space-y-3 text-secondary text-sm">
                    {["Don't chase individual news headlines as trading signals in isolation.", "Don't use Congress Trades as a real-time signal — disclosures lag the actual trades by days.", "Don't ignore the Economic Data panel just because economic data seems 'macro-level'.", "Don't confuse Grid Options Flow with HELIX — they cover different instruments and scopes.", "Don't overwhelm yourself by monitoring all 8 panels simultaneously — prioritize by session context."].map((item, i) => (
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
                  { href: "/learn/helix-flows", name: "HELIX Options Flow", rel: "Cross-reference Grid Options Flow (broad market) with HELIX (SPX-focused) for maximum institutional conviction." },
                  { href: "/learn/night-hawk", name: "Night Hawk", rel: "Night Hawk's catalyst scan uses the same data sources as Grid's Earnings and Catalyst panels." },
                  { href: "/learn/nights-watch", name: "Night's Watch", rel: "Check Grid's Earnings panel before entering positions you plan to hold into an earnings event." },
                  { href: "/learn/largo-ai", name: "Largo Terminal", rel: "Ask Largo for macro context synthesis: 'What economic events are scheduled this week and what is the expected SPX impact?'" },
                ].map((ref) => (
                  <Link key={ref.href} href={ref.href} className="block border border-cyan-900/30 rounded-xl bg-white/[0.02] p-5 hover:border-cyan-700/50 hover:bg-cyan-950/20 transition-all group">
                    <p className="text-cyan-400 font-semibold group-hover:text-cyan-300 mb-2">{ref.name} &rarr;</p>
                    <p className="text-secondary text-sm leading-relaxed">{ref.rel}</p>
                  </Link>
                ))}
              </div>
            </section>

            <section id="faq">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">FAQ</h2>
              <div className="space-y-5">
                {[
                  { q: "How frequently does the News panel update?", a: "The News panel updates in near-real time from our financial newswire feed. There is typically a 1–3 second latency between headline publication and appearance in the Grid panel." },
                  { q: "Is the Dark Pool data real-time?", a: "Dark pool block print data has a disclosure lag inherent to how off-exchange trades are reported. The Grid surfaces dark pool prints as quickly as the exchange reporting infrastructure allows, but the data is not millisecond-precise." },
                  { q: "Why are Congressional trade disclosures delayed so much?", a: "By law, members of Congress must disclose stock trades within 45 days. The Grid surfaces disclosures as soon as they are filed. You are seeing the disclosure, not the trade date — use Congress Trades only for long-horizon sector context." },
                  { q: "Can Largo access the Grid's data?", a: "Yes. Largo's get_market_context tool call draws from the same catalyst and economic calendar data that powers the Grid panels. Largo synthesizes this information into its responses rather than showing raw panel data." },
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
