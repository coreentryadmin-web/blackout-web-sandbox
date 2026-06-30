/**
 * GridLiveBackground — the BlackOut Grid's ambient, living backdrop. A moving
 * multi-colored neon grid (the colour flows through the lattice, the lattice drifts),
 * with two parallax layers, slow-drifting colour blooms, and a vignette. Pure CSS /
 * GPU transforms; honours prefers-reduced-motion (animations pause). Decorative only.
 */
export function GridLiveBackground() {
  return (
    <div aria-hidden className="grid-live-bg pointer-events-none absolute inset-0 z-0">
      <div className="grid-live-blooms" />
      <div className="grid-live-lattice grid-live-lattice--far" />
      <div className="grid-live-lattice grid-live-lattice--near" />
      <div className="grid-live-scan" />
      <div className="grid-live-vignette" />
    </div>
  );
}
