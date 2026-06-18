"use client";

const TICKER_A = [
  "FLOW ALERTS LIVE",
  "SPX 0DTE",
  "GEX FLIP",
  "DARK POOL",
  "WHALE DETECTED",
  "NIGHT HAWK",
  "LARGO ONLINE",
  "93K+ SIGNALS",
];

const TICKER_B = [
  "EXECUTE",
  "DOMINATE",
  "NO GUESSING",
  "DEALER GAMMA",
  "MAX PAIN",
  "IV CRUSH",
  "SWING PLAYS",
  "BLACKOUT",
];

type MarqueeStripProps = {
  items: string[];
  direction?: "left" | "right";
  variant?: "green" | "dark" | "red";
  dimmed?: boolean;
  small?: boolean;
};

const variantStyles = {
  green: "bg-bull text-black border-y border-bull",
  dark: "bg-black text-bull border-y border-bull/30",
  red: "bg-bear/10 text-bear border-y border-bear/30",
};

export function MarqueeStrip({
  items,
  direction = "left",
  variant = "green",
  dimmed = false,
  small = false,
}: MarqueeStripProps) {
  const doubled = [...items, ...items];
  return (
    <div
      className={`overflow-hidden whitespace-nowrap py-4 landing-marquee-strip ${variantStyles[variant]} ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div className={`inline-flex gap-8 ${direction === "left" ? "marquee-left" : "marquee-right"}`}>
        {doubled.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className={`inline-flex items-center gap-8 font-mono tracking-[0.25em] uppercase font-semibold shrink-0 ${
              small ? "text-[9px]" : "text-xs md:text-sm"
            }`}
          >
            {item}
            <span className="landing-marquee-dot opacity-80" style={{ textShadow: "0 0 8px #00e676" }}>
              ◆
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function MarqueeBlock() {
  return (
    <div className="landing-section landing-section-cut relative z-30">
      <MarqueeStrip items={TICKER_A} direction="left" variant="green" />
      <MarqueeStrip items={TICKER_A} direction="right" variant="green" dimmed small />
      <MarqueeStrip items={TICKER_B} direction="right" variant="dark" dimmed />
    </div>
  );
}
