"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { chordPath, columnNodes, flowPath, pointOnEllipse } from "./bie-brain-geometry";

// Three-stage pipeline: Market Intelligence → Validation → BIE Reactor → Trusted Output.
// Reasoning/intelligence capabilities orbit INSIDE the reactor — not a separate column.
// No vendor/stack names; capabilities only.

const VIEW_W = 1280;
const VIEW_H = 480;
const CORE = { x: VIEW_W / 2, y: VIEW_H / 2 };
const CORE_Y_PCT = (CORE.y / VIEW_H) * 100;
const layerX = (pct: number) => VIEW_W * pct;

/** ~35% larger than the original r=32 core — the reactor dominates the diagram. */
const CORE_R = 44;
const SHELL_R = 78;
const RING_R = 68;
const GATE_OFFSET = 92;
const ORBIT_RX = 112;
const ORBIT_RY = 96;
const PARTICLE_COUNT = 12;
const PARTICLE_ORBIT = 76;

type CapabilityLayer = {
  id: string;
  title: string;
  x: number;
  accent: string;
  items: string[];
};

const MARKET_LAYER: CapabilityLayer = {
  id: "market",
  title: "Market Intelligence",
  x: layerX(0.09),
  accent: "#5df7ff",
  items: ["Live Market Data", "Options Intelligence", "Dealer Positioning", "Market Structure", "Liquidity", "Volatility"],
};

const VALIDATION_LAYER: CapabilityLayer = {
  id: "validation",
  title: "Validation",
  x: layerX(0.26),
  accent: "#00e676",
  items: ["Data Integrity", "Signal Verification", "Consistency Checks", "Confidence Analysis", "Real-Time Validation", "Self Audit"],
};

const OUTPUT_LAYER: CapabilityLayer = {
  id: "output",
  title: "Trusted Output",
  x: layerX(0.91),
  accent: "#ffcc4d",
  items: ["Trade Intelligence", "SPX Slayer", "Heat Maps", "Alerts", "Rankings", "Market Bias"],
};

/** Intelligence lives inside BIE — orbited around the reactor, not a separate stage. */
const INTELLIGENCE_ITEMS = [
  "Pattern Recognition",
  "Market Reasoning",
  "Memory",
  "Risk Analysis",
  "Continuous Learning",
];

const CORE_PHRASES = ["Validate", "Reason", "Learn", "Improve"];

const STATUS_CHIPS = [
  { label: "Auditing", accent: "#00e676" },
  { label: "Live", accent: "#5df7ff" },
];

/** Vertical deliver spine: BIE → Learning → Outputs (rises toward Trusted Output). */
const OUTPUT_STACK = [
  { id: "outputs", label: "Outputs", accent: "#ffcc4d" },
  { id: "learning", label: "Learning", accent: "#bf5fff" },
  { id: "bie", label: "BIE", accent: "#5df7ff", core: true },
] as const;

const OUTPUT_STACK_X = layerX(0.62);
const OUTPUT_STACK_TOP = CORE.y - 118;
const OUTPUT_STACK_BOTTOM = CORE.y + 118;

const SIDE_LAYERS = [MARKET_LAYER, VALIDATION_LAYER, OUTPUT_LAYER];
const NODE_SPACING = 44;

type FlowNode = { id: string; label: string; x: number; y: number; layerId: string; accent: string };

function buildLayerNodes(layer: CapabilityLayer): FlowNode[] {
  const positions = columnNodes(layer.x, CORE.y, layer.items.length, NODE_SPACING);
  return layer.items.map((label, i) => ({
    id: `${layer.id}-${i}`,
    label,
    x: positions[i].x,
    y: positions[i].y,
    layerId: layer.id,
    accent: layer.accent,
  }));
}

/** Five intelligence capabilities on an arc around the reactor core. */
function buildIntelligenceOrbit(): FlowNode[] {
  const startAngle = 215;
  const span = 290;
  return INTELLIGENCE_ITEMS.map((label, i) => {
    const angle = startAngle + (span * i) / (INTELLIGENCE_ITEMS.length - 1);
    const p = pointOnEllipse(CORE.x, CORE.y, ORBIT_RX, ORBIT_RY, angle);
    return { id: `intel-${i}`, label, x: p.x, y: p.y, layerId: "intel", accent: "#bf5fff" };
  });
}

type OutputProduct = { name: string; href: string; accent: string };

