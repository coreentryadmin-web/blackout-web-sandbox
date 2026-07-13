// BLACKOUT Intelligence Engine — foundational concept/glossary layer.
//
// BIE must answer basic CONCEPTUAL questions ("What is GEX? What is a King node? What does Night
// Hawk do?") foundationally strong and correct — not fall back to a live SPX desk-dump. This is the
// deterministic source of truth: a structured, CODE-GROUNDED glossary (definitions traced to the
// exact implementation, per the term map) plus lookupGlossary(), which extracts the asked term from
// a definitional question and resolves it by term/alias (case-insensitive, plural-tolerant).
//
// Deliberately deterministic (no embeddings) so it works on staging regardless of whether Voyage is
// configured — the same ethos as the rest of the BIE router. The glossary text is ALSO fed into
// ingestBieKnowledge (belt-and-suspenders) so the RAG layer has it once embeddings land.
//
// Definitions are grounded in the real math/logic, not generic textbook prose:
//   GEX sign convention, VEX scale, the King-node-vs-wall nuance, max-pain formula, etc. — see
//   the file:line citations in each entry.

export type GlossaryCategory = "greeks" | "level" | "structure" | "technical" | "product" | "concept";

export type GlossaryEntry = {
  /** Canonical display term. */
  term: string;
  /** Lowercase match aliases (the term itself is matched too; no need to repeat it). */
  aliases: string[];
  category: GlossaryCategory;
  /** Precise, code-grounded definition. Plain prose, member-readable. */
  definition: string;
};

