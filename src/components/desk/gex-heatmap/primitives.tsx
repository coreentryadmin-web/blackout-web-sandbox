/** Hollow diamond SVG — marks the dominant dealer-gamma anchor cell in the heatmap matrix. */
export function AnchorGlyph({ size = 11, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
      style={{ display: "inline-block", verticalAlign: "-0.12em" }}
    >
      <path
        d="M12 2.5L21.5 12L12 21.5L2.5 12Z"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** Small panel header label above paired heatmap views. */
export function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300">
      {children}
    </div>
  );
}
