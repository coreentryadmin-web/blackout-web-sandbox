"use client";

const TICKER_A = [
  "FLOW ALERTS LIVE",
  "SPX 0DTE ARMED",
  "GEX FLIP",
  "DARK POOL PRINT",
  "WHALE DETECTED",
  "NIGHT HAWK SCANNING",
  "LARGO ONLINE",
];

type MarqueeStripProps = {
  items: string[];
  direction?: "left" | "right";
  variant?: "green" | "dark" | "red";
  dimmed?: boolean;
  small?: boolean;
};

const variantStyles = {
  // Refined "ticker tape": deep void bar with glowing green mono text + hairline borders.
  // Reads institutional vs the old solid-neon highlighter bar.
  green: "bg-[#05070b] text-bull border-y border-bull/25",
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
              small ? "text-[10px]" : "text-xs md:text-sm"
            }`}
          >
            {item}
            <span className="landing-marquee-dot text-mute/60" aria-hidden>
              ·
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
    </div>
  );
}