export const BLACKOUT_GLOSSARY: GlossaryEntry[] = [
  // ── Greeks / dealer positioning ──────────────────────────────────────────
  {
    term: "GEX (Gamma Exposure)",
    aliases: ["gex", "gamma exposure", "dealer gamma", "net gex", "net gamma"],
    category: "greeks",
    definition:
      "GEX is dealer GAMMA exposure — how much dealers must hedge as price moves. Per strike it's signed dollar-gamma: calls count +1, puts −1, scaled γ × open interest × 100 × spot² × 0.01 (the dollar-gamma per 1% move). Positive net GEX = dealers are long gamma and hedge AGAINST moves (sell rallies, buy dips) → price is pinned/mean-reverting; negative net GEX = dealers are short gamma and hedge WITH moves → volatility feeds on itself. It's the single highest-leverage read on the desk.",
  },
  {
    term: "VEX (Vanna Exposure)",
    aliases: ["vex", "vanna", "vanna exposure", "dealer vanna", "net vex"],
    category: "greeks",
    definition:
      "VEX is dealer VANNA exposure — how dealer delta shifts as implied volatility changes (vanna = ∂delta/∂vol). Signed like GEX (calls +, puts −) but scaled × 100 × spot (NOT spot²·0.01). It's the second dealer lens on Vector: falling IV with positive vanna tends to cushion dips, rising IV can accelerate them. Distinct from GEX (which is about price moves, not vol moves).",
  },
  {
    term: "DEX (Delta Exposure)",
    aliases: ["dex", "delta exposure", "dealer delta", "net dex"],
    category: "greeks",
    definition:
      "DEX is net dealer DELTA exposure: −Σ(delta × open interest × 100 × spot). Positive = dealers net long delta (a stabilizing, mean-reverting hedge flow); negative = net short delta (destabilizing / trend-amplifying).",
  },
  {
    term: "CHARM",
    aliases: ["charm", "delta decay", "charm exposure"],
    category: "greeks",
    definition:
      "Charm is delta DECAY — how an option's delta drifts purely from time passing (∂delta/∂time), ~φ(d1)·d2/(2T). As expiry nears, dealer hedges from charm can pin price toward heavy strikes (positive charm pins upward, negative drags downward), strongest into the afternoon on 0DTE.",
  },

  // ── Levels ───────────────────────────────────────────────────────────────
  {
    term: "Gamma flip",
    aliases: ["gamma flip", "flip", "zero gamma", "gamma flip level", "flip level", "zero-gamma level"],
    category: "level",
    definition:
      "The gamma flip is the strike where CUMULATIVE net GEX crosses from ≤0 to >0 — the level that separates the short-gamma (below) and long-gamma (above) regimes. When several crossings exist the one NEAREST spot is chosen. Spot above the flip = long gamma (calm, mean-reverting); below = short gamma (volatile, trend-amplifying); sitting on it = the highest-volatility, least-decided state.",
  },
  {
    term: "King node (GEX king)",
    aliases: ["king node", "king", "gex king", "king strike", "gex king strike", "king level"],
    category: "level",
    definition:
      "The King node is the single strike with the LARGEST absolute net gamma across the whole chain (argmax |net gamma|) — it can be EITHER sign, whichever magnitude dominates. It is the market's gravitational center. IMPORTANT: this is NOT the same as a call/put wall — a wall is the largest strike on ONE side (positive OR negative separately), whereas the King is the single biggest-magnitude node regardless of side. (On Vector, the per-side ⚓ 'king anchors' are a related but distinct concept — see Anchor.)",
  },
  {
    term: "Anchor (Vector king anchor)",
    aliases: ["anchor", "king anchor", "anchors", "per-side king", "vector anchor", "⚓"],
    category: "level",
    definition:
      "On Vector the ⚓ 'king anchors' are the dominant call wall AND the dominant put wall — ONE strike per side, the strongest positive-gamma strike and the strongest negative-gamma strike. Distinct from the single GEX King node (which is the biggest-magnitude strike overall, either side): there are always exactly two anchors (one call, one put), the two levels the desk reads first as the session's rails.",
  },
  {
    term: "Call wall",
    aliases: ["call wall", "resistance wall", "call walls", "upside wall"],
    category: "level",
    definition:
      "The call wall is the strike with the largest POSITIVE net gamma — the heaviest call-side dealer positioning, which acts as RESISTANCE (in long gamma dealers sell into strength there, capping upside). Ranked strongest-first; the top one is the level cited as 'the' call wall.",
  },
  {
    term: "Put wall",
    aliases: ["put wall", "support wall", "put walls", "downside wall"],
    category: "level",
    definition:
      "The put wall is the strike with the largest NEGATIVE net gamma — the heaviest put-side dealer positioning, which acts as SUPPORT (in long gamma dealers buy weakness there, flooring downside). Ranked strongest-first; the top one is 'the' put wall.",
  },
  {
    term: "Max pain",
    aliases: ["max pain", "maximum pain", "pain", "max-pain", "pain strike"],
    category: "level",
    definition:
      "Max pain is the strike that MINIMIZES total option-writer payout at expiry — the price where the most option premium expires worthless. It's computed as the strike minimizing Σ callOI·max(0, P−Kcall)·100 + Σ putOI·max(0, Kput−P)·100 over candidate prices P (ties resolve to the lower strike). Price often gravitates toward it into expiry.",
  },
  {
    term: "Expected move",
    aliases: ["expected move", "em", "implied move", "sigma move", "1 sigma", "expected range"],
    category: "level",
    definition:
      "The expected move is the ±range the options market is pricing for a horizon: a 1σ move = spot × σ × √t, where σ is the ATM implied vol and t = days-to-expiry / 365. Vector draws ±1σ and ±2σ bands (spot ± k·move). It's where price is statistically likely to stay through expiry — the 1σ band roughly the 68% zone.",
  },
  {
    term: "Gamma magnet",
    aliases: ["gamma magnet", "magnet", "gamma pivot", "pivot", "center of mass"],
    category: "level",
    definition:
      "The gamma magnet is the strength-weighted mean of the gamma wall strikes — the dealer-hedging center of mass. Its meaning depends on regime: in LONG gamma it's a true MAGNET (price is pinned and drawn toward it); in SHORT gamma the same level is a PIVOT that, once broken, ACCELERATES away rather than attracts. Calling it a magnet in short gamma would misread the flow.",
  },
  {
    term: "Dark pool levels",
    aliases: ["dark pool", "dark pool levels", "dark-pool", "dark pool prints", "dark pool strikes"],
    category: "level",
    definition:
      "Dark-pool levels are the top institutional off-exchange print concentrations by strike (from Unusual Whales dark-pool data, top ~6 by premium). Big dark-pool prints mark strikes where size traded away from the lit tape — often quiet accumulation/distribution zones that later act as support/resistance.",
  },

  // ── Structure / dynamics ─────────────────────────────────────────────────
  {
    term: "Wall integrity",
    aliases: ["wall integrity", "integrity", "wall confidence", "firm wall", "thin wall", "moderate wall"],
    category: "structure",
    definition:
      "Wall integrity is a 0–100 confidence score for 'is this wall real or about to fold', blending three factors: STRENGTH (0.45, the wall's share of total gamma), PERSISTENCE (0.35, the fraction of recent session samples it held), and ISOLATION (0.20, how far it towers over the next wall on its side). Tiers: firm ≥ 70, moderate ≥ 45, thin < 45. It stops the desk over-trusting a big-but-fleeting level.",
  },
  {
    term: "Bead / wall rail",
    aliases: ["bead", "beads", "rail", "wall rail", "wall history", "bead rail", "wall trail"],
    category: "structure",
    definition:
      "The 'beads' are the wall-history RAIL — a time series sampled every ~15s of where the walls sat and how strong they were. Each bead is a per-strike dot on the trail, so you can watch walls FORM, GROW, and FADE across the session (the 'fadeness'). Modeled/reconstructed beads render dim vs live-observed ones, so the rail never overclaims what was actually seen.",
  },
  {
    term: "Confluence zone",
    aliases: ["confluence", "confluence zone", "confluence band", "confluence levels"],
    category: "structure",
    definition:
      "A confluence zone is where ≥2 DISTINCT kinds of independent levels (e.g. a put wall + the gamma flip + the golden pocket) cluster within ~0.15% of spot — several signals agreeing on one price. It's scored by a weighted sum (dealer positioning weighted highest). One signal repeated (five fib lines) is NOT confluence; two different kinds agreeing is a real trade location.",
  },
  {
    term: "Gamma regime",
    aliases: ["regime", "gamma regime", "long gamma", "short gamma", "transition regime"],
    category: "concept",
    definition:
      "The gamma regime is the single highest-leverage interpretation layer: spot ABOVE the gamma flip = LONG gamma (dealers hedge against moves → calm, range-bound, fade extremes); spot BELOW = SHORT gamma (dealers hedge with moves → volatile, trends run, respect breaks); within ±0.1% of the flip = TRANSITION (undecided, sharpest moves as dealers flip hedging direction).",
  },

  // ── Technicals ───────────────────────────────────────────────────────────
  {
    term: "VWAP",
    aliases: ["vwap", "volume weighted average price", "volume-weighted average price"],
    category: "technical",
    definition:
      "VWAP is the Volume-Weighted Average Price — the session's average fill weighted by volume, the intraday 'fair value' many desks anchor to. Price above VWAP is a bullish session posture (buyers in control), below is bearish; the distance (in %) is the stretch. Vector reports price-vs-VWAP as a signed %.",
  },
  {
    term: "EMA stack",
    aliases: ["ema", "ema stack", "emas", "9 21 50", "moving average stack", "exponential moving average"],
    category: "technical",
    definition:
      "Vector reads the 9 / 21 / 50 exponential moving averages as a STACK: 9 > 21 > 50 = stacked bullish (trend up), 9 < 21 < 50 = stacked bearish (trend down), anything else = mixed/chop. A clean stack is a trend confirmation; a mixed stack argues for range tactics.",
  },
  {
    term: "RSI",
    aliases: ["rsi", "relative strength index"],
    category: "technical",
    definition:
      "RSI (Relative Strength Index, 14-period) is a 0–100 momentum oscillator: ≥ 70 overbought, ≤ 30 oversold, in between neutral. It gauges whether a move is stretched — but in a strong trend RSI can stay pinned overbought/oversold, so it's a context read, not a standalone signal.",
  },
  {
    term: "MACD",
    aliases: ["macd", "moving average convergence divergence"],
    category: "technical",
    definition:
      "MACD (12/26/9) is a trend-momentum indicator: the MACD line (12-EMA − 26-EMA) vs its 9-EMA signal line. Line above signal = bullish momentum, below = bearish; the histogram (line − signal) shows momentum building or fading.",
  },
  {
    term: "Golden pocket",
    aliases: ["golden pocket", "gp", "fib golden pocket", "618", "0.618"],
    category: "technical",
    definition:
      "The golden pocket is the 61.8%–65% Fibonacci retracement zone of the dominant swing — the high-probability reversal/continuation band traders watch on a pullback. Vector auto-computes it from the dominant swing on the displayed bars.",
  },
  {
    term: "Market structure (BOS / CHOCH)",
    aliases: ["market structure", "structure", "bos", "choch", "break of structure", "change of character"],
    category: "technical",
    definition:
      "Market structure tracks swing highs/lows: a BOS (Break Of Structure) is price breaking a prior swing in the trend's direction (continuation); a CHOCH (Change Of Character) is the first break AGAINST the prevailing trend (a potential reversal). Vector marks the most recent confirmed break and the level it broke.",
  },

  // ── Products ─────────────────────────────────────────────────────────────
  {
    term: "Vector",
    aliases: ["vector", "vector chart", "vector terminal", "vector desk"],
    category: "product",
    definition:
      "Vector is BlackOut's live options-structure chart terminal: for any optionable ticker it overlays dealer gamma/vanna walls, the gamma flip, magnet, max pain, the expected-move cone, a strike×time GEX heatmap, the wall-history bead rail, flow prints, and a derived concrete trade PLAY — all DTE-horizon-aware (0DTE/weekly/monthly/all) and timeframe-aware.",
  },
  {
    term: "SPX Slayer",
    aliases: ["spx slayer", "slayer", "spx play engine", "the slayer"],
    category: "product",
    definition:
      "SPX Slayer is the 0DTE SPX play engine + gate system: it evaluates the live desk every tick and either arms/commits a single high-conviction play or sits out. Phase SCANNING = its confluence gates are unmet (no forced trades); WATCHING = armed but not yet triggered; OPEN = a committed play is live. It grades setups, runs a confirmation checklist, and only fires when the gates pass.",
  },
  {
    term: "SPX Sniper desk",
    aliases: ["sniper", "spx sniper", "sniper desk", "spx desk"],
    category: "product",
    definition:
      "The SPX Sniper desk is the merged live SPX feed — price, VWAP, GEX walls/flip/king, the flow tape, dark pool, macro, and market tide in one desk snapshot — the source-of-truth desk that SPX Slayer's play engine and the Live Desk brief both read.",
  },
  {
    term: "Thermal",
    aliases: ["thermal", "blackout thermal", "heat maps", "heatmap", "gex heatmap"],
    category: "product",
    definition:
      "BlackOut Thermal is the dealer-positioning heatmap product (/heatmap): the GEX / VEX / DEX / CHARM matrices by strike for any ticker, the canonical source every other surface reads for dealer gamma/vanna/delta/charm positioning.",
  },
  {
    term: "Helix",
    aliases: ["helix", "flow tape", "helix tape", "flow feed"],
    category: "product",
    definition:
      "Helix is the market-wide options FLOW product (/flows): the live tape of large option prints ingested from the Unusual Whales feed into Postgres, with GEX-proximity enrichment (which prints sit at/near a wall or the flip) and a market-regime anomaly detector.",
  },
  {
    term: "Night Hawk",
    aliases: ["night hawk", "nighthawk", "the hawk", "evening edition"],
    category: "product",
    definition:
      "Night Hawk is the evening swing-pick product: after the close it scores candidates and publishes an edition of ranked multi-day plays (thesis, entry/target/stop, conviction, options play), then confirms them the next morning. Distinct from the intraday 0DTE engines.",
  },
  {
    term: "Largo",
    aliases: ["largo", "desk ai", "largo ai"],
    category: "product",
    definition:
      "Largo is the desk AI assistant: it answers member questions by reading the same live source-of-truth data the dashboards use, via a deterministic router (BIE) that composes grounded answers with zero LLM cost when the question maps onto known data, and falls back to a reasoning model only when it doesn't.",
  },
  {
    term: "BIE (BlackOut Intelligence Engine)",
    aliases: ["bie", "blackout intelligence engine", "intelligence engine"],
    category: "product",
    definition:
      "BIE is the learning/knowledge engine behind Largo: the deterministic router + composers that answer from live platform data (SPX desk, Vector full-state, flow, positioning, this glossary), a Layer-4 numeric verifier that grounds every cited figure, and a knowledge corpus — so answers are correct, traceable, and mostly free of LLM cost.",
  },
];

