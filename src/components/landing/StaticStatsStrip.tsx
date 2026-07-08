const STATS = [
  { value: "6", label: "Desk modules", accent: "#00e676" },
  { value: "Live", label: "Tick-by-tick tape", accent: "#22d3ee" },
  { value: "A–F", label: "Graded play log", accent: "#ffd23f" },
  { value: "1", label: "Membership · all tools", accent: "#bf5fff" },
];

export function StaticStatsStrip() {
  return (
    <section className="mkt-stats-section" aria-label="Platform highlights">
      <div className="mkt-section-inner">
        <ul className="mkt-stats-grid">
          {STATS.map((s) => (
            <li key={s.label} className="mkt-stat-card">
              <span className="mkt-stat-value font-anton" style={{ color: s.accent }}>
                {s.value}
              </span>
              <span className="mkt-stat-label">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
