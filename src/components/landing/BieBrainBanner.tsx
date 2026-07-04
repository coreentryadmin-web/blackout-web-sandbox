"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { chordPath, goldenSpiralPoint, pointOnEllipse } from "./bie-brain-geometry";

// "Introducing BlackOut Intelligence Engine" — sits above "The full desk" grid
// as a title-card-style reveal, not another tile in it. BIE sits dead-center as
// a core, the six instruments orbit it on an ELLIPSE (not a true circle) — that
// asymmetry is what fakes a disc viewed at an angle, a "tilted sphere/globe"
// look, using plain 2D math instead of a CSS 3D `rotateX` (which would leave
// the layout box reserving full square space while the paint gets foreshortened
// — a gap this sidesteps entirely). A hexagram of ring + diagonal "cross"
// connections weaves the instruments into one mesh (not a plain hub-and-spoke),
// and a field of ambient dust dots fills the rest of the disc. Two
// independently-rotating layers (nodes one way, dust the other, different
// speeds) sell the depth without any WebGL/3D library — plain SVG + CSS.
//
// Content note: never name BlackOut's own LLM/model here or in READOUT_LINES —
// the honest-realism stance (docs/bie/ARCHITECTURE.md) is that Claude is the
// general-reasoning fallback, not a proprietary model BlackOut trained.

const VIEW_W = 640;
const VIEW_H = 380;
const CORE = { x: VIEW_W / 2, y: VIEW_H / 2 };
const RING_RX = 230;
const RING_RY = 118;
const DUST_COUNT = 26;
const DUST_MAX_RX = 305;
const DUST_MAX_RY = 160;

type BrainNode = { name: string; href: string; accent: string };

// Left-to-right order matches FeaturesGrid's INSTRUMENTS below, so the node
// list under the diagram reads as a preview of exactly what's in the grid —
// order also fixes where each node lands going clockwise from the top.
const NODES: BrainNode[] = [
  { name: "SPX Slayer", href: "/dashboard", accent: "#00e676" },
  { name: "HELIX", href: "/flows", accent: "#bf5fff" },
  { name: "BlackOut Thermal", href: "/heatmap", accent: "#ff6b2b" },
  { name: "Largo", href: "/terminal", accent: "#22d3ee" },
  { name: "Night Hawk", href: "/nighthawk", accent: "#ff2d55" },
  { name: "BlackOut Grid", href: "/grid", accent: "#ffcc4d" },
];

const RING_NODES = NODES.map((n, i) => ({
  ...n,
  ...pointOnEllipse(CORE.x, CORE.y, RING_RX, RING_RY, (360 / NODES.length) * i),
}));

const DUST = Array.from({ length: DUST_COUNT }, (_, i) =>
  goldenSpiralPoint(CORE.x, CORE.y, DUST_MAX_RX, DUST_MAX_RY, i, DUST_COUNT)
);

type WireCategory = "spoke" | "ring" | "cross";
type Wire = { id: string; d: string; category: WireCategory; accent: string };

const WIRES: Wire[] = [
  // spokes — straight lines, BIE's own connection to each instrument, colored
  // by the destination's accent via a gradient (defined in <defs> below).
  ...RING_NODES.map((n, i) => ({
    id: `bie-spoke-${i}`,
    d: chordPath(CORE.x, CORE.y, n.x, n.y, CORE.x, CORE.y, 0),
    category: "spoke" as const,
    accent: n.accent,
  })),
  // ring — perimeter arcs between neighboring instruments, bowed outward.
  ...RING_NODES.map((n, i) => {
    const next = RING_NODES[(i + 1) % RING_NODES.length];
    return {
      id: `bie-ring-${i}`,
      d: chordPath(n.x, n.y, next.x, next.y, CORE.x, CORE.y, 26),
      category: "ring" as const,
      accent: "#5df7ff",
    };
  }),
  // cross — long diagonals (node i to node i+2), which for 6 evenly-spaced
  // nodes traces two overlapping triangles — a hexagram, the densest-reading
  // "sphere mesh" pattern for the least visual clutter.
  ...RING_NODES.map((n, i) => {
    const opposite = RING_NODES[(i + 2) % RING_NODES.length];
    return {
      id: `bie-cross-${i}`,
      d: chordPath(n.x, n.y, opposite.x, opposite.y, CORE.x, CORE.y, 54),
      category: "cross" as const,
      accent: "#bf5fff",
    };
  }),
];

/** Per-category base pace (spokes fastest — energy flowing INTO the core;
 *  cross-diagonals slowest — the "deep" long-haul connections) with a small
 *  per-wire offset so pulses on the same category don't move in lockstep. */
function pulseTiming(category: WireCategory, i: number): { dur: number; delay: number } {
  const base = category === "spoke" ? 2.0 : category === "ring" ? 3.2 : 4.6;
  return { dur: base + (i % 5) * 0.22, delay: -((i * 0.61) % base) };
}

// Deliberately vendor/stack-free — this is a member-facing marketing surface,
// not a status page. No infra provider names, no ops jargon (cron/CPU/env-vars/
// deploy); see scripts/check-vendor-surfaces.mjs, which scans this directory.
const READOUT_LINES = [
  "verifying every heat map, GEX read, and play against source data",
  "the desk never sleeps — every system checked, every minute of the day",
  "one audit trail for every 0DTE and Night Hawk alert",
  "uptime, speed, stability — watched live, so you never have to ask",
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
            {RING_NODES.map((n, i) => (
              <linearGradient
                key={n.name}
                id={`bie-spoke-grad-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={CORE.x}
                y1={CORE.y}
                x2={n.x}
                y2={n.y}
              >
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor={n.accent} />
              </linearGradient>
            ))}
          </defs>

          {/* ambient dust — fills the disc so it reads as a dense sphere of
              points, not 6 isolated dots on empty space. Counter-rotates
              slower than the main ring for a layered-depth feel. */}
          <g className="bie-brain-orbit bie-brain-orbit-dust">
            {DUST.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={1.6} className="bie-brain-dust-dot" />
            ))}
          </g>

          {/* the main ring — wires + instrument nodes, rotating together as
              one rigid network around the fixed core. */}
          <g className="bie-brain-orbit bie-brain-orbit-main">
            {WIRES.map((w, i) => {
              const { dur, delay } = pulseTiming(w.category, i);
              return (
                <g key={w.id}>
                  <path
                    id={w.id}
                    d={w.d}
                    pathLength={1}
                    className={`bie-wire bie-${w.category}-wire`}
                    stroke={w.category === "spoke" ? `url(#bie-spoke-grad-${i})` : w.accent}
                    style={{ animationDelay: `${i * 0.07}s` }}
                  />
                  {!reduceMotion && (
                    <circle r={w.category === "spoke" ? 3.2 : 2} className={`bie-${w.category}-pulse`} fill={w.accent}>
                      <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite">
                        <mpath href={`#${w.id}`} />
                      </animateMotion>
                    </circle>
                  )}
                </g>
              );
            })}
            {RING_NODES.map((n) => (
              <circle key={n.name} cx={n.x} cy={n.y} r={7} className="bie-brain-node-dot" fill={n.accent} />
            ))}
          </g>

          {/* the core, brainwave rings — fixed at the rotation axis, never orbits */}
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