// ── Lookup ───────────────────────────────────────────────────────────────

/** Normalize free text for matching: lowercase, keep letters/digits/+, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+⚓\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip a trailing plural 's' from each word (walls → wall), leaving short words alone. */
function deplural(s: string): string {
  return s
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

/** (alias, entry) pairs across the whole glossary, longest-alias-first so a specific alias
 *  ("king node") beats a shorter overlapping one ("king") when both could match. */
const ALIAS_INDEX: { alias: string; norm: string; entry: GlossaryEntry }[] = BLACKOUT_GLOSSARY.flatMap(
  (entry) => {
    const all = [entry.term, ...entry.aliases];
    return all.map((alias) => ({ alias, norm: deplural(normalize(alias)), entry }));
  }
).sort((a, b) => b.norm.length - a.norm.length);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a glossary entry from a (typically definitional) question. Deterministic and
 * plural-tolerant: it finds the LONGEST glossary alias that appears as a whole phrase in the
 * question, so "what is a king node?", "define GEX", "explain the gamma flip", and "what does Night
 * Hawk do" all resolve, while an unknown term returns null (the caller then answers honestly rather
 * than dumping the desk). The interrogative wrapper doesn't need parsing — matching the alias inside
 * the whole normalized question is enough and more robust.
 */
export function lookupGlossary(question: string): GlossaryEntry | null {
  if (!question || !question.trim()) return null;
  const q = deplural(normalize(question));
  for (const { norm, entry } of ALIAS_INDEX) {
    if (!norm) continue;
    // Whole-phrase match with word boundaries so "gex" doesn't match inside another word, but the
    // multi-word aliases still match across spaces.
    const re = new RegExp(`(?:^|\\s)${escapeRe(norm)}(?:\\s|$)`);
    if (re.test(q)) return entry;
  }
  return null;
}

/**
 * Render the whole glossary as one prose knowledge doc for ingestBieKnowledge (belt-and-suspenders:
 * the deterministic lookup is the primary path, but the RAG corpus gets the same content so a fuzzy
 * conceptual question benefits once embeddings are configured).
 */
export function glossaryKnowledgeText(): string {
  const lines = BLACKOUT_GLOSSARY.map(
    (e) => `## ${e.term} [${e.category}]\nAliases: ${e.aliases.join(", ")}\n${e.definition}`
  );
  return `BLACKOUT glossary — foundational concept definitions (code-grounded).\n\n${lines.join("\n\n")}`;
}
