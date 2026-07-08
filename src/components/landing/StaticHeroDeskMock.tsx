/** CSS-only hero desk preview — matrix rail + flow strip, no images/JS. */
export function StaticHeroDeskMock() {
  return (
    <div className="mkt-hero-mock" aria-hidden>
      <div className="mkt-hero-mock-chrome">
        <span className="mkt-terminal-dot mkt-terminal-dot-red" />
        <span className="mkt-terminal-dot mkt-terminal-dot-amber" />
        <span className="mkt-terminal-dot mkt-terminal-dot-green" />
        <span className="mkt-hero-mock-title">SPX · 0DTE · LIVE</span>
        <span className="mkt-hero-mock-badge">BIE ✓</span>
      </div>
      <div className="mkt-hero-mock-body">
        <div className="mkt-hero-mock-spot">
          <span className="mkt-hero-mock-spot-label">SPX</span>
          <span className="mkt-hero-mock-spot-val">6,028.40</span>
          <span className="mkt-hero-mock-spot-delta">+12.6</span>
        </div>
        <div className="mkt-hero-mock-matrix">
          {[
            ["6020", "−2.1M", "bull"],
            ["6025", "+4.8M", "bear"],
            ["6030", "+1.2M", "bull"],
            ["6035", "−0.6M", "bear"],
            ["6040", "+2.4M", "bull"],
            ["6045", "−1.1M", "bear"],
          ].map(([strike, gex, tone]) => (
            <div key={strike} className={`mkt-hero-mock-row mkt-hero-mock-row-${tone}`}>
              <span>{strike}</span>
              <span>{gex}</span>
              <span className="mkt-hero-mock-bar" />
            </div>
          ))}
        </div>
        <div className="mkt-hero-mock-flow">
          <div className="mkt-hero-mock-flow-line flow">
            <span>HELIX</span>
            <span>SPXW 6030C · $1.2M sweep</span>
          </div>
          <div className="mkt-hero-mock-flow-line alert">
            <span>ALERT</span>
            <span>Graded B+ · pin lift · tape confirms</span>
          </div>
        </div>
      </div>
    </div>
  );
}
