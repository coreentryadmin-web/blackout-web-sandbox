"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProductMark, type MarkProduct } from "@/components/marks/ProductMark";
import { fieldLineScale } from "./bie-helix-engine";
import {
  advancePulseT,
  buildMeshEdges,
  connectorPulseOpacity,
  connectorPulsePosition,
  ECOSYSTEM_LOOP_PERIOD_SEC,
  loopSegmentIndex,
  loopSegmentLocalT,
  outboundPulsePhaseForIndex,
  pulsePeriodSecForIndex,
  pulsePhaseForIndex,
} from "./bie-orbit-connectors";
import { buildOrbitLayout, readSessionOrbitSeed, type PlacedOrbitTool } from "./bie-orbit-layout";
import { advanceOrbitDeg, orbitToolPixelPosition, viewBoxPointToContainer } from "./bie-viewbox-map";

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
  /** tool -> core (raw telemetry in). */
  pulseInT: number;
  /** core -> tool (verified intelligence back out), half a cycle out of phase with pulseInT. */
  pulseOutT: number;
};

const RING_SCALES = {
  1: fieldLineScale(1),
  2: fieldLineScale(2),
  3: fieldLineScale(3),
  4: fieldLineScale(4),
  5: fieldLineScale(5),
  6: fieldLineScale(6),
} as const;

/** Six instruments — one per field ellipse (rings 1–6), fixed compass anchors. */
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
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const pulseInRefs = useRef<(SVGCircleElement | null)[]>([]);
  const pulseOutRefs = useRef<(SVGCircleElement | null)[]>([]);
  const meshLineRefs = useRef<(SVGLineElement | null)[]>([]);
  const loopPulseRef = useRef<SVGCircleElement | null>(null);
  const geoRef = useRef({ viewW, viewH, coreX, coreY, maxRx, maxRy });

  const [layout, setLayout] = useState<PlacedOrbitTool[] | null>(null);

  const meshEdges = useMemo(() => (layout ? buildMeshEdges(layout.length) : []), [layout]);

  useEffect(() => {
    const seed = readSessionOrbitSeed();
    setLayout(buildOrbitLayout(tools, RING_SCALES, seed));
  }, [tools]);

  useEffect(() => {
    geoRef.current = { viewW, viewH, coreX, coreY, maxRx, maxRy };
  }, [viewW, viewH, coreX, coreY, maxRx, maxRy]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !layout?.length) return;

    const motion: ToolMotion[] = layout.map((_, i) => ({
      orbitDeg: 0,
      pulseInT: pulsePhaseForIndex(i, layout.length),
      pulseOutT: outboundPulsePhaseForIndex(i, layout.length),
    }));
    const loopMotion = { t: 0 };
    const edges = meshEdges;

    let raf = 0;
    let last = performance.now();

    const placeTools = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const g = geoRef.current;

      const corePx = viewBoxPointToContainer(g.coreX, g.coreY, rect.width, rect.height, g.viewW, g.viewH, "meet");
      const positions: { x: number; y: number }[] = [];

      layout.forEach((tool, i) => {
        const anchor = anchorRefs.current[i];
        const m = motion[i];
        const px = orbitToolPixelPosition({
          startAngleDeg: tool.startAngleDeg,
          orbitDeg: m.orbitDeg,
          oscillationAmplitudeDeg: tool.oscillationAmplitudeDeg,
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
        positions[i] = px;
        if (!anchor) return;
        anchor.style.left = `${px.x}px`;
        anchor.style.top = `${px.y}px`;

        const line = lineRefs.current[i];
        if (line) {
          line.setAttribute("x1", corePx.x.toFixed(1));
          line.setAttribute("y1", corePx.y.toFixed(1));
          line.setAttribute("x2", px.x.toFixed(1));
          line.setAttribute("y2", px.y.toFixed(1));
        }

        if (!reduceMotion) {
          const pulseIn = pulseInRefs.current[i];
          if (pulseIn) {
            const p = connectorPulsePosition(px, corePx, m.pulseInT); // tool -> core
            pulseIn.setAttribute("cx", p.x.toFixed(1));
            pulseIn.setAttribute("cy", p.y.toFixed(1));
            pulseIn.setAttribute("opacity", connectorPulseOpacity(m.pulseInT).toFixed(3));
          }

          const pulseOut = pulseOutRefs.current[i];
          if (pulseOut) {
            const p = connectorPulsePosition(corePx, px, m.pulseOutT); // core -> tool
            pulseOut.setAttribute("cx", p.x.toFixed(1));
            pulseOut.setAttribute("cy", p.y.toFixed(1));
            pulseOut.setAttribute("opacity", connectorPulseOpacity(m.pulseOutT).toFixed(3));
          }
        }
      });

      edges.forEach(([a, b], i) => {
        const meshLine = meshLineRefs.current[i];
        if (!meshLine || !positions[a] || !positions[b]) return;
        meshLine.setAttribute("x1", positions[a].x.toFixed(1));
        meshLine.setAttribute("y1", positions[a].y.toFixed(1));
        meshLine.setAttribute("x2", positions[b].x.toFixed(1));
        meshLine.setAttribute("y2", positions[b].y.toFixed(1));
      });

      if (!reduceMotion && loopPulseRef.current && edges.length > 0) {
        const segIdx = loopSegmentIndex(loopMotion.t, edges.length);
        const localT = loopSegmentLocalT(loopMotion.t, edges.length);
        const [a, b] = edges[segIdx];
        if (positions[a] && positions[b]) {
          const p = connectorPulsePosition(positions[a], positions[b], localT);
          loopPulseRef.current.setAttribute("cx", p.x.toFixed(1));
          loopPulseRef.current.setAttribute("cy", p.y.toFixed(1));
          loopPulseRef.current.setAttribute("opacity", connectorPulseOpacity(localT).toFixed(3));
        }
      }
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
          const period = pulsePeriodSecForIndex(i);
          motion[i].pulseInT = advancePulseT(motion[i].pulseInT, dt, period);
          motion[i].pulseOutT = advancePulseT(motion[i].pulseOutT, dt, period);
        });
        loopMotion.t = advancePulseT(loopMotion.t, dt, ECOSYSTEM_LOOP_PERIOD_SEC);
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
  }, [layout, reduceMotion, meshEdges]);

  return (
    <div ref={hostRef} className="bie-orbit-tools" aria-label="Platform instruments">
      <svg className="bie-orbit-connectors" aria-hidden focusable="false">
        <g className="bie-orbit-mesh" aria-hidden>
          {meshEdges.map(([a, b], i) => (
            <line
              key={`mesh-${a}-${b}`}
              ref={(el) => {
                meshLineRefs.current[i] = el;
              }}
              className="bie-orbit-mesh-line"
            />
          ))}
          {!reduceMotion && meshEdges.length > 0 && (
            <circle ref={loopPulseRef} r={2} className="bie-orbit-loop-pulse" />
          )}
        </g>

        {layout?.map((tool, i) => (
          <g key={`connector-${tool.name}`} style={{ ["--tool-accent" as string]: tool.accent }}>
            <line
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className="bie-orbit-connector-line"
            />
            {!reduceMotion && (
              <>
                <circle
                  ref={(el) => {
                    pulseInRefs.current[i] = el;
                  }}
                  r={2.4}
                  className="bie-orbit-connector-pulse-in"
                />
                <circle
                  ref={(el) => {
                    pulseOutRefs.current[i] = el;
                  }}
                  r={2.2}
                  className="bie-orbit-connector-pulse-out"
                />
              </>
            )}
          </g>
        ))}
      </svg>

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
