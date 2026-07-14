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
    aliases: [
      "regime",
      "gamma regime",
      "long gamma",
      "short gamma",
      "positive gamma",
      "negative gamma",
      "pos gamma",
      "neg gamma",
      "transition regime",
    ],
    category: "concept",
    definition:
      "The gamma regime is the single highest-leverage interpretation layer: spot ABOVE the gamma flip = LONG gamma (dealers hedge against moves → calm, range-bound, fade extremes); spot BELOW = SHORT gamma (dealers hedge with moves → volatile, trends run, respect breaks); within ±0.1% of the flip = TRANSITION (undecided, sharpest moves as dealers flip hedging direction).",
  },

  {
    term: "0DTE",
    aliases: ["0dte", "zero dte", "zero-dte", "0 dte", "same-day expiry", "same day options", "same-day options"],
    category: "concept",
    definition:
      "0DTE = zero days to expiry — options expiring the SAME trading day. With no time left, they're almost pure gamma/theta: value swings violently with small spot moves and decays fast, so dealer gamma hedging dominates the intraday tape. 0DTE is the basis for SPX Slayer (the SPX 0DTE play engine) and 0DTE Command (the multi-ticker 0DTE scanner) — it's where the gamma flip, walls, and charm pin have the most immediate effect.",
  },

  // ── Cortex / 0DTE decision layer (PR-H) ──────────────────────────────────
  // Definitions grounded in src/lib/nighthawk/cortex/* (composer), src/lib/zerodte/
  // cortex-gate.ts (gate wiring), exit-engine.ts (exits), calibration.ts +
  // skip-grading.ts (the learning loop). Plain English, one concrete example each.
  {
    term: "Cortex (Night Hawk Cortex)",
    aliases: ["cortex", "night hawk cortex", "nighthawk cortex", "evidence composer", "cortex verdict", "the cortex"],
    category: "concept",
    definition:
      "The Cortex is the 0DTE evidence brain: eight independent sources (GEX walls, wall lifecycle, flow quality, sector heat, catalysts/news, VEX/charm, dark-pool confluence, and the opening harvest) each contribute signed, timestamped evidence about a specific play, and the composer folds them into one verdict — a net score (supports minus opposes, decayed for age and capped per source), a conviction band (A/B/C), and any hard VETOES. It runs on plays that already passed the hard gates: a veto blocks the commit outright, a net-negative score blocks it too, and on a commit the FULL evidence vector is pinned to the play's ledger row so 'why did we take this' is answerable forever. Example: NVDA long clears the gates, the wall lifecycle and GEX walls both argue for it (net +2.1, conviction A) → it prints, and those exact evidence lines are the pinned reason; if flow quality had spotted opposing whale blocks instead, that one veto would have killed it regardless of the +2.1.",
  },
  {
    term: "Evidence veto (Cortex veto)",
    aliases: ["veto", "evidence veto", "cortex veto", "hard veto", "veto channel"],
    category: "concept",
    definition:
      "A veto is the Cortex's hard-block channel: one loud, concrete opposing fact that kills an entry no matter how good the rest of the evidence is. Unlike supports (bounded and capped), a veto is not a score contribution — any veto at all blocks the commit, and the blocked play is recorded as a SKIP with the vetoing source named (e.g. 'cortex veto [flow-quality]'). Example: a long setup with strong walls and +1.8 net evidence still doesn't print if the flow tape shows a cluster of large opposing put blocks — that single fact vetoes the trade, and the skip card shows exactly why.",
  },
  {
    term: "Veto asymmetry",
    aliases: ["veto asymmetry", "precision-first asymmetry", "asymmetric evidence", "evidence asymmetry"],
    category: "concept",
    definition:
      "The Cortex's core safety rule: positive and negative evidence are deliberately NOT symmetric. Supporting evidence is capped per source (no single source can pile up unlimited bullish weight), but vetoes are unbounded hard blocks — so one loud bearish fact can kill an entry, while one loud bullish signal can never buy one. This makes the system precision-first: it would rather miss a winner than commit into a known objection. Example: three sources each maxing out their support caps can lift a play to conviction A — but a single dark-pool distribution veto still blocks it; there is no amount of bullish evidence that outvotes a veto.",
  },
  {
    term: "Evidence decay (half-life)",
    aliases: ["evidence decay", "half-life", "half life", "evidence half-life", "signal decay", "decay half-life", "stale evidence"],
    category: "concept",
    definition:
      "Every piece of Cortex evidence carries its own half-life and decays exponentially from the moment its underlying reading was taken — alpha expires, so a 20-minute-old flow cluster is worth less than a fresh one, automatically. Once evidence is older than three half-lives (≤12.5% of its original weight) it self-silences: the source reports 'absent' instead of pretending a microscopic weight is an answer, which keeps recorder or reader outages visible in the verdict rather than hidden inside a stale number. Example: a wall-trend signal weighted +1.25 with a 10-minute half-life contributes about +0.62 at the 10-minute mark and is treated as absent past 30 minutes.",
  },
  {
    term: "Opening harvest",
    aliases: ["opening harvest", "opening character", "opening window read", "9:30 harvest"],
    category: "concept",
    definition:
      "The opening harvest is the Cortex source that reads the first 15 minutes of the session (9:30–9:45 ET) — the overnight gap and what price DID with it (held, drove, or faded), plus market internals (TICK/ADD) — and turns that opening character into evidence for or against a play. It deliberately reports 'not ready' before 9:45 rather than guessing from a half-formed window; the same clock that gates early commits is harvested as signal instead of wasted. Example: a gap-up that holds its gains through 9:45 with positive internals supports longs; the same gap fading back through the prior close with negative internals opposes them.",
  },
  {
    term: "Thesis-break exit",
    aliases: ["thesis break", "thesis-break", "thesis break exit", "thesis broke", "broken thesis"],
    category: "concept",
    definition:
      "An exit-engine rule for live 0DTE plays: if the evidence that justified the entry has TURNED — the Cortex read on the same play flips against it — the play exits immediately and unconditionally, even at a loss. The entry was an evidence bet, so when the evidence breaks, the reason to be in the trade is gone; waiting for the price stop to confirm what the evidence already knows just donates the difference. Example: a long committed on wall support exits the moment the supporting wall dissolves and flow turns opposing, at −12%, instead of riding to the −50% plan stop.",
  },
  {
    term: "Profit ratchet",
    aliases: ["profit ratchet", "ratchet", "ratchet floor", "runner floor", "profit floor"],
    category: "concept",
    definition:
      "The exit engine's 'green never finishes red' mechanism: once a 0DTE play is meaningfully profitable, a P&L floor latches beneath it, and the floor only ever ratchets UP as the peak grows — it never loosens. If the mark then falls back through the armed floor, the play exits with gains banked instead of round-tripping to a loss. Example: a play that peaks at +60% arms a floor; when the fade comes and the mark crosses back down through that floor, the engine closes it there — a banked winner, not a 'was up 60%, stopped out red' story.",
  },
  {
    term: "Gate calibration",
    aliases: ["gate calibration", "calibration loop", "gate calibration loop", "calibrated gates"],
    category: "concept",
    definition:
      "The learning loop that grades the 0DTE gates against what actually happened: every commit pins the gate verdicts and context (VIX open, market bias, score) on its ledger row, every block is logged, and the calibration job then measures each gate's real hit rate from the graded record — so thresholds are EARNED from outcomes, not asserted from theory. A gate that keeps blocking would-have-been winners gets exposed by its own record, as does one waving losers through. Example: the record showed day-open VIX 15–17 ran ~69% win rate while 17–20 ran ~25% — a calibration cut derived from pinned per-play context, not from a backtest guess.",
  },
  {
    term: "Counterfactual skip grading",
    aliases: ["counterfactual skip grading", "skip grading", "counterfactual", "graded skips", "counterfactual grading"],
    category: "concept",
    definition:
      "Every play the gates BLOCK gets graded as if it had been taken: entry at the first real price bar after the block, then the exact same stop/target/time-stop physics as committed plays, producing 'would have won / would have lost / ungradeable (with the reason)'. Without this, a gate that blocks losers and a gate that amputates winners look identical — both just write a rejection row. Ties grade conservatively AGAINST the skipped play, so blocked value is never inflated to pressure the gates open. Example: a ticker vetoed at 10:02 is replayed from the 10:02 bar; if it would have hit +100% before any stop, that veto is charged with a missed winner in the calibration record.",
  },
  {
    term: "Merit tiers (conviction bands)",
    aliases: ["merit tiers", "merit tier", "conviction tiers", "conviction bands", "conviction band", "a b c tiers", "tier"],
    category: "concept",
    definition:
      "The conviction/size bands a 0DTE play must EARN from evidence and the graded record — never asserted. Cortex conviction A requires roughly a structural argument plus the wall lifecycle agreeing, net of opposition (score ≥ 2); B is one real edge beyond noise (≥ 0.75); C means nothing here earns size. A vetoed play wears a C regardless of score, display is capped at A while the historical A+ tier remains mis-calibrated against outcomes, and sizing follows the same discipline: a full unit only at the conviction-A floor, half size for everything else — including 'no verdict at all'. Example: score +2.3 with no veto → A, 1× suggested size; score +1.1 → B, 0.5×; a +2.3 with one veto → blocked, and even if it somehow reached a card it would read C at 0.5×.",
  },

  // ── Night Hawk overnight edition (PR-N9) ─────────────────────────────────
  // Definitions grounded in src/features/nighthawk/lib/publish-context.ts (the pin),
  // morning-verdict-persist.ts + morning-confirm-verdict.ts (the 9:15 check + pull
  // latch), play-outcomes.ts resolveOutcome (fillability/unfilled), analytics.ts
  // (the both-directions exclusion), and docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md
  // (the N-3 detached-band class the publish gates target).
  {
    term: "Publish context (Night Hawk pin)",
    aliases: [
      "publish context",
      "publish-time pin",
      "publish pin",
      "evidence pinning",
      "pinned context",
      "decision context",
      "publish context pin",
    ],
    category: "concept",
    definition:
      "The publish context is Night Hawk's evidence pin: at the moment an edition publishes, each play's outcome row records exactly what the builder saw — spot, prior close and ATR14; the published band/target/stop with their SIGNED distances from spot (a strongly negative band distance on a LONG means the band sits below the market, the 'detached band' signature); that evening's regime, tide and breadth; catalyst knowledge (does this name report earnings into the session); and the scorer's confluence snapshot. It is written FIRST-WRITE-WINS — a later force-rebuild can update levels but can never rewrite what the original publish saw — and only values actually computed during that build are pinned (missing inputs persist as null, never re-fetched later). It's the overnight analogue of the 0DTE entry_context: the durable answer to 'why was this picked', and the substrate every calibration cut and publish gate reads. Plays published before pinning shipped carry no context — 'no decision context on record', never reconstructed.",
  },
  {
    term: "Morning confirmation (Night Hawk 9:15 check)",
    aliases: [
      "morning confirmation",
      "morning confirm",
      "morning check",
      "morning verdict",
      "pre-open check",
      "9 15 check",
      "confirmation check",
    ],
    category: "concept",
    definition:
      "The morning confirmation is Night Hawk's pre-open re-check (a ~9:15 ET cron): each published play is re-examined against the pre-market tape — the overnight SPX gap, the stock's pre-market price versus its published stop and entry band, the regime, and wall shifts — and stamped CONFIRMED, DEGRADED, INVALIDATED, or UNVERIFIED with a reason. The verdict AND the numbers it saw are persisted durably onto the play's outcome row (first-write-wins), so 'what did the morning check see' is answerable later. INVALIDATED is BINDING: it engages the one-way pulled latch (e.g. a play that gapped through its published stop pre-market is pulled, not left tradeable). DEGRADED stays advisory — a caution label, not a pull. The verdict is a one-time pre-market snapshot, not a live re-evaluation.",
  },
  {
    term: "Pulled play",
    aliases: ["pulled play", "pull latch", "pulled pick", "pulled pre-open", "invalidated play"],
    category: "concept",
    definition:
      "A pulled play is a published Night Hawk play the morning confirmation INVALIDATED before the open: a one-way latch marks it PULLED with the verdict's reason, and it stays VISIBLE at its published rank — presented as pulled and non-actionable, never hidden or deleted (the record of what was published stays intact). Its grade becomes counterfactual-only and is excluded from the headline record in BOTH directions: a pulled play that would have won adds no win, and one that would have lost adds no loss — the record only counts plays members could actually act on, and the pulled count is surfaced instead of the sample silently shrinking. The latch is one-way by design: once pulled, no later data un-pulls it.",
  },
  {
    term: "Unfilled grade (fillability)",
    aliases: ["unfilled grade", "fillability", "fillable", "unfilled play", "gap away", "no fill", "graded unfilled"],
    category: "concept",
    definition:
      "Unfilled is the grading-honesty outcome for a Night Hawk play whose session never traded back into the published entry band — a LONG that gapped above its band (or a SHORT below) offered no fill at the published entry, so grading it off that entry would book a phantom win or phantom loss. Concretely: a LONG is fillable only if the session LOW reached the top of the band; a SHORT only if the session HIGH reached the bottom. An unfillable play grades 'unfilled' and is excluded from win/loss tallies (surfaced as its own count), the same discipline as plays whose intraday data is unavailable. It exists because the honest record only counts entries a member could actually have taken.",
  },
  {
    term: "Publish gates (Night Hawk)",
    aliases: ["publish gates", "publish gate", "band sanity gate", "detached band gate", "edition gates"],
    category: "concept",
    definition:
      "The publish gates are Night Hawk's pre-publish quality checks: a candidate play must pass sanity thresholds before it can appear in an edition — headlined by the band-sanity/detached-band gate (reject or re-anchor a play whose entry band sits too far from spot, or whose target is further than the stock's ATR could plausibly reach in one session; the exact geometry the publish pin records as signed distances) alongside the existing geometry/premium checks. Status honestly: the evidence substrate the gates threshold on (the publish-context pin) is live today, and the gates themselves ship in a sibling PR — until then the pin records the detached-band signature but does not yet block on it. Fewer, more fillable plays over more plays is the deliberate trade.",
  },
  {
    term: "Night Audit",
    aliases: ["night audit", "the night audit", "overnight audit", "night audit pipeline"],
    category: "concept",
    definition:
      "The Night Audit is Night Hawk's deep post-hoc audit pipeline — IN PROGRESS, not shipped yet. The plan: replay each edition end-to-end against its durable records (the publish-context pins, the persisted morning verdicts, the pull latches, the grades) to judge not just the plays but the DECISIONS — did the publish gates block the right candidates, did the morning check catch what it should have, did conviction letters track outcomes. The substrate it needs already ships (pins, verdicts, and the pulled latch are all persisted per play); the pipeline that reads them back into a nightly audit is the in-progress half. Until it lands, honest answer: the term names planned work, and per-play records are already queryable one play at a time.",
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
