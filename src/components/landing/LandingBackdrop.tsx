const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * Reusable layered "institutional" backdrop for landing sections — kills the flat
 * black void with depth: a tinted vignette wash, three slow-drifting aurora orbs
 * (emerald / cyan / violet), a masked grid, an on-brand market-chart silhouette,
 * fine film grain, and a crisp top hairline. Place inside a `relative overflow-hidden`
 * section; it sits behind content (pointer-events-none). Orb motion auto-respects
 * reduced-motion via the root MotionConfig.
 */
export function LandingBackdrop({ showChart = true }: { showChart?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* base wash + vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(125% 90% at 50% -10%, rgba(8,20,17,0.85), transparent 55%), radial-gradient(100% 80% at 50% 115%, rgba(6,10,20,0.9), transparent 60%)",
        }}
      />
      {/* aurora orbs — STATIC (was 3 infinite framer-motion loops, each re-compositing a
          blur(150px) layer every frame; the ±30px/34–50s drift was imperceptible, so we
          paint them once for a big GPU saving on the landing). */}
      <div
        className="absolute rounded-full"
        style={{ top: "-16%", right: "-8%", height: 640, width: 640, filter: "blur(150px)", background: "radial-gradient(closest-side, #00e676, transparent)", opacity: 0.15 }}
      />
      <div
        className="absolute rounded-full"
        style={{ bottom: "-20%", left: "-10%", height: 560, width: 560, filter: "blur(150px)", background: "radial-gradient(closest-side, #22d3ee, transparent)", opacity: 0.1 }}
      />
      <div
        className="absolute rounded-full"
        style={{ bottom: "-26%", left: "42%", height: 520, width: 520, filter: "blur(160px)", background: "radial-gradient(closest-side, #7c5cff, transparent)", opacity: 0.08 }}
      />
      {/* institutional grid */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,230,118,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,230,118,0.6) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 75% 65% at 50% 38%, #000 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 65% at 50% 38%, #000 30%, transparent 78%)",
        }}
      />
      {/* market-chart silhouette */}
      {showChart && (
        <svg className="absolute bottom-0 left-0 w-full h-[42%]" viewBox="0 0 1440 240" preserveAspectRatio="none" fill="none">
          <defs>
            <linearGradient id="lbArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e676" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,205 L90,195 L180,200 L270,175 L360,188 L450,160 L540,178 L630,150 L720,168 L810,140 L900,162 L990,135 L1080,156 L1170,128 L1260,150 L1350,122 L1440,145"
            stroke="#1d9e75"
            strokeOpacity="0.16"
            strokeWidth="1.5"
          />
          <path
            d="M0,180 L80,160 L160,172 L240,128 L320,150 L400,104 L480,126 L560,88 L640,110 L720,70 L800,98 L880,58 L960,84 L1040,46 L1120,72 L1200,36 L1280,60 L1360,28 L1440,50 L1440,240 L0,240 Z"
            fill="url(#lbArea)"
          />
          <path
            d="M0,180 L80,160 L160,172 L240,128 L320,150 L400,104 L480,126 L560,88 L640,110 L720,70 L800,98 L880,58 L960,84 L1040,46 L1120,72 L1200,36 L1280,60 L1360,28 L1440,50"
            stroke="#00e676"
            strokeOpacity="0.28"
            strokeWidth="1.75"
          />
        </svg>
      )}
      {/* film grain */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{ mixBlendMode: "soft-light", backgroundImage: NOISE }}
      />
      {/* top hairline */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(0,230,118,0.4), transparent)" }}
      />
    </div>
  );
}
