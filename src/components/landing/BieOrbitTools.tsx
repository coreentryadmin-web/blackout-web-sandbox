"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ProductMark, type MarkProduct } from "@/components/marks/ProductMark";
import { advanceOrbitDeg, orbitToolPixelPosition } from "./bie-viewbox-map";

export type OrbitTool = {
  name: string;
  href: string;
  mark: MarkProduct;
  accent: string;
  /** Fixed phase on the outer ring (degrees). */
  startAngleDeg: number;
};

type Props = {
  tools: OrbitTool[];
  viewW: number;
  viewH: number;
  coreX: number;
  coreY: number;
  maxRx: number;
  maxRy: number;
  orbitRing: number;
  orbitScale: number;
  /** Seconds for one full revolution of all six tools. */
  orbitPeriodSec: number;
  reduceMotion: boolean;
};

/** Six instruments ride the outermost field line — slow planetary orbit around BIE. */
export function BieOrbitTools({
  tools,
  viewW,
  viewH,
  coreX,
  coreY,
  maxRx,
  maxRy,
  orbitRing,
  orbitScale,
  orbitPeriodSec,
  reduceMotion,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const anchorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const geoRef = useRef({ viewW, viewH, coreX, coreY, maxRx, maxRy, orbitRing, orbitScale });

  useEffect(() => {
    geoRef.current = { viewW, viewH, coreX, coreY, maxRx, maxRy, orbitRing, orbitScale };
  }, [viewW, viewH, coreX, coreY, maxRx, maxRy, orbitRing, orbitScale]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let raf = 0;
    let orbitDeg = 0;
    let last = performance.now();

    const placeTools = (deg: number) => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const g = geoRef.current;

      tools.forEach((tool, i) => {
        const anchor = anchorRefs.current[i];
        if (!anchor) return;
        const px = orbitToolPixelPosition({
          startAngleDeg: tool.startAngleDeg,
          orbitDeg: deg,
          containerW: rect.width,
          containerH: rect.height,
          ...g,
        });
        anchor.style.left = `${px.x}px`;
        anchor.style.top = `${px.y}px`;
      });
    };

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!reduceMotion) {
        orbitDeg = advanceOrbitDeg(orbitDeg, dt, orbitPeriodSec);
      }
      placeTools(orbitDeg);
      raf = requestAnimationFrame(tick);
    };

    placeTools(orbitDeg);
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => placeTools(orbitDeg));
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [tools, orbitPeriodSec, reduceMotion]);

  return (
    <div ref={hostRef} className="bie-orbit-tools" aria-label="Platform instruments">
      {tools.map((tool, i) => (
        <div
          key={tool.name}
          ref={(el) => {
            anchorRefs.current[i] = el;
          }}
          className="bie-orbit-tool-anchor"
        >
          <Link
            href={tool.href}
            className="bie-orbit-tool"
            style={{ ["--tool-accent" as string]: tool.accent }}
          >
            <span className="bie-orbit-tool-mark" aria-hidden>
              <ProductMark product={tool.mark} size={34} />
            </span>
            <span className="bie-orbit-tool-name">{tool.name}</span>
          </Link>
        </div>
      ))}
    </div>
  );
}
