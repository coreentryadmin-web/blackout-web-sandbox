"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { spokePath, meshPath } from "./bie-brain-geometry";

// "Introducing BlackOut Intelligence Engine" — sits above "The full desk" grid
// as a title-card-style reveal, not another tile in it. A pulsing BIE core with
// "synapse" wires fanning out to all six instruments, plus a thin mesh between
// neighbors, so it reads as one connected network rather than a simple
// hub-and-spoke: BIE watching and connecting every tool, continuously.

const CORE = { x: 600, y: 54 };
const NODE_Y = 214;
const VIEW_W = 1200;
const VIEW_H = 260;

type BrainNode = { name: string; href: string; accent: string };

// Left-to-right order matches FeaturesGrid's INSTRUMENTS below, so the banner
// reads as a preview of exactly what's in the grid underneath it.
const NODES: BrainNode[] = [
  { name: "SPX Slayer", href: "/dashboard", accent: "#00e676" },
  { name: "HELIX", href: "/flows", accent: "#bf5fff" },
  { name: "BlackOut Thermal", href: "/heatmap", accent: "#ff6b2b" },
  { name: "Largo", href: "/terminal", accent: "#22d3ee" },
  { name: "Night Hawk", href: "/nighthawk", accent: "#ff2d55" },
  { name: "BlackOut Grid", href: "/grid", accent: "#ffcc4d" },
];

const NODE_X_START = 70;
const NODE_X_SPACING = (VIEW_W - NODE_X_START * 2) / (NODES.length - 1);
const nodeX = (i: number) => NODE_X_START + i * NODE_X_SPACING;

// Distinct per-spoke timing so pulses fire asynchronously — "connecting every
// dot, every second" reads as a living network, not a synchronized metronome.
const SPOKE_DUR = [2.3, 2.7, 2.1, 2.9, 2.4, 3.1];
const SPOKE_DELAY = [0, -1.4, -0.6, -2.1, -0.3, -1.8];
const MESH_DUR = [4.2, 3.8, 4.6, 4.0, 4.4];
const MESH_DELAY = [-0.5, -2.6, -1.1, -3.3, -1.9];

const READOUT_LINES = [
  "verifying every heat map, GEX read, and play against source data",
  "cron & worker health — 20+ jobs tracked, schedule-aware",
  "one audit trail for every 0DTE and Night Hawk alert",
  "Railway deploy, CPU, memory, and env-vars — watched live",
  "the model never invents a number — every claim is checked",
];

/** Live while on screen: draws the wires on once, keeps the traveling pulses
 *  running only while visible (pauses the SMIL timeline off-screen — no point
 *  animating a network nobody can see). */
function useLiveOnView<T extends SVGSVGElement>() {
  const ref = useRef<T>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDrawn(true);
          if (typeof el.unpauseAnimations === "function") el.unpauseAnimations();
        } else if (typeof el.pauseAnimations === "function") {
          el.pauseAnimations();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, drawn };
}

export function BieBrainBanner() {
  const { ref, drawn } = useLiveOnView<SVGSVGElement>();
  const [lineIndex, setLineIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setLineIndex((i) => (i + 1) % READOUT_LINES.length), 2800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="bie-brain-banner">
      <div className="bie-brain-heading">
        <span className="bie-brain-eyebrow">
          <span className="bie-brain-eyebrow-dot" aria-hidden />
          Introducing
        </span>
        <h2 className="bie-brain-title">BlackOut Intelligence Engine</h2>
        <p className="bie-brain-sub">{READOUT_LINES[lineIndex]}</p>
      </div>

      <div className="bie-brain-diagram">
        <svg
          ref={ref}
          className={drawn ? "bie-brain-svg is-drawn" : "bie-brain-svg"}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          <defs>
            <radialGradient id="bie-core-grad" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#5df7ff" />
              <stop offset="45%" stopColor="#00e5ff" />
              <stop offset="100%" stopColor="#0a3b45" />
            </radialGradient>
            {NODES.map((n, i) => (
              <linearGradient
                key={n.name}
                id={`bie-spoke-grad-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={CORE.x}
                y1={CORE.y}
                x2={nodeX(i)}
                y2={NODE_Y}
              >
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor={n.accent} />
              </linearGradient>
            ))}
          </defs>

          {/* mesh — thin links between neighboring instruments, so the network
              reads as connected, not just a star radiating from one hub. */}
          <g className="bie-brain-mesh">
            {NODES.slice(0, -1).map((n, i) => {
              const d = meshPath(nodeX(i), nodeX(i + 1), NODE_Y, 26);
              return (
                <g key={n.name}>
                  <path
                    id={`bie-mesh-${i}`}
                    d={d}
                    pathLength={1}
                    className="bie-wire bie-mesh-wire"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                  {!reduceMotion && (
                    <circle r={2.4} className="bie-mesh-pulse" fill="#5df7ff">
                      <animateMotion
                        dur={`${MESH_DUR[i]}s`}
                        begin={`${MESH_DELAY[i]}s`}
                        repeatCount="indefinite"
                      >
                        <mpath href={`#bie-mesh-${i}`} />
                      </animateMotion>
                    </circle>
                  )}
                </g>
              );
            })}
          </g>

          {/* spokes — BIE's own connection to each instrument, colored by the
              destination's accent so the "energy" visibly takes on that tool's identity. */}
          <g className="bie-brain-spokes">
            {NODES.map((n, i) => {
              const d = spokePath(CORE.x, CORE.y, nodeX(i), NODE_Y);
              return (
                <g key={n.name}>
                  <path
                    id={`bie-spoke-${i}`}
                    d={d}
                    pathLength={1}
                    className="bie-wire bie-spoke-wire"
                    stroke={`url(#bie-spoke-grad-${i})`}
                    style={{ animationDelay: `${0.15 + i * 0.09}s` }}
                  />
                  {!reduceMotion && (
                    <circle r={3.4} className="bie-spoke-pulse" fill={n.accent}>
                      <animateMotion
                        dur={`${SPOKE_DUR[i]}s`}
                        begin={`${SPOKE_DELAY[i]}s`}
                        repeatCount="indefinite"
                      >
                        <mpath href={`#bie-spoke-${i}`} />
                      </animateMotion>
                    </circle>
                  )}
                  <circle cx={nodeX(i)} cy={NODE_Y} r={5} className="bie-brain-node-dot" fill={n.accent} />
                </g>
              );
            })}
          </g>

          {/* the core, brainwave rings */}
          <circle cx={CORE.x} cy={CORE.y} r={38} className="bie-brain-ring" style={{ animationDelay: "0s" }} />
          <circle cx={CORE.x} cy={CORE.y} r={38} className="bie-brain-ring" style={{ animationDelay: "1.1s" }} />
          <circle cx={CORE.x} cy={CORE.y} r={24} className="bie-brain-core" />
        </svg>

        <span className="bie-brain-core-label" aria-hidden>
          BIE
        </span>
      </div>

      <div className="bie-brain-nodes">
        {NODES.map((n) => (
          <Link key={n.name} href={n.href} className="bie-brain-node" style={{ ["--node-accent" as string]: n.accent }}>
            <span className="bie-brain-node-swatch" />
            {n.name}
          </Link>
        ))}
      </div>

      <p className="bie-brain-tagline">
        It&rsquo;s not a mess. <span className="bie-brain-tagline-accent">It&rsquo;s a Mesh.</span>
      </p>
    </div>
  );
}