const PRODUCTS: OutputProduct[] = [
  { name: "SPX Slayer", href: "/dashboard", accent: "#00e676" },
  { name: "HELIX", href: "/flows", accent: "#bf5fff" },
  { name: "BlackOut Thermal", href: "/heatmap", accent: "#ff6b2b" },
  { name: "Largo", href: "/terminal", accent: "#22d3ee" },
  { name: "Night Hawk", href: "/nighthawk", accent: "#ff2d55" },
  { name: "BlackOut Grid", href: "/grid", accent: "#ffcc4d" },
];

type FlowWire = {
  id: string;
  d: string;
  accent: string;
  stage: "inbound" | "validate" | "outbound";
  dur: number;
  delay: number;
};

function buildFlowWires(nodes: {
  market: FlowNode[];
  validation: FlowNode[];
  output: FlowNode[];
}): FlowWire[] {
  const wires: FlowWire[] = [];

  const linkColumns = (
    from: FlowNode[],
    to: FlowNode[],
    stage: FlowWire["stage"],
    accent: string,
    bow: number,
    xPadFrom = 14,
    xPadTo = -14
  ) => {
    const n = Math.min(from.length, to.length);
    for (let i = 0; i < n; i++) {
      wires.push({
        id: `bie-flow-${from[i].id}-${to[i].id}`,
        d: flowPath(from[i].x + xPadFrom, from[i].y, to[i].x + xPadTo, to[i].y, CORE.y, bow),
        accent,
        stage,
        dur: 2.4 + (i % 4) * 0.35,
        delay: -(i * 0.55),
      });
    }
  };

  linkColumns(nodes.market, nodes.validation, "inbound", "#5df7ff", 8);

  nodes.validation.forEach((n, i) => {
    const targetY = CORE.y - 52 + i * 17;
    wires.push({
      id: `bie-flow-val-core-${i}`,
      d: flowPath(n.x + 14, n.y, CORE.x - GATE_OFFSET, targetY, CORE.y, 16),
      accent: "#00e676",
      stage: "validate",
      dur: 2.6 + (i % 3) * 0.3,
      delay: -(i * 0.62),
    });
  });

  nodes.output.forEach((n, i) => {
    wires.push({
      id: `bie-flow-core-out-${i}`,
      d: flowPath(CORE.x + GATE_OFFSET, CORE.y - 52 + i * 17, n.x - 14, n.y, CORE.y, -14),
      accent: "#ffcc4d",
      stage: "outbound",
      dur: 2.8 + (i % 3) * 0.35,
      delay: -(i * 0.5),
    });
  });

  return wires;
}

const READOUT_LINES = [
  "continuous market intelligence — ingested, verified, never assumed",
  "every heat map, GEX read, and play checked before it reaches your screen",
  "signals are reasoned and confidence-scored — not guessed",
  "the engine never stops learning from every session, every market day",
  "trust the output because validation happened first",
];

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
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, drawn };
}

