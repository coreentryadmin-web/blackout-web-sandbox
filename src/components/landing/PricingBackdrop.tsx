const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Static (deterministic) ember field — no Math.random so SSR/CSR markup matches.
const EMBERS = [
  { l: 6, d: 0, t: 9, s: 3 },
  { l: 14, d: 2.1, t: 11, s: 2 },
  { l: 22, d: 4.5, t: 8, s: 4 },
  { l: 31, d: 1.2, t: 12, s: 2 },
  { l: 39, d: 6.0, t: 10, s: 3 },
  { l: 47, d: 3.3, t: 9.5, s: 2 },
  { l: 55, d: 5.5, t: 11, s: 3 },
  { l: 63, d: 0.8, t: 8.5, s: 2 },
  { l: 71, d: 4.0, t: 12, s: 4 },
  { l: 79, d: 2.6, t: 10, s: 2 },
  { l: 86, d: 6.5, t: 9, s: 3 },
  { l: 92, d: 1.6, t: 11.5, s: 2 },
  { l: 50, d: 7.2, t: 13, s: 3 },
  { l: 35, d: 8.0, t: 10.5, s: 2 },
];

/**
 * Signature cinematic backdrop for the Pricing section — deliberately different
 * from the calm <LandingBackdrop/>: a rotating aurora "vortex" behind the cards,
 * an infinite perspective "trading-floor" grid receding to a glowing horizon,
 * floating embers, a center scrim for card contrast, film grain and a top hairline.
 * Animations use CSS keyframes (see globals.css) and self-disable under
 * prefers-reduced-motion via the `.pricing-anim` class.
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

      {/* rotating aurora vortex behind the cards */}
      <div
        className="pricing-anim absolute rounded-full"
        style={{
          top: "-34%",
          left: "50%",
          width: 1200,
          height: 1200,
          marginLeft: -600,
          filter: "blur(120px)",
          opacity: 0.16,
          animation: "pricing-vortex-spin 56s linear infinite",
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
          className="pricing-anim absolute"
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
            animation: "pricing-grid-scroll 2.6s linear infinite",
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

      {/* floating embers */}
      {EMBERS.map((e, i) => (
        <span
          key={i}
          className="pricing-anim absolute rounded-full"
          style={{
            left: `${e.l}%`,
            bottom: "8%",
            width: e.s,
            height: e.s,
            background: "#34d399",
            boxShadow: "0 0 8px #00e676",
            opacity: 0,
            animation: `pricing-ember-float ${e.t}s ease-in-out ${e.d}s infinite`,
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
