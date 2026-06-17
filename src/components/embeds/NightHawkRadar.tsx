"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { EmbedFrame } from "./EmbedFrame";

const SCAN_TICKERS = ["NVDA", "TSLA", "SPY", "QQQ", "AAPL", "AMD", "META", "MSFT"];

export function NightHawkRadar() {
  const [angle, setAngle] = useState(0);
  const [blips, setBlips] = useState<Array<{ id: number; x: number; y: number; ticker: string }>>([]);

  useEffect(() => {
    const spin = window.setInterval(() => setAngle((a) => (a + 3) % 360), 50);
    return () => window.clearInterval(spin);
  }, []);

  useEffect(() => {
    const ping = window.setInterval(() => {
      const id = Date.now();
      const ticker = SCAN_TICKERS[Math.floor(Math.random() * SCAN_TICKERS.length)];
      setBlips((prev) => [
        ...prev.slice(-5),
        {
          id,
          x: 20 + Math.random() * 60,
          y: 20 + Math.random() * 60,
          ticker,
        },
      ]);
      window.setTimeout(() => {
        setBlips((prev) => prev.filter((b) => b.id !== id));
      }, 2400);
    }, 1800);
    return () => window.clearInterval(ping);
  }, []);

  return (
    <EmbedFrame title="Swing Scanner" subtitle="2–10 DTE radar" variant="radar">
      <div className="relative h-[280px] md:h-[320px] overflow-hidden bg-[#050505]">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="radar-scope">
            {[1, 0.75, 0.5, 0.25].map((scale) => (
              <div
                key={scale}
                className="radar-ring"
                style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}
              />
            ))}
            <div
              className="radar-sweep"
              style={{ transform: `rotate(${angle}deg)` }}
            />
            {blips.map((blip) => (
              <div
                key={blip.id}
                className="radar-blip"
                style={{ left: `${blip.x}%`, top: `${blip.y}%` }}
              >
                <span className="radar-blip-label">{blip.ticker}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex justify-between font-mono text-[9px] text-bear/80 uppercase tracking-widest">
          <span>Scan active</span>
          <span className={clsx("animate-pulse")}>Acquiring targets</span>
        </div>
      </div>
    </EmbedFrame>
  );
}
