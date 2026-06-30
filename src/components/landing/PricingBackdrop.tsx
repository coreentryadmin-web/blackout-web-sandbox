const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Static (deterministic) ember field — `l` left%, `b` bottom%, `s` size px. Scattered
// up the lower half so they read as a frozen ember field (no per-frame motion).
const EMBERS = [
  { l: 6, b: 14, s: 3 },
  { l: 14, b: 30, s: 2 },
  { l: 22, b: 20, s: 4 },
  { l: 31, b: 42, s: 2 },
  { l: 39, b: 26, s: 3 },
  { l: 47, b: 36, s: 2 },
  { l: 55, b: 16, s: 3 },
  { l: 63, b: 32, s: 2 },
  { l: 71, b: 24, s: 4 },
  { l: 79, b: 40, s: 2 },
  { l: 86, b: 18, s: 3 },
  { l: 92, b: 28, s: 2 },
  { l: 50, b: 46, s: 3 },
  { l: 35, b: 12, s: 2 },
];

/**
 * Signature cinematic backdrop for the Pricing section — deliberately different
 * from the calm <LandingBackdrop/>: an aurora "vortex" glow behind the cards, a
 * perspective "trading-floor" grid receding to a glowing horizon, a scattered ember
 * field, a center scrim for card contrast, film grain and a top hairline.
 *
 * FULLY STATIC: every layer is painted once. The vortex no longer spins, the floor
 * grid no longer scrolls, the embers no longer float, and the scan beam is gone — so
 * the section carries zero per-frame GPU/paint cost (it previously ran four infinite
 * animations, the blur(120px) vortex spin being the heaviest). The composed look is
 * preserved. Decorative only.
 */
export function PricingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* base wash + vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -5%, rgba(8,18,16,0.7), transparent 55%), radial-gradient(100% 70% at 50% 110%, rgba(5,7,14,0.9), transparent 60%), #050608",
        }}
      />

      {/* aurora vortex glow behind the cards (static) */}
      <div
        className="absolute rounded-full"
        style={{
          top: "-34%",
          left: "50%",
          width: 1200,
          height: 1200,
          marginLeft: -600,
          filter: "blur(120px)",
          opacity: 0.16,
          background:
            "conic-gradient(from 0deg, rgba(0,230,118,0.9), transparent 24%, rgba(34,211,238,0.7) 44%, transparent 60%, rgba(124,92,255,0.6) 78%, transparent 92%, rgba(0,230,118,0.9))",
        }}
      />

      {/* perspective "trading-floor" grid receding to the horizon */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: "58%",
          perspective: "480px",
          maskImage: "linear-gradient(to top, #000 26%, transparent 92%)",
          WebkitMaskImage: "linear-gradient(to top, #000 26%, transparent 92%)",
        }}
      >
        <div
          className="absolute"
          style={{
            left: "-60%",
            right: "-60%",
            top: "-45%",
            bottom: "-60%",
            transform: "rotateX(74deg)",
            transformOrigin: "50% 100%",
            backgroundImage:
              "linear-gradient(rgba(0,230,118,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(0,230,118,0.55) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            opacity: 0.18,
          }}
        />
      </div>

      {/* glowing horizon where floor meets sky */}
      <div
        className="absolute left-0 right-0"
        style={{
          bottom: "58%",
          height: 2,
          background: "linear-gradient(90deg, transparent, #00e676, transparent)",
          opacity: 0.55,
          boxShadow: "0 0 40px 8px rgba(0,230,118,0.45)",
        }}
      />
      <div
        className="absolute left-1/2"
        style={{
          bottom: "50%",
          width: "70%",
          height: 180,
          marginLeft: "-35%",
          filter: "blur(70px)",
          opacity: 0.2,
          background: "radial-gradient(closest-side, #00e676, transparent)",
        }}
      />

      {/* scattered ember field (static) */}
      {EMBERS.map((e, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${e.l}%`,
            bottom: `${e.b}%`,
            width: e.s,
            height: e.s,
            background: "#34d399",
            boxShadow: "0 0 8px #00e676",
            opacity: 0.55,
          }}
        />
      ))}

      {/* center scrim — keeps card text crisp over the busy backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(58% 48% at 50% 52%, rgba(5,6,8,0.6), transparent 72%)" }}
      />

      {/* film grain */}
      <div className="absolute inset-0 opacity-[0.05]" style={{ mixBlendMode: "soft-light", backgroundImage: NOISE }} />

      {/* top hairline */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(0,230,118,0.4), transparent)" }}
      />
    </div>
  );
}
