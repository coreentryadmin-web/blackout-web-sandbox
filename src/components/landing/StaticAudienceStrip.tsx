const AUDIENCES = [
  { label: "0DTE index traders", accent: "#00e676" },
  { label: "Options flow hunters", accent: "#22d3ee" },
  { label: "Swing & overnight desks", accent: "#bf5fff" },
  { label: "Gamma-aware scalpers", accent: "#ffd23f" },
  { label: "AI-assisted analysts", accent: "#ff6b2b" },
];

/** Who the desk is for — Skylit-style audience pills, zero JS. */
export function StaticAudienceStrip() {
  return (
    <section className="mkt-section mkt-audience-section border-b-0 py-10 md:py-12">
      <div className="mkt-section-inner text-center">
        <p className="mkt-kicker justify-center">
          <span className="mkt-kicker-dot" aria-hidden />
          Built for focused traders
        </p>
        <ul className="mkt-audience-pills">
          {AUDIENCES.map((a) => (
            <li key={a.label}>
              <span className="mkt-audience-pill" style={{ borderColor: `${a.accent}44`, color: a.accent }}>
                {a.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
