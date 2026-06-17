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
};

const variantStyles = {
  green: "bg-bull text-black border-y border-bull",
  dark: "bg-black text-bull border-y border-bull/30",
  red: "bg-bear/10 text-bear border-y border-bear/30",
};

export function MarqueeStrip({ items, direction = "left", variant = "green" }: MarqueeStripProps) {
  const doubled = [...items, ...items];
  return (
    <div className={`overflow-hidden whitespace-nowrap py-2.5 ${variantStyles[variant]}`}>
      <div className={`inline-flex gap-8 ${direction === "left" ? "marquee-left" : "marquee-right"}`}>
        {doubled.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="inline-flex items-center gap-8 font-mono text-[11px] md:text-xs tracking-[0.25em] uppercase font-semibold shrink-0"
          >
            {item}
            <span className="opacity-40">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function MarqueeBlock() {
  return (
    <div className="relative z-30">
      <MarqueeStrip items={TICKER_A} direction="left" variant="green" />
      <MarqueeStrip items={TICKER_B} direction="right" variant="dark" />
    </div>
  );
}
