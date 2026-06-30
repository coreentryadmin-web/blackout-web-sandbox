// Static onboarding + options-education content and pure helpers.
// Alias-free and side-effect-free so it runs under `npx tsx --test`.
// No money-path, no network, no env. Pure data + localStorage helpers.

export type OnboardingStep = {
  /** Stable id used for analytics/anchors. */
  id: string;
  /** Short uppercase kicker (mono). */
  kicker: string;
  /** Step title. */
  title: string;
  /** 1-2 sentence plain-English explanation for a new trader. */
  body: string;
  /** Optional internal route this step is about (deep-link target). */
  href?: string;
  /** Optional CTA label paired with href. */
  cta?: string;
};

export type GlossaryTerm = {
  term: string;
  def: string;
};

/** Versioned so re-onboarding can be forced by bumping the number. */
export const ONBOARDING_VERSION = 2;

/** localStorage key holding the completed/dismissed version (string number). */
export const ONBOARDING_STORAGE_KEY = "blackout:onboarding:v";

/** Window event other components dispatch to (re)open the guide. */
export const ONBOARDING_OPEN_EVENT = "blackout:open-onboarding";

/** Guided tour of the platform — keep aligned with Nav FEATURE_LINKS. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "welcome",
    kicker: "Briefing",
    title: "Welcome to BlackOut",
    body: "BlackOut is a market-intelligence desk, not a broker. We surface institutional flow, dealer positioning, and live structure so you are never flying blind on the setup. You place every trade on your own broker. Nothing here is financial advice — it is education and pattern recognition.",
  },
  {
    id: "spx",
    kicker: "SPX · 0DTE desk",
    title: "SPX Slayer",
    body: "Live 0DTE SPX desk: GEX walls, VWAP, regime detection, and dealer positioning. Watch the levels; wait for the setup; the desk surfaces structure as it aligns — before price moves.",
    href: "/dashboard",
    cta: "Open SPX Slayer",
  },
  {
    id: "flows",
    kicker: "Institutional flow",
    title: "HELIX Flow Feed",
    body: "Real-time whale and dark-pool options flow. Large premium prints show where size is positioning — use it as confirmation, not as a signal on its own.",
    href: "/flows",
    cta: "Open HELIX",
  },
  {
    id: "heatmap",
    kicker: "Dealer positioning",
    title: "BlackOut Thermal",
    body: "Dealer positioning by strike — GEX, VEX, DEX and charm. See the gamma walls, the flip level, and where dealer flow is forced to pin or repel price, so you read the regime before you trade it.",
    href: "/heatmap",
    cta: "Open Thermal",
  },
  {
    id: "largo",
    kicker: "Largo AI",
    title: "Largo AI Terminal",
    body: "Ask Largo about any ticker. It reads live flow, GEX, VWAP, news, and analyst ratings, then answers like a desk trader — a research partner, not a chatbot.",
    href: "/terminal",
    cta: "Open Largo",
  },
  {
    id: "nighthawk",
    kicker: "Night Hawk",
    title: "Night Hawk Scanner",
    body: "Your AI evening playbook. After the close, Night Hawk publishes an edition of ranked next-session swing and leap setups, each with a per-ticker dossier — so you walk into tomorrow with a plan instead of a blank chart.",
    href: "/nighthawk",
    cta: "Open Night Hawk",
  },
  {
    id: "nights-watch",
    kicker: "Position manager",
    title: "Night's Watch",
    body: "Once you're in a trade, Night's Watch tracks it for you — live valuation on your options positions and a plain-English verdict on whether the structure still backs the trade or it's time to step out. You'll find it on the Night Hawk page.",
    href: "/nighthawk",
    cta: "Open Night's Watch",
  },
  {
    id: "finish",
    kicker: "You're set",
    title: "Trade with structure",
    body: "That covers the desk. Open SPX Slayer or ask Largo about a ticker. Reopen this guide any time from Learn in the nav.",
  },
];

/** Plain-English options glossary for brand-new traders. */
export const OPTIONS_GLOSSARY: readonly GlossaryTerm[] = [
  { term: "Call / Put", def: "A call profits when price rises; a put profits when price falls. Both are contracts, not the underlying shares." },
  { term: "0DTE", def: "Zero days to expiration — options expiring today. Fast-moving and high-risk; small moves swing the price hard." },
  { term: "Strike", def: "The price at which an option can be exercised. SPX strikes are quoted in 5-point increments on the desk." },
  { term: "GEX / Gamma walls", def: "Where dealer gamma exposure concentrates. High-gamma strikes often act as magnets or walls that pin or repel price." },
  { term: "VWAP", def: "Volume-weighted average price — the session’s fair-value line. Price above is generally bullish intraday, below bearish." },
  { term: "Premium", def: "The cost to buy (or income from selling) an option. Large premium prints in HELIX flag institutional size." },
  { term: "Dark pool", def: "Off-exchange block trades. Big dark-pool prints hint at where large players are accumulating or distributing." },
  { term: "IV", def: "Implied volatility — the market’s expected movement. Higher IV means richer (more expensive) option premiums." },
];

/** Parse a stored version flag. Returns 0 for missing/garbage. */
export function parseStoredVersion(raw: string | null): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when the user has already completed/dismissed the current version. */
export function isOnboardingComplete(
  raw: string | null,
  version: number = ONBOARDING_VERSION
): boolean {
  return parseStoredVersion(raw) >= version;
}

/** The value to persist once the guide is completed/dismissed. */
export function completedStorageValue(version: number = ONBOARDING_VERSION): string {
  return String(version);
}

/** Clamp a step index into the valid range for the steps array. */
export function clampStepIndex(index: number, total: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  if (index > total - 1) return Math.max(0, total - 1);
  return Math.floor(index);
}

export function isFirstStep(index: number): boolean {
  return index <= 0;
}

export function isLastStep(index: number, total: number): boolean {
  return index >= total - 1;
}
