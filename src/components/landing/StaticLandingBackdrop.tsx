const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** CSS-only institutional backdrop — no framer-motion, no client JS. */
export function StaticLandingBackdrop({ showChart = true }: { showChart?: boolean }) {
  return (
    <div aria-hidden className="mkt-backdrop pointer-events-none absolute inset-0 overflow-hidden">
      <div className="mkt-backdrop-wash absolute inset-0" />
      <div className="mkt-orb mkt-orb-emerald" />
      <div className="mkt-orb mkt-orb-cyan" />
      <div className="mkt-orb mkt-orb-violet" />
      <div className="mkt-grid mkt-grid-drift absolute inset-0" />
      {showChart && (
        <svg className="mkt-chart-silhouette absolute bottom-0 left-0 h-[42%] w-full" viewBox="0 0 1440 240" preserveAspectRatio="none" fill="none">
          <defs>
            <linearGradient id="mktLbArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e676" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,205 L90,195 L180,200 L270,175 L360,188 L450,160 L540,178 L630,150 L720,168 L810,140 L900,162 L990,135 L1080,156 L1170,128 L1260,150 L1350,122 L1440,145"
            stroke="#1d9e75"
            strokeWidth="1.5"
            strokeOpacity="0.35"
          />
          <path
            d="M0,205 L90,195 L180,200 L270,175 L360,188 L450,160 L540,178 L630,150 L720,168 L810,140 L900,162 L990,135 L1080,156 L1170,128 L1260,150 L1350,122 L1440,145 L1440,240 L0,240 Z"
            fill="url(#mktLbArea)"
          />
        </svg>
      )}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{ backgroundImage: NOISE, backgroundSize: "160px 160px" }}
      />
      <div className="mkt-hairline absolute inset-x-0 top-0 h-px" />
    </div>
  );
}
