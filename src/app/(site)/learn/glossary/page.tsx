"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { LearnDoc } from "@/components/learn/LearnDoc";

const TOC = [
  { id: "dealer-greeks", label: "Dealer Greeks" },
  { id: "structural-levels", label: "Structural Levels" },
  { id: "options-fundamentals", label: "Options Fundamentals" },
  { id: "price-volume", label: "Price & Volume Reference" },
  { id: "institutional-flow", label: "Institutional Flow Signals" },
  { id: "platform-terms", label: "Platform-Specific Terms" },
  { id: "faq", label: "FAQ" },
  { id: "cross-reference", label: "Tool Cross-Reference" },
];

const TERMS: Record<string, { term: string; def: string }[]> = {
  "dealer-greeks": [
    { term: "CHARM", def: "The second-order Greek measuring the rate of change of delta with respect to time (dDelta/dTime). As options approach expiry, CHARM-driven delta decay forces dealers to unwind their delta hedges. On expiry day, CHARM flows can exert measurable directional pressure in the final 60–90 minutes of the session." },
    { term: "DEX — Delta Exposure", def: "The aggregate delta position held by the dealer community across all outstanding options contracts on a given underlying. DEX quantifies the total directional hedge the dealer book must maintain. A large positive DEX means dealers are net long underlying and must sell into rallies." },
    { term: "GEX — Gamma Exposure", def: "The net gamma position of the dealer community at each strike, computed from open interest and the gamma of each contract. Positive GEX at a strike means dealers are long gamma there — their hedging activity stabilizes price near that strike. Negative GEX means dealers are short gamma — their hedging amplifies moves." },
    { term: "Gamma Squeeze", def: "A self-reinforcing price acceleration caused by dealer hedging activity in a negative GEX environment. As price rises, dealers must buy more underlying to stay delta-neutral, which pushes price higher, forcing more buying. Gamma squeezes can produce sharp, sustained directional moves." },
    { term: "VEX — Vanna Exposure", def: "The sensitivity of dealer delta to changes in implied volatility (dDelta/dIV). VEX is most critical to monitor around scheduled volatility events: FOMC, CPI, earnings. When IV collapses post-event, VEX flows force systematic dealer delta unwinding." },
  ],
  "structural-levels": [
    { term: "Call Wall", def: "The strike with the highest concentration of positive dealer gamma above the current spot price. As SPX rises toward the Call Wall, dealers must mechanically sell the underlying to remain delta-neutral, creating resistance. A sustained break above the Call Wall into negative dealer delta territory is structurally significant." },
    { term: "Gamma Flip", def: "The precise strike level at which the aggregate dealer gamma exposure crosses from positive to negative (or vice versa). Above the Gamma Flip: stabilizing, mean-reverting dealer flows. Below it: amplifying, momentum-extending flows. The Gamma Flip is the most important structural level on the BlackOut platform." },
    { term: "King Node", def: "The dominant positive GEX strike of the day — the single level with the greatest total gamma magnitude across all expiries. Price exhibits the strongest magnetic attraction toward the King Node during RTH. The King Node tends to act as the gravitational center of intraday ranging." },
    { term: "Put Wall", def: "The strike with the highest concentration of positive dealer gamma below the current spot price. As SPX declines toward the Put Wall, dealers must mechanically buy the underlying to stay delta-neutral, creating support. A sustained break below the Put Wall into negative GEX territory often accelerates the decline." },
    { term: "Gamma Flip Zone", def: "The price range immediately surrounding the Gamma Flip strike. Price action in this zone is often choppy and indecisive as dealers transition between stabilizing and amplifying hedging regimes." },
  ],
  "options-fundamentals": [
    { term: "0DTE — Zero Days to Expiration", def: "An options contract expiring on the current trading day. SPX PM-settled 0DTE contracts are the primary instrument for the BlackOut play engine. 0DTE options experience extreme theta decay and gamma amplification in the final hours of the session." },
    { term: "Ask", def: "The price at which the market maker (dealer) is willing to sell an options contract. Buying at the ask is the standard execution point for retail options buyers." },
    { term: "Bid", def: "The price at which the market maker (dealer) is willing to buy an options contract back. Selling at the bid is the standard execution for retail options sellers." },
    { term: "Delta", def: "The rate of change of an option's price for a $1 move in the underlying. Calls have positive delta (0 to +1); puts have negative delta (−1 to 0). A 50-delta call gains approximately $0.50 in value for each $1 rise in the underlying." },
    { term: "Gamma", def: "The rate of change of delta per $1 move in the underlying. High gamma means delta — and therefore P&L — changes rapidly with small moves. ATM 0DTE options have the highest gamma and therefore the most violent P&L swings." },
    { term: "Implied Volatility (IV)", def: "The market's implied forecast of future price volatility, derived from option prices. Higher IV inflates option premiums. Lower IV (IV crush, typically post-event) deflates them. IV is expressed as an annualized percentage." },
    { term: "IV Percentile (IVP)", def: "The current implied volatility level expressed as a percentile relative to the past year's IV range. IVP 90 means current IV is higher than 90% of all readings over the past year — options are expensive relative to recent history." },
    { term: "Open Interest (OI)", def: "The total number of outstanding option contracts at a given strike and expiry. Open interest is the foundation of GEX computation — high OI at a strike concentrates dealer gamma obligations there." },
    { term: "Theta", def: "The time decay of an option's value per day, assuming all else equal. Theta is always negative for option buyers. Theta decay accelerates dramatically for 0DTE contracts, particularly in the final 60 minutes of the session." },
    { term: "Vega", def: "The sensitivity of an option's value to a 1-point change in implied volatility. Long options have positive vega — they gain value when IV rises. Short options have negative vega." },
  ],
  "price-volume": [
    { term: "VWAP — Volume-Weighted Average Price", def: "The average price of a security weighted by volume over a given time period (typically the trading day from market open). VWAP is used by institutional participants as an intraday execution benchmark. SPX trading above VWAP is a bullish structural signal; below is bearish." },
    { term: "EMA — Exponential Moving Average", def: "A moving average that places greater weight on recent price data. SPX Slayer uses the 5, 9, and 21 EMA as part of its play engine gate logic. When the EMA stack is aligned (5 > 9 > 21 for bullish; 5 < 9 < 21 for bearish), the trend is confirmed by momentum." },
    { term: "Bid-Ask Spread", def: "The difference between the highest price a buyer will pay (bid) and the lowest price a seller will accept (ask) for an option contract. Tight spreads indicate liquid markets; wide spreads indicate illiquid markets where execution costs are higher." },
    { term: "Premium", def: "The total dollar value of an options contract (price × contract multiplier). SPX options have a $100 multiplier, so a $1.00 option costs $100 per contract in premium." },
  ],
  "institutional-flow": [
    { term: "Block Trade", def: "A large options or equity transaction executed off the lit exchange (in a dark pool) to minimize market impact. Block trades are a primary indicator of institutional conviction." },
    { term: "Dark Pool", def: "Off-exchange trading venues where large institutional orders are executed away from public order books. Dark pool activity is disclosed after the fact, but its volume and direction are traceable. BlackOut Grid surfaces dark pool block prints." },
    { term: "Net Flow Bias", def: "The aggregate directional bias of all options flow prints for a given underlying or time window, computed as total bullish premium minus total bearish premium. A strongly positive net flow bias indicates institutional money is bidding for upside protection or directional calls." },
    { term: "Sweep", def: "An aggressive options order that simultaneously fills across multiple exchanges to maximize size at the market price. Sweeps indicate institutional urgency — the buyer or seller wanted size immediately and was willing to take liquidity across venues." },
    { term: "Unusual Options Activity", def: "Options trades that are statistically anomalous relative to historical open interest and volume at that strike-expiry combination. HELIX and Grid Options Flow surface unusual activity; it often precedes institutional positioning ahead of known or unknown events." },
  ],
  "platform-terms": [
    { term: "Active Play Card", def: "The live trade idea card that appears in SPX Slayer when all four engine gates have passed. Shows the current play direction (call/put), the specific contract, entry price, target, stop, and live P&L." },
    { term: "Edition", def: "The structured document Night Hawk publishes each evening for the following session. Contains 6 blocks: Market Context, Catalyst Scan, GEX Positioning, Directional Thesis, Play Ideas, and Invalidation Levels." },
    { term: "GEX Regime", def: "The current state of dealer gamma positioning relative to the Gamma Flip. Positive regime: price above the Gamma Flip — stabilizing dealer behavior. Negative regime: price below the Gamma Flip — amplifying dealer behavior." },
    { term: "Heartbeat", def: "The 30-second update cycle of the SPX Slayer play engine during RTH. Each heartbeat re-evaluates all engine gates against live data." },
    { term: "Invalidation Level", def: "The price level defined in a Night Hawk edition or SPX Slayer play at which the directional thesis is no longer structurally supported. Breaching the invalidation level is a hard stop on the trade." },
    { term: "SCANNING", def: "The default state of the SPX Slayer play engine when no qualifying setup has been identified. SCANNING does not mean the market is slow — it means the engine has not found a setup that meets all four gate criteria simultaneously." },
    { term: "Tool Call (Largo)", def: "A structured function invocation Largo uses to retrieve live platform data. Tool calls include get_spx_structure, get_market_context, get_flow_context, get_my_positions, and add_position. They ensure Largo's responses are grounded in live data rather than model memory." },
    { term: "Valuation Status", def: "The freshness indicator for Night's Watch position pricing: live (chain data <30 seconds), stale (chain data present but older than 30 seconds), or unavailable (chain cannot be fetched)." },
    { term: "Verdict", def: "An output of the Night's Watch verdict engine for an open position. Three states: HOLD (no action required), TRIM (partial exit recommended), SELL (full exit recommended)." },
  ],
};

