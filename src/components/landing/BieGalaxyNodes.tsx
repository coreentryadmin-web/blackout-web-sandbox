"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildGalaxyFieldNodes,
  galaxyShapePath,
  galaxyTintRgb,
  tickGalaxyFieldNodes,
  type GalaxyNodeRuntime,
  type GalaxyNodeShape,
} from "./bie-galaxy-nodes";
import { readSessionOrbitSeed } from "./bie-orbit-layout";

type Props = {
  coreX: number;
  coreY: number;
  maxRx: number;
  maxRy: number;
  reduceMotion: boolean;
};

function GalaxyNodeGlyph({ node }: { node: GalaxyNodeRuntime }) {
  const glow = node.brightness * node.opacity;
  const fill = galaxyTintRgb(node.tint, Math.min(1, 0.35 + glow * 0.75));
  const stroke = galaxyTintRgb(node.tint, Math.min(1, 0.55 + glow * 0.45));

  if (node.shape === "ring") {
    return (
      <>
        <circle
          r={node.size}
          fill="none"
          stroke={stroke}
          strokeWidth={Math.max(0.45, node.size * 0.14)}
          opacity={0.95}
        />
        <circle r={node.size * 0.22} fill={fill} opacity={0.85} />
      </>
    );
  }

  const d = galaxyShapePath(node.shape, node.size);
  if (!d) return null;

  return (
    <path
      d={d}
      fill={fill}
      stroke={stroke}
      strokeWidth={node.shape === "shard" ? 0.35 : 0.5}
      strokeLinejoin="round"
    />
  );
}

/** Living galaxy field — varied bodies on every ellipse, each with its own behavior. */
export function BieGalaxyNodes({ coreX, coreY, maxRx, maxRy, reduceMotion }: Props) {
  const nodesRef = useRef<GalaxyNodeRuntime[]>([]);
  const [, setFrame] = useState(0);

  useEffect(() => {
    const seed = readSessionOrbitSeed();
    nodesRef.current = buildGalaxyFieldNodes(coreX, coreY, maxRx, maxRy, seed);
    setFrame((f) => f + 1);
  }, [coreX, coreY, maxRx, maxRy]);

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes.length || reduceMotion) return;

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tickGalaxyFieldNodes(nodes, now / 1000, dt, coreX, coreY, maxRx, maxRy);
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [coreX, coreY, maxRx, maxRy, reduceMotion]);

  const nodes = nodesRef.current;
  if (!nodes.length) return null;

  return (
    <g className="bie-galaxy-nodes" aria-hidden>
      {nodes.map((node) => {
        const blur = 4 + node.size * (0.8 + node.brightness * 1.4);
        return (
          <g
            key={node.id}
            className={`bie-galaxy-node bie-galaxy-node-${node.behavior}`}
            transform={`translate(${node.x.toFixed(2)} ${node.y.toFixed(2)}) rotate(${node.rotationDeg.toFixed(1)}) scale(${node.scale.toFixed(3)})`}
            opacity={node.opacity.toFixed(3)}
            style={{
              filter: `drop-shadow(0 0 ${blur.toFixed(1)}px ${galaxyTintRgb(node.tint, node.brightness * 0.85)})`,
            }}
          >
            <GalaxyNodeGlyph node={node} />
          </g>
        );
      })}
    </g>
  );
}

export type { GalaxyNodeShape, GalaxyNodeRuntime };
