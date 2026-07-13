// Rich explanatory content for the core desk concepts — the "teach it properly" layer on top of the
// one-line glossary `definition`. Kept in its own map (keyed by the glossary entry's canonical `term`)
// so the big glossary array stays a clean term↔definition index and this explanatory prose can grow
// independently. A term WITHOUT an entry here still answers from its definition (one section); a term
// WITH one becomes a full multi-section explanation (What it is · How it works · Why it matters ·
// Example · On the platform). All content is code/doc-grounded and honest — no fabricated numbers.

export type ConceptRich = {
  /** The mechanic — how it's computed / how it actually works. */
  howItWorks?: string;
  /** Why a trader should care — what it tells you, how to use it. */
  whyItMatters?: string;
  /** A concrete, numeric-ish worked example (illustrative, labelled as such). */
  example?: string;
  /** Where it shows up in BlackOut — which surface/product renders it. */
  onPlatform?: string;
};

export const CONCEPT_RICH: Record<string, ConceptRich> = {
  "GEX (Gamma Exposure)": {
    howItWorks:
      "Per strike, GEX is signed dollar-gamma — calls count +1, puts −1 — scaled γ × open interest × 100 × spot² × 0.01 (the dollar-hedge per 1% move). Summing every strike gives net GEX; the sign is what matters. Positive net = dealers are net LONG gamma and hedge AGAINST moves (sell rallies, buy dips), which pins price. Negative net = dealers are SHORT gamma and hedge WITH moves (sell weakness, buy strength), which amplifies volatility.",
    whyItMatters:
      "It's the single highest-leverage read on the desk because it tells you the market's default behaviour BEFORE any news: in positive GEX expect chop, mean-reversion and faded breakouts; in negative GEX expect trends, gaps and momentum that feeds on itself. Position sizing and whether you fade or follow both hinge on it.",
    example:
      "Illustrative: net GEX +8.0B with spot 6,010 above the flip → dealers dampen, so a spike to 6,025 tends to get sold back toward the pin. Flip the sign to −8.0B and that same spike more likely extends, because dealers are now chasing it.",
    onPlatform:
      "Thermal (/heatmap) is the canonical GEX matrix by strike; the SPX Slayer desk and Vector both read it for the net-GEX number, the walls, and the gamma flip that separate the two regimes.",
  },
  "VEX (Vanna Exposure)": {
    howItWorks:
      "VEX sums signed vanna (∂delta/∂vol) across strikes — calls +, puts − — scaled × 100 × spot (note: spot, not spot²·0.01 like GEX). It measures how dealer delta shifts when implied volatility moves, so it's a VOL-driven hedge lens rather than a price-driven one.",
    whyItMatters:
      "Vanna is why markets can grind higher as IV bleeds out (positive-vanna dealers buy as vol falls) and why a vol spike can accelerate a selloff. It's the second-order tell GEX alone misses — the 'why did it drift up on no news' answer.",
    example:
      "Illustrative: into a calm afternoon with positive net VEX, a steady IV decline nudges dealers to buy, cushioning dips — the classic low-vol melt-up. A sudden IV pop reverses that support.",
    onPlatform:
      "Vector exposes the VEX (vanna) lens alongside GEX — its own walls and flip — so you can see where vol-driven and price-driven hedging agree or diverge.",
  },
  "Gamma flip": {
    howItWorks:
      "It's the strike where CUMULATIVE net GEX crosses from ≤0 to >0 — walk the strikes accumulating gamma and mark where the running total changes sign. When several crossings exist, the one NEAREST spot is used. Above it the book is net long gamma; below it, net short.",
    whyItMatters:
      "The flip is the single line that separates 'calm, mean-reverting' from 'volatile, trend-amplifying.' Which side of it price sits on decides whether you fade extensions or ride momentum — it's the first level the desk checks.",
    example:
      "Illustrative: flip at 5,980, spot 6,010 → long-gamma / range-bound, so pushes toward the call wall tend to stall. Lose 5,980 and the regime flips to short-gamma — the same push now more likely runs.",
    onPlatform:
      "Rendered on the SPX Slayer desk and on Vector (per-DTE — 0DTE / weekly / monthly re-scope the flip). The desk states 'above/below gamma flip' and calls it 'undecided' when spot is sitting right on it.",
  },
  "King node (GEX king)": {
    howItWorks:
      "The King is argmax |net gamma| across the whole chain — the single strike with the largest ABSOLUTE net gamma, either sign. Every strike's net gamma is compared by magnitude; the biggest wins, whether it's a giant positive (call-heavy) or negative (put-heavy) node.",
    whyItMatters:
      "It's the market's gravitational center — the strike price is most drawn toward and most reactive around, especially into expiry. NOT the same as a call/put wall (which is the biggest on ONE side); the King is the biggest magnitude overall.",
    example:
      "Illustrative: if the 6,000 strike carries −12B net gamma and the largest call wall is +7B at 6,050, the King is 6,000 — the dominant node — even though 6,050 is the top call-side wall.",
    onPlatform:
      "Thermal/Vector flag the King node; on Vector the per-side ⚓ 'king anchors' (strongest call wall AND strongest put wall) are a related but distinct pair — see Anchor.",
  },
  "Call wall": {
    howItWorks:
      "The strike with the largest POSITIVE net gamma — the heaviest call-side dealer positioning. Walls are ranked strongest-first; the top one is 'the' call wall.",
    whyItMatters:
      "In long gamma it acts as RESISTANCE: dealers sell into strength there, capping upside and often pinning price below it into expiry. A decisive break above a call wall is a meaningful regime tell, not just another tick.",
    example:
      "Illustrative: call wall at 6,050 with spot 6,020 in long gamma → rallies tend to stall at 6,050; sustained trade ABOVE it says the pin broke and dealers are re-hedging higher.",
    onPlatform:
      "Vector draws the call wall (and its ⚓ anchor) on the ladder and the chart; the SPX desk cites it as an upside level in its LEVELS read.",
  },
  "Put wall": {
    howItWorks:
      "The strike with the largest NEGATIVE net gamma — the heaviest put-side dealer positioning. Ranked strongest-first; the top one is 'the' put wall.",
    whyItMatters:
      "It acts as SUPPORT: in long gamma dealers buy into weakness there, cushioning downside; losing the put wall removes that support and often opens air beneath price.",
    example:
      "Illustrative: put wall at 5,950 with spot 5,985 → dips toward 5,950 tend to get bought; a clean break BELOW it removes the floor and can accelerate lower.",
    onPlatform:
      "Vector draws the put wall (and its ⚓ anchor); the SPX desk cites it as the key downside level and the natural stop/invalidation reference.",
  },
  "Max pain": {
    howItWorks:
      "The strike where the TOTAL dollar value of all open options (calls + puts) that expire worthless is greatest — equivalently, where option buyers lose the most. Computed by summing in-the-money value across strikes for each candidate settlement and taking the minimum-payout strike.",
    whyItMatters:
      "It's a soft magnet into expiry: price often gravitates toward max pain as dealers hedge and time decay bleeds the wings. It's context, not a hard target — strong flow or news overrides it.",
    example:
      "Illustrative: max pain 6,000 with spot 6,015 on expiry morning → a mild pull toward 6,000 is the base case absent a catalyst; treat it as gravity, not a guarantee.",
    onPlatform:
      "Shown on the SPX desk and per-DTE on Vector (0DTE / weekly / monthly each have their own max pain — a weekly max pain is NOT the 0DTE one).",
  },
  "Expected move": {
    howItWorks:
      "The options-implied one-standard-deviation range over a horizon, taken from the at-the-money straddle price (≈ ATM straddle × ~0.85, or spot × IV × √(days/365)). It's the market's own priced-in ± band.",
    whyItMatters:
      "It frames whether a level is 'far' or 'in range' and sizes realistic targets/stops. Trading for a move well beyond the expected move needs a real catalyst; fading the edges of it is the mean-reversion play in calm regimes.",
    example:
      "Illustrative: spot 6,000, 0DTE expected move ±35 → the day's ~68% band is 5,965–6,035; a call wall at 6,050 sits just outside it, so tagging it would be a >1σ day.",
    onPlatform:
      "Vector renders the expected-move band around spot per DTE; the SPX desk uses it to qualify how stretched a target is.",
  },
  "Gamma regime": {
    howItWorks:
      "A LOCAL spot-vs-flip label: spot above the gamma flip → 'mean_revert' (long gamma), below → 'amplification' (short gamma), with a small ±buffer hysteresis so it doesn't flicker when spot hugs the flip. It's the local read at spot, distinct from the aggregate net-GEX sign of the whole book.",
    whyItMatters:
      "It's the one-word answer to 'fade or follow?' Mean_revert → fade extensions toward the pin; amplification → respect momentum and give trends room. Getting the regime right matters more than any single level.",
    example:
      "Illustrative: spot 6,010, flip 5,980 → mean_revert; a pop to 6,030 is a fade-toward-pin setup. Drop under 5,980 and the label turns to amplification — now that pop is a breakout to follow.",
    onPlatform:
      "Stated on the SPX Slayer desk and Vector's regime banner; right at the flip the desk honestly says the regime is undecided rather than forcing a side.",
  },
  "0DTE": {
    howItWorks:
      "Zero-days-to-expiration options — contracts expiring the same session. Their gamma and charm are enormous and concentrated, so dealer hedging around 0DTE strikes drives much of the intraday tape, strongest into the afternoon as decay accelerates.",
    whyItMatters:
      "0DTE positioning is why intraday pins, squeezes and afternoon reversals happen. The 0DTE flip/walls/max-pain are the levels that actually govern today's price action — a weekly or monthly read won't capture the same-day mechanics.",
    example:
      "Illustrative: heavy 0DTE call wall at 6,000 with spot 5,990 into the afternoon → charm + gamma hedging tends to pin price under 6,000 unless flow forces a break.",
    onPlatform:
      "The 0DTE Command board scans same-day plays every couple of minutes; Vector's 0DTE horizon scopes the flip/walls/max-pain to same-day expiry specifically.",
  },
  "Thermal": {
    whyItMatters:
      "It's the canonical source of truth for dealer positioning — every other surface (SPX desk, Vector, Night Hawk's positioning read) reads Thermal's matrix, so the GEX/VEX/DEX/CHARM you see elsewhere all trace back here.",
    example:
      "Illustrative use: open Thermal on SPX to see the whole gamma matrix by strike, spot the biggest positive node (call wall) and negative node (put wall), and read where the cumulative flip sits.",
    onPlatform:
      "Lives at /heatmap. The GEX / VEX / DEX / CHARM matrices by strike for any ticker.",
  },
  "Helix": {
    whyItMatters:
      "It's how you see WHO is positioning in size right now — the live options tape with GEX-proximity context, so you know whether a big print is hitting at a wall or the flip (where it matters most) versus in dead space.",
    example:
      "Illustrative: a $4M call sweep printing right at the put wall in short gamma is a very different signal than the same sweep in the middle of the range — Helix tags that proximity for you.",
    onPlatform:
      "Lives at /flows. Live large-print tape from the Unusual Whales feed into Postgres, with GEX-proximity enrichment and a market-regime anomaly detector.",
  },
  "Night Hawk": {
    whyItMatters:
      "It's the overnight/swing complement to the intraday engines — after the close it does the scoring work so you walk in with a ranked, fully-specified plan (thesis, entry/target/stop, conviction) rather than a blank chart.",
    example:
      "Illustrative: the evening edition might publish 'NVDA long, A-conviction, entry/target/stop + options play,' then confirm or drop it against the next morning's tape.",
    onPlatform:
      "The evening edition of ranked multi-day plays; confirmed the next morning. Distinct from the same-day 0DTE Command engine.",
  },
  "Largo": {
    whyItMatters:
      "It's the desk's answer layer — ask it a question in plain English and it composes an answer from the SAME live data the dashboards use, deterministically (BIE) with zero LLM cost when the question maps onto known data, so the numbers are traceable and never made up.",
    example:
      "Illustrative: ask 'what's the SPX setup?' and Largo returns the live desk read — regime, flip, walls, the play and its invalidation — built from real desk data, not a guess.",
    onPlatform:
      "The chat desk assistant; the BIE router composes grounded answers and only falls back to a reasoning model when a question genuinely needs it.",
  },
  "Vector": {
    whyItMatters:
      "It's the per-ticker, per-DTE dealer-positioning terminal — the place to read the flip, walls, magnet, expected move, max pain and the concrete play for any optionable name, correctly scoped to 0DTE / weekly / monthly rather than a blurred aggregate.",
    example:
      "Illustrative: load NVDA on Vector, toggle to weekly, and read the weekly flip + walls + expected-move band + the derived play — then flip to 0DTE to see how the same-day mechanics differ.",
    onPlatform:
      "The Vector desk terminal: chart + GEX ladder + regime banner + desk read, with DTE and timeframe controls and the bead/wall rail over the session.",
  },
  "Anchor (Vector king anchor)": {
    howItWorks:
      "The two ⚓ anchors are the single strongest positive-gamma strike (dominant call wall) and the single strongest negative-gamma strike (dominant put wall) — exactly one per side.",
    whyItMatters:
      "They're the two rails the desk reads first: the anchors bracket where dealers are heaviest on each side, so they frame the day's likely range and the levels a break would signal most.",
    example:
      "Illustrative: call anchor 6,050, put anchor 5,950 → treat 5,950–6,050 as the session's dealer-defined rails; a decisive break of either is the meaningful move.",
    onPlatform:
      "Vector marks both ⚓ anchors on the ladder/chart. Distinct from the single GEX King node (biggest magnitude overall, one strike either side).",
  },
};
