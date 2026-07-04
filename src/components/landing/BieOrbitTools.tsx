"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ProductMark, type MarkProduct } from "@/components/marks/ProductMark";
import { fieldLineScale } from "./bie-helix-engine";
import { buildRandomOrbitLayout, readSessionOrbitSeed, type PlacedOrbitTool } from "./bie-orbit-layout";
import { advanceOrbitDeg, orbitToolPixelPosition } from "./bie-viewbox-map";

export type OrbitTool = {
  name: string;
  href: string;
  mark: MarkProduct;
  accent: string;
};

type Props = {
  tools: OrbitTool[];
  viewW: number;
  viewH: number;
  coreX: number;
  coreY: number;
  maxRx: number;
  maxRy: number;
  reduceMotion: boolean;
};

type ToolMotion = {
  orbitDeg: number;
};

const RING_SCALES = {
  4: fieldLineScale(4),
  5: fieldLineScale(5),
  6: fieldLineScale(6),
} as const;

/** Six instruments on rings 4/5/6 — two per ellipse, random layout per session. */
export function BieOrbitTools({
  tools,
  viewW,
  viewH,
  coreX,
  coreY,
  maxRx,
  maxRy,
  reduceMotion,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const anchorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const geoRef = useRef({ viewW, viewH, coreX, coreY, maxRx, maxRy });

  const [layout, setLayout] = useState<PlacedOrbitTool[] | null>(null);

  useEffect(() => {
    const seed = readSessionOrbitSeed();
    setLayout(buildRandomOrbitLayout(tools, RING_SCALES, seed));
  }, [tools]);

  useEffect(() => {
    geoRef.current = { viewW, viewH, coreX, coreY, maxRx, maxRy };
  }, [viewW, viewH, coreX, coreY, maxRx, maxRy]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !layout?.length) return;

    const motion: ToolMotion[] = layout.map(() => ({ orbitDeg: 0 }));

    let raf = 0;
    let last = performance.now();

    const placeTools = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const g = geoRef.current;

      layout.forEach((tool, i) => {
        const anchor = anchorRefs.current[i];
        if (!anchor) return;
        const m = motion[i];
        const px = orbitToolPixelPosition({
          startAngleDeg: tool.startAngleDeg,
          orbitDeg: m.orbitDeg,
          coreX: g.coreX,
          coreY: g.coreY,
          maxRx: g.maxRx,
          maxRy: g.maxRy,
          orbitRing: tool.orbitRing,
          orbitScale: tool.orbitScale,
          viewW: g.viewW,
          viewH: g.viewH,
          containerW: rect.width,
          containerH: rect.height,
        });
        anchor.style.left = `${px.x}px`;
        anchor.style.top = `${px.y}px`;
      });
    };

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      if (!reduceMotion) {
        layout.forEach((tool, i) => {
          motion[i].orbitDeg = advanceOrbitDeg(
            motion[i].orbitDeg,
            dt,
            tool.orbitPeriodSec,
            tool.orbitDirection
          );
        });
      }

      placeTools();
      raf = requestAnimationFrame(tick);
    };

    placeTools();
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => placeTools());
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [layout, reduceMotion]);

  return (
    <div ref={hostRef} className="bie-orbit-tools" aria-label="Platform instruments">
      {layout?.map((tool, i) => (
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
            title={tool.name}
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

export type { PlacedOrbitTool };