const CATEGORIES = [
  { id: "all", label: "All Terms" },
  { id: "dealer-greeks", label: "Dealer Greeks" },
  { id: "structural-levels", label: "Structural Levels" },
  { id: "options-fundamentals", label: "Options Fundamentals" },
  { id: "price-volume", label: "Price & Volume" },
  { id: "institutional-flow", label: "Institutional Flow" },
  { id: "platform-terms", label: "Platform Terms" },
];

export default function GlossaryPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const result: Record<string, { term: string; def: string }[]> = {};
    for (const [key, terms] of Object.entries(TERMS)) {
      if (activeCategory !== "all" && activeCategory !== key) continue;
      const matches = terms.filter(
        (t) =>
          !q ||
          t.term.toLowerCase().includes(q) ||
          t.def.toLowerCase().includes(q)
      );
      if (matches.length > 0) result[key] = matches;
    }
    return result;
  }, [search, activeCategory]);

  const totalVisible = Object.values(filtered).flat().length;

  return (
    <LearnDoc
      title="Glossary"
      description="Complete terminology reference for the BlackOut Trading platform — every key term, clearly defined with context for how it applies to your workflow."
      sections={TOC}
    >

            {/* Search + filter bar */}
            <div className="space-y-4">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search terms and definitions..."
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-mute focus:border-cyan-400/50 focus:outline-none transition-colors"
              />
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      activeCategory === cat.id
                        ? "border-cyan-400 bg-cyan-400/10 text-cyan-400"
                        : "border-white/10 text-secondary hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {search && (
                <p className="text-xs text-mute">
                  {totalVisible} term{totalVisible !== 1 ? "s" : ""} matching &ldquo;{search}&rdquo;
                </p>
              )}
            </div>

            {[
              { id: "dealer-greeks", title: "Dealer Greeks", subtitle: "The Greek sensitivities that drive dealer hedging — the mechanical engine behind structural levels.", accent: "cyan" },
              { id: "structural-levels", title: "Structural Levels", subtitle: "Price levels created by dealer positioning that act as gravitational zones for SPX intraday behavior.", accent: "sky" },
              { id: "options-fundamentals", title: "Options Fundamentals", subtitle: "Core options mechanics that underpin every surface on the BlackOut platform.", accent: "cyan" },
              { id: "price-volume", title: "Price & Volume Reference", subtitle: "Standard market microstructure terminology used across the BlackOut desk and flow surfaces.", accent: "sky" },
              { id: "institutional-flow", title: "Institutional Flow Signals", subtitle: "The vocabulary of how large institutions position and execute in the options and dark pool markets.", accent: "cyan" },
              { id: "platform-terms", title: "Platform-Specific Terms", subtitle: "BlackOut-specific terminology used across tools, verdicts, and the engine architecture.", accent: "sky" },
            ]
              .filter((s) => filtered[s.id])
              .map((section) => (
              <section key={section.id} id={section.id}>
                <div className="mb-6 pb-2 border-b border-cyan-900/30">
                  <h2 className="text-2xl font-bold text-white mb-1">{section.title}</h2>
                  <p className="text-sm text-mute leading-relaxed">{section.subtitle}</p>
                </div>
                <div className="space-y-4">
                  {(filtered[section.id] || []).map((entry) => (
                    <div key={entry.term} className="border border-white/[0.08] rounded-lg bg-white/[0.015] p-5 hover:border-cyan-900/50 transition-colors">
                      <p className={`font-mono font-bold text-sm mb-2 ${section.accent === "cyan" ? "text-cyan-400" : "text-sky-300"}`}>{entry.term}</p>
                      <p className="text-secondary text-sm leading-relaxed">{entry.def}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <section id="faq">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">FAQ</h2>
              <div className="space-y-5">
                {[
                  { q: "What is the most important term to understand on BlackOut?", a: "The Gamma Flip. Every other concept on the platform is secondary to understanding whether price is above or below the Gamma Flip and what that means for dealer hedging behavior. Master this term first." },
                  { q: "Are these definitions specific to BlackOut or standard industry terminology?", a: "Most terms (Delta, Gamma, VWAP, etc.) are standard industry terminology. Platform-specific terms (King Node, Verdict, Edition, Active Play Card) are BlackOut constructs. The Glossary distinguishes both clearly." },
                  { q: "Why does BlackOut focus so much on dealer positioning rather than price action or fundamentals?", a: "Dealer positioning is mechanically enforced — market makers must hedge. That mechanical behavior creates predictable, repeatable structural effects on price. Price action reflects dealer behavior in aggregate; understanding the source (dealer mechanics) gives you an edge over reading the surface (price alone)." },
                ].map((item, i) => (
                  <div key={i} className="border border-cyan-900/25 rounded-xl bg-white/[0.015] p-6">
                    <p className="text-white font-semibold mb-3 leading-snug">{item.q}</p>
                    <p className="text-secondary text-sm leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="cross-reference">
              <h2 className="text-2xl font-bold text-white mb-6 pb-2 border-b border-cyan-900/30">Tool Cross-Reference</h2>
              <p className="text-secondary leading-relaxed mb-6 text-sm">This table maps each major term to the tools where it is most directly applied.</p>
              <div className="rounded-xl border border-cyan-900/30 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-cyan-950/30 border-b border-cyan-900/30">
                      <th className="text-left px-5 py-3 text-cyan-400 font-mono text-xs uppercase tracking-wider font-semibold">Term</th>
                      <th className="text-left px-5 py-3 text-cyan-400 font-mono text-xs uppercase tracking-wider font-semibold">Primary Tool</th>
                      <th className="text-left px-5 py-3 text-cyan-400 font-mono text-xs uppercase tracking-wider font-semibold hidden sm:table-cell">Also Used In</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-900/20">
                    {[
                      { term: "GEX / Gamma Exposure", primary: "Heat Maps", also: "SPX Slayer, Night Hawk, Largo" },
                      { term: "Gamma Flip", primary: "Heat Maps", also: "SPX Slayer, Night Hawk, Night's Watch" },
                      { term: "King Node", primary: "Heat Maps", also: "SPX Slayer" },
                      { term: "Call Wall / Put Wall", primary: "Heat Maps", also: "SPX Slayer, Night Hawk, Night's Watch" },
                      { term: "VEX / CHARM / DEX", primary: "Heat Maps", also: "Largo AI" },
                      { term: "Active Play Card", primary: "SPX Slayer", also: "—" },
                      { term: "SCANNING / APPROVE states", primary: "SPX Slayer", also: "—" },
                      { term: "Sweep / Unusual Flow", primary: "HELIX", also: "BlackOut Grid" },
                      { term: "Net Flow Bias", primary: "HELIX", also: "Largo AI" },
                      { term: "Edition", primary: "Night Hawk", also: "—" },
                      { term: "Invalidation Level", primary: "Night Hawk", also: "SPX Slayer" },
                      { term: "Verdict (HOLD/TRIM/SELL)", primary: "Night's Watch", also: "—" },
                      { term: "Valuation Status", primary: "Night's Watch", also: "—" },
                      { term: "Tool Call", primary: "Largo AI", also: "—" },
                      { term: "Dark Pool Block", primary: "BlackOut Grid", also: "HELIX" },
                    ].map((row, i) => (
                      <tr key={i} className="hover:bg-cyan-950/10 transition-colors">
                        <td className="px-5 py-3 text-cyan-400 font-mono font-medium">{row.term}</td>
                        <td className="px-5 py-3 text-white">{row.primary}</td>
                        <td className="px-5 py-3 text-mute hidden sm:table-cell">{row.also}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="border-t border-cyan-900/30 pt-8 flex flex-col sm:flex-row gap-4 justify-between">
              <Link href="/learn/blackout-grid" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">&larr; BlackOut Grid</Link>
              <Link href="/learn" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">Back to Learn &rarr;</Link>
            </div>
    </LearnDoc>
  );
}