export function BieBrainBanner() {
  const { ref, drawn } = useLiveOnView<SVGSVGElement>();
  const [lineIndex, setLineIndex] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const intelligenceOrbit = useMemo(() => buildIntelligenceOrbit(), []);

  const nodes = useMemo(
    () => ({
      market: buildLayerNodes(MARKET_LAYER),
      validation: buildLayerNodes(VALIDATION_LAYER),
      output: buildLayerNodes(OUTPUT_LAYER),
    }),
    []
  );

  const wires = useMemo(() => buildFlowWires(nodes), [nodes]);
  const sideNodes = useMemo(
    () => [...nodes.market, ...nodes.validation, ...nodes.output],
    [nodes]
  );

  useEffect(() => {
    const id = setInterval(() => setLineIndex((i) => (i + 1) % READOUT_LINES.length), 3200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setPhraseIndex((i) => (i + 1) % CORE_PHRASES.length), 2400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const reactorTransform = `translate(${CORE.x}, ${CORE.y})`;

  return (
    <div className="bie-brain-banner">
      <div className="bie-brain-heading">
        <span className="bie-brain-eyebrow">
          <span className="bie-brain-eyebrow-dot" aria-hidden />
          The operating brain of BlackOut
        </span>
        <h2 className="bie-brain-title">BlackOut Intelligence Engine</h2>
        <p className="bie-brain-sub">{READOUT_LINES[lineIndex]}</p>
      </div>

      <div
        className="bie-brain-diagram"
        role="img"
        aria-label="Intelligence pipeline: market data flows through validation into the BlackOut Intelligence Engine where reasoning and learning happen, then trusted output reaches every platform instrument."
      >
        <div className="bie-brain-scroll-wrap">
          <div className="bie-brain-canvas">
            <div className="bie-brain-layer-labels">
              {SIDE_LAYERS.map((layer) => (
                <span
                  key={layer.id}
                  className="bie-brain-layer-title"
                  style={{ left: `${(layer.x / VIEW_W) * 100}%`, color: layer.accent }}
                >
                  {layer.title}
                </span>
              ))}
              <span className="bie-brain-layer-title bie-brain-layer-title-core">
                BlackOut Intelligence Engine
              </span>
            </div>

            <svg
              ref={ref}
              className={drawn ? "bie-brain-svg is-drawn" : "bie-brain-svg"}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <radialGradient id="bie-core-grad" cx="38%" cy="32%" r="72%">
                  <stop offset="0%" stopColor="#5df7ff" />
                  <stop offset="42%" stopColor="#00e5ff" />
                  <stop offset="100%" stopColor="#0a3b45" />
                </radialGradient>
                <radialGradient id="bie-reactor-glow-grad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(0,229,255,0.35)" />
                  <stop offset="55%" stopColor="rgba(191,95,255,0.12)" />
                  <stop offset="100%" stopColor="rgba(0,229,255,0)" />
                </radialGradient>
                <linearGradient id="bie-core-halo" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="rgba(0,229,255,0.65)" />
                  <stop offset="100%" stopColor="rgba(191,95,255,0.45)" />
                </linearGradient>
              </defs>

              {/* Side column bands — subdued so the reactor dominates */}
              {SIDE_LAYERS.map((layer) => (
                <rect
                  key={`band-${layer.id}`}
                  x={layer.x - 52}
                  y={CORE.y - (layer.items.length * NODE_SPACING) / 2 - 28}
                  width={104}
                  height={layer.items.length * NODE_SPACING + 56}
                  rx={4}
                  className={`bie-brain-layer-band bie-brain-layer-band-${layer.id}`}
                  style={{ fill: layer.accent }}
                />
              ))}

              {SIDE_LAYERS.map((layer) => (
                <line
                  key={`rail-${layer.id}`}
                  x1={layer.x}
                  y1={CORE.y - (layer.items.length * NODE_SPACING) / 2 - 18}
                  x2={layer.x}
                  y2={CORE.y + (layer.items.length * NODE_SPACING) / 2 + 18}
                  className="bie-brain-rail"
                  stroke={layer.accent}
                />
              ))}

              {/* Flow wires — drawn under the reactor */}
              {wires.map((w, i) => (
                <g key={w.id}>
                  <path
                    id={w.id}
                    d={w.d}
                    pathLength={1}
                    className={`bie-flow-wire bie-flow-${w.stage}`}
                    stroke={w.accent}
                    style={{ animationDelay: `${i * 0.06}s` }}
                  />
                  {!reduceMotion && (
                    <circle
                      r={w.stage === "validate" ? 3.2 : 2.4}
                      className={`bie-flow-pulse bie-flow-pulse-${w.stage}`}
                      fill={w.accent}
                    >
                      <animateMotion dur={`${w.dur}s`} begin={`${w.delay}s`} repeatCount="indefinite">
                        <mpath href={`#${w.id}`} />
                      </animateMotion>
                    </circle>
                  )}
                </g>
              ))}

              {/* Side capability nodes — visually secondary to the reactor */}
              {sideNodes.map((n, i) => (
                <g key={n.id} className="bie-brain-cap-node bie-brain-cap-node-side">
                  <circle cx={n.x} cy={n.y} r={4.5} fill={n.accent} className="bie-brain-cap-dot" />
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={8}
                    fill="none"
                    stroke={n.accent}
                    className="bie-brain-cap-ring"
                    style={{ animationDelay: `${-(i * 0.35)}s` }}
                  />
                </g>
              ))}

              {/* ── REACTOR — the visual center of gravity ── */}
              <g className="bie-reactor" transform={reactorTransform}>
                <circle cx={0} cy={0} r={128} className="bie-reactor-glow" fill="url(#bie-reactor-glow-grad)" />

                {!reduceMotion && (
                  <g className="bie-reactor-spin">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0 0 0"
                      to="360 0 0"
                      dur="22s"
                      repeatCount="indefinite"
                    />
                    <circle cx={0} cy={0} r={SHELL_R - 2} className="bie-reactor-energy-ring" />
                    {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
                      const angle = (360 / PARTICLE_COUNT) * i;
                      const p = pointOnEllipse(0, 0, PARTICLE_ORBIT, PARTICLE_ORBIT, angle);
                      return (
                        <circle
                          key={`particle-${i}`}
                          cx={p.x}
                          cy={p.y}
                          r={i % 3 === 0 ? 2.2 : 1.5}
                          className="bie-reactor-particle"
                        />
                      );
                    })}
                  </g>
                )}

                {!reduceMotion && (
                  <g className="bie-reactor-spin-reverse">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="360 0 0"
                      to="0 0 0"
                      dur="34s"
                      repeatCount="indefinite"
                    />
                    <circle cx={0} cy={0} r={SHELL_R + 6} className="bie-reactor-energy-ring-outer" />
                  </g>
                )}

                {/* Intelligence orbit — part of the engine, not a separate column */}
                {intelligenceOrbit.map((n) => (
                  <g key={n.id} className="bie-brain-cap-node bie-brain-cap-node-intel">
                    <circle cx={n.x - CORE.x} cy={n.y - CORE.y} r={3.5} fill={n.accent} className="bie-brain-cap-dot" />
                  </g>
                ))}

                <circle cx={0} cy={0} r={SHELL_R} className="bie-brain-core-shell" />
                <circle cx={0} cy={0} r={RING_R} className="bie-brain-ring" style={{ animationDelay: "0s" }} />
                <circle cx={0} cy={0} r={RING_R} className="bie-brain-ring" style={{ animationDelay: "1.1s" }} />
                <circle cx={0} cy={0} r={RING_R} className="bie-brain-ring" style={{ animationDelay: "2.2s" }} />
                <circle cx={0} cy={0} r={CORE_R} className="bie-brain-core" />
              </g>

              {/* Validation / output gates */}
              <path
                d={`M ${CORE.x - GATE_OFFSET - 6} ${CORE.y - 88} Q ${CORE.x - GATE_OFFSET + 24} ${CORE.y} ${CORE.x - GATE_OFFSET - 6} ${CORE.y + 88}`}
                className="bie-brain-gate"
                pathLength={1}
              />
              <path
                d={`M ${CORE.x + GATE_OFFSET + 6} ${CORE.y - 88} Q ${CORE.x + GATE_OFFSET - 24} ${CORE.y} ${CORE.x + GATE_OFFSET + 6} ${CORE.y + 88}`}
                className="bie-brain-gate bie-brain-gate-out"
                pathLength={1}
              />

              <path
                id="bie-spine-in"
                d={chordPath(layerX(0.03), CORE.y, CORE.x - GATE_OFFSET, CORE.y, CORE.x, CORE.y, 0)}
                className="bie-brain-axis bie-brain-axis-in"
                pathLength={1}
              />
              <path
                id="bie-spine-out"
                d={chordPath(CORE.x + GATE_OFFSET, CORE.y, layerX(0.97), CORE.y, CORE.x, CORE.y, 0)}
                className="bie-brain-axis bie-brain-axis-out"
                pathLength={1}
              />

              {/* Vertical deliver stack: BIE → Learning → Outputs */}
              <path
                id="bie-output-stack"
                d={`M ${OUTPUT_STACK_X} ${OUTPUT_STACK_BOTTOM} L ${OUTPUT_STACK_X} ${OUTPUT_STACK_TOP}`}
                className="bie-output-stack-line"
                pathLength={1}
              />
              <path
                d={`M ${OUTPUT_STACK_X} ${OUTPUT_STACK_TOP} L ${OUTPUT_LAYER.x - 58} ${OUTPUT_STACK_TOP}`}
                className="bie-output-stack-bridge"
                pathLength={1}
              />
              <polygon
                points={`${OUTPUT_STACK_X - 4},${CORE.y + 52} ${OUTPUT_STACK_X + 4},${CORE.y + 52} ${OUTPUT_STACK_X},${CORE.y + 44}`}
                className="bie-output-stack-chevron"
                fill="#bf5fff"
              />
              <polygon
                points={`${OUTPUT_STACK_X - 4},${CORE.y - 52} ${OUTPUT_STACK_X + 4},${CORE.y - 52} ${OUTPUT_STACK_X},${CORE.y - 44}`}
                className="bie-output-stack-chevron bie-output-stack-chevron-out"
                fill="#ffcc4d"
              />

              {!reduceMotion && (
                <>
                  <circle r={2.2} className="bie-spine-pulse bie-spine-pulse-in" fill="#5df7ff">
                    <animateMotion dur="4.2s" begin="-1s" repeatCount="indefinite">
                      <mpath href="#bie-spine-in" />
                    </animateMotion>
                  </circle>
                  <circle r={2.2} className="bie-spine-pulse bie-spine-pulse-out" fill="#ffcc4d">
                    <animateMotion dur="4.6s" begin="-2.4s" repeatCount="indefinite">
                      <mpath href="#bie-spine-out" />
                    </animateMotion>
                  </circle>
                  <circle r={2.4} className="bie-output-stack-pulse" fill="#bf5fff">
                    <animateMotion dur="3.4s" begin="-0.8s" repeatCount="indefinite">
                      <mpath href="#bie-output-stack" />
                    </animateMotion>
                  </circle>
                </>
              )}
            </svg>

            <div className="bie-brain-label-overlay">
              {sideNodes.map((n) => (
                <span
                  key={`lbl-${n.id}`}
                  className={`bie-brain-cap-label bie-brain-cap-label-side bie-brain-cap-label-${n.layerId}`}
                  style={{
                    left: `${(n.x / VIEW_W) * 100}%`,
                    top: `${(n.y / VIEW_H) * 100}%`,
                    ["--cap-accent" as string]: n.accent,
                  }}
                >
                  {n.label}
                </span>
              ))}
              {intelligenceOrbit.map((n) => (
                <span
                  key={`lbl-${n.id}`}
                  className="bie-brain-cap-label bie-brain-cap-label-intel"
                  style={{
                    left: `${(n.x / VIEW_W) * 100}%`,
                    top: `${(n.y / VIEW_H) * 100}%`,
                  }}
                >
                  {n.label}
                </span>
              ))}
            </div>

            <div className="bie-brain-output-stack-labels" aria-hidden>
              {OUTPUT_STACK.map((step) => {
                const y =
                  step.id === "outputs"
                    ? OUTPUT_STACK_TOP
                    : step.id === "learning"
                      ? CORE.y
                      : OUTPUT_STACK_BOTTOM;
                return (
                  <span
                    key={step.id}
                    className={`bie-brain-output-stack-label${"core" in step && step.core ? " bie-brain-output-stack-label-core" : ""}`}
                    style={{
                      left: `${(OUTPUT_STACK_X / VIEW_W) * 100}%`,
                      top: `${(y / VIEW_H) * 100}%`,
                      color: step.accent,
                    }}
                  >
                    {step.label}
                  </span>
                );
              })}
            </div>

            <div className="bie-brain-status-chips" style={{ top: `${CORE_Y_PCT - 14}%` }} aria-hidden>
              {STATUS_CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  className="bie-brain-status-chip"
                  style={{ ["--chip-accent" as string]: chip.accent }}
                >
                  {chip.label}
                </span>
              ))}
            </div>

            <div className="bie-brain-core-zone" style={{ top: `${CORE_Y_PCT}%` }}>
              <span className="bie-brain-core-label">BIE</span>
              <span className="bie-brain-core-caption" key={phraseIndex}>
                {CORE_PHRASES[phraseIndex]}
              </span>
            </div>
          </div>
          <p className="bie-brain-scroll-hint" aria-hidden>
            Scroll the pipeline →
          </p>
        </div>

        <div className="bie-brain-output-stack-rail" aria-hidden>
          {OUTPUT_STACK.map((step, i) => (
            <span key={step.id} className="bie-brain-output-stack-rail-segment">
              <span
                className={`bie-brain-output-stack-rail-step${"core" in step && step.core ? " bie-brain-output-stack-rail-step-core" : ""}`}
                style={{ color: step.accent }}
              >
                {step.label}
              </span>
              {i < OUTPUT_STACK.length - 1 && <span className="bie-brain-output-stack-rail-arrow">↑</span>}
            </span>
          ))}
        </div>
      </div>

      <p className="bie-brain-products-eyebrow">Platform instruments · powered by BIE</p>
      <div className="bie-brain-product-rail">
        {PRODUCTS.map((n) => (
          <Link key={n.name} href={n.href} className="bie-brain-node" style={{ ["--node-accent" as string]: n.accent }}>
            <span className="bie-brain-node-swatch" />
            {n.name}
          </Link>
        ))}
      </div>

      <p className="bie-brain-tagline">
        Every number validated <span className="bie-brain-tagline-accent">before you see it.</span>
      </p>
    </div>
  );
}
