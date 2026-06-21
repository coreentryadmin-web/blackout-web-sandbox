"use client";

// Animated DNA helix wallpaper for the HELIX flows page.
// Image: place your DNA helix PNG at /public/dna-helix.png

export function DnaHelixBackground() {
  return (
    <div
      className="fixed inset-0 pointer-events-none select-none overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden
    >
      {/* Rotating helix image */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          animation: "dna-helix-drift 50s linear infinite, dna-helix-breathe 12s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      >
        <img
          src="/dna-helix.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover"
          style={{
            filter: "saturate(1.3) brightness(0.9) blur(0.3px)",
            userSelect: "none",
          }}
        />
      </div>

      {/* Radial vignette — fades helix toward edges so data is always readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 75% at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.92) 100%)",
        }}
      />

      {/* Bottom fade — keeps filter bar clean */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48"
        style={{
          background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.9))",
        }}
      />

      {/* Top fade */}
      <div
        className="absolute top-0 left-0 right-0 h-24"
        style={{
          background: "linear-gradient(to top, transparent, rgba(0,0,0,0.85))",
        }}
      />

      {/* Blue tint overlay — ties the helix cyan into the HELIX brand palette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 50% 60% at 50% 50%, rgba(0,100,255,0.04) 0%, transparent 70%)",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
