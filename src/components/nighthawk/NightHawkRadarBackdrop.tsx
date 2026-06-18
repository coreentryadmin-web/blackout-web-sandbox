"use client";

import { useEffect, useState } from "react";

const SCAN_TICKERS = ["NVDA", "TSLA", "SPY", "QQQ", "AAPL", "AMD", "META", "MSFT", "AMZN", "GOOGL", "IWM", "SMCI"];

type Blip = { id: number; x: number; y: number; ticker: string };

export function NightHawkRadarBackdrop() {
  const [angle, setAngle] = useState(0);
  const [blips, setBlips] = useState<Blip[]>([]);

  useEffect(() => {
    const spin = window.setInterval(() => setAngle((a) => (a + 2.5) % 360), 50);
    return () => window.clearInterval(spin);
  }, []);

  useEffect(() => {
    const ping = window.setInterval(() => {
      const id = Date.now();
      const ticker = SCAN_TICKERS[Math.floor(Math.random() * SCAN_TICKERS.length)]!;
      setBlips((prev) => [
        ...prev.slice(-7),
        {
          id,
          x: 8 + Math.random() * 84,
          y: 8 + Math.random() * 84,
          ticker,
        },
      ]);
      window.setTimeout(() => {
        setBlips((prev) => prev.filter((b) => b.id !== id));
      }, 2800);
    }, 1600);
    return () => window.clearInterval(ping);
  }, []);

  return (
    <div className="nighthawk-radar-backdrop" aria-hidden>
      <div className="nighthawk-radar-vignette" />
      <div className="nighthawk-radar-grid" />

      <div className="nighthawk-radar-stage">
        <div className="nighthawk-radar-scope">
          {[1, 0.85, 0.7, 0.55, 0.4, 0.25].map((scale) => (
            <div
              key={scale}
              className="nighthawk-radar-ring"
              style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}
            />
          ))}

          <div className="nighthawk-radar-crosshair-h" />
          <div className="nighthawk-radar-crosshair-v" />

          <div
            className="nighthawk-radar-sweep"
            style={{ transform: `rotate(${angle}deg)` }}
          />

          {blips.map((blip) => (
            <div
              key={blip.id}
              className="nighthawk-radar-blip"
              style={{ left: `${blip.x}%`, top: `${blip.y}%` }}
            >
              <span className="nighthawk-radar-blip-label">{blip.ticker}</span>
            </div>
          ))}

          <div className="nighthawk-radar-core" />
        </div>
      </div>
    </div>
  );
}
