/**
 * GridLiveBackground — the BlackOut Grid's ambient backdrop: a multi-colored neon
 * lattice over two parallax depths, a colour-bloom wash, and a vignette. Fully STATIC
 * (painted once) — no colour-flow repaint or transform drift — so it carries zero
 * per-frame GPU/paint cost and keeps the Grid fast. The full spectrum spans the
 * viewport at rest, so the look is preserved without motion. Decorative only.
 */
export function GridLiveBackground() {
  return (
    <div aria-hidden className="grid-live-bg pointer-events-none absolute inset-0 z-0">
      <div className="grid-live-blooms" />
      <div className="grid-live-lattice grid-live-lattice--far" />
      <div className="grid-live-lattice grid-live-lattice--near" />
      <div className="grid-live-vignette" />
    </div>
  );
}
