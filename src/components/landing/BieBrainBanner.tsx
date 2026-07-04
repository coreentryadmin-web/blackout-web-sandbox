"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildCenterHelix,
  buildHeroSweepPath,
  buildImpulsePath,
  buildIntelligenceRings,
  buildFlowParticles,
  flowParticlePosition,
  buildStarField,
  placeCapabilities,
  type PlacedCapability,
  type Capability,
} from "./bie-helix-engine";

// Hero-scale institutional reactor — ~2× footprint; title supports the animation.

export const VIEW_W = 1280;
export const VIEW_H = 720;
const CORE = { x: VIEW_W / 2, y: VIEW_H / 2 };
const MAX_RX = 420;
const MAX_RY = 200;
const HELIX_H = 600;
const HELIX_W = 176;
const HELIX_TRAVELERS = [
  { path: "a", dur: "3.8s", begin: "0s", r: 2.2 },
  { path: "a", dur: "5.4s", begin: "-2.1s", r: 1.6 },
  { path: "b", dur: "4.6s", begin: "-1.2s", r: 2 },
  { path: "b", dur: "6.2s", begin: "-3.4s", r: 1.4 },
] as const;

const FLOW_COUNT = 64;
const STAR_COUNT = 480;

const CAPABILITIES: Capability[] = [
  { id: "pattern", label: "Pattern Recognition", detail: "Regime structure and repeat setups across sessions", angleDeg: 312, ring: 1, accent: "#bf5fff" },
  { id: "memory", label: "Memory", detail: "Every alert, outcome, and precedent informs the next call", angleDeg: 48, ring: 1, accent: "#bf5fff" },
  { id: "validation", label: "Validation", detail: "Integrity, consistency, and real-time self-audit", angleDeg: 128, ring: 2, accent: "#00e676" },
  { id: "confidence", label: "Confidence", detail: "Every number grounded or withheld — never fabricated", angleDeg: 208, ring: 2, accent: "#00e676" },
  { id: "risk", label: "Risk Analysis", detail: "Confidence gates and invalidation before anything ships", angleDeg: 288, ring: 4, accent: "#5df7ff" },
];

type OutputProduct = { name: string; href: string; accent: string };

const PRODUCTS: OutputProduct[] = [
  { name: "SPX Slayer", href: "/dashboard", accent: "#00e676" },
  { name: "HELIX", href: "/flows", accent: "#bf5fff" },
  { name: "BlackOut Thermal", href: "/heatmap", accent: "#ff6b2b" },
  { name: "Largo", href: "/terminal", accent: "#22d3ee" },
  { name: "Night Hawk", href: "/nighthawk", accent: "#ff2d55" },
  { name: "BlackOut Grid", href: "/grid", accent: "#ffcc4d" },
];

const READOUT_LINES = [
  "continuous market intelligence — ingested, verified, never assumed",
  "every heat map, GEX read, and play checked before it reaches your screen",
  "signals are reasoned and confidence-scored — not guessed",
  "the engine never stops learning from every session, every market day",
  "trust the output because validation happened first",
];

type ReactorPhase = "idle" | "inbound" | "core" | "outbound";
type PulseMode = "radial" | "sweep";

function useLiveOnView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, visible };
}

function useReactorParticles(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  reduceMotion: boolean
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduceMotion) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const stars = buildStarField(CORE.x, CORE.y, MAX_RX, MAX_RY, STAR_COUNT);
    const flows = buildFlowParticles(FLOW_COUNT);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let frame = 0;
    let raf = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / VIEW_W;
      const sy = rect.height / VIEW_H;
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.scale(sx, sy);

      for (const s of stars) {
        const tw = 0.9 + 0.1 * Math.sin(frame * 0.006 + s.phase);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(148, 226, 255, ${s.opacity * tw})`;
        ctx.fill();
      }

      for (const p of flows) {
        p.angle += p.speed * 48;
        p.dist -= p.speed * 1.05;
        if (p.dist < 0.06) {
          p.dist = 0.82 + Math.random() * 0.14;
          p.angle = Math.random() * 360;
        }
        const { x, y } = flowParticlePosition(CORE.x, CORE.y, MAX_RX, MAX_RY, p);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(93, 247, 255, ${p.opacity})`;
        ctx.fill();
      }

      frame++;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduceMotion, canvasRef]);
}

export function BieBrainBanner() {
  const { ref: diagramRef, visible } = useLiveOnView<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [lineIndex, setLineIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hovered, setHovered] = useState<PlacedCapability | null>(null);
  const [phase, setPhase] = useState<ReactorPhase>("idle");
  const [pulseKey, setPulseKey] = useState(0);
  const [pulseAngle, setPulseAngle] = useState(40);
  const [pulseMode, setPulseMode] = useState<PulseMode>("sweep");
  const [sweepLane, setSweepLane] = useState(0);

  const helix = useMemo(() => buildCenterHelix(CORE.x, CORE.y, HELIX_H, HELIX_W), []);
  const rings = useMemo(() => buildIntelligenceRings(CORE.x, CORE.y, MAX_RX, MAX_RY), []);
  const anchors = useMemo(() => placeCapabilities(CORE.x, CORE.y, CAPABILITIES, MAX_RX, MAX_RY), []);
  const radialPath = useMemo(
    () => buildImpulsePath(CORE.x, CORE.y, pulseAngle, MAX_RX, MAX_RY),
    [pulseAngle]
  );
  const sweepPath = useMemo(
    () => buildHeroSweepPath(VIEW_W, CORE.y, CORE.x, sweepLane),
    [sweepLane]
  );
  const activePulsePath = pulseMode === "sweep" ? sweepPath : radialPath;

  useReactorParticles(canvasRef, reduceMotion);

  useEffect(() => {
    const id = setInterval(() => setLineIndex((i) => (i + 1) % READOUT_LINES.length), 3200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const el = svgRef.current;
    if (el && typeof el.unpauseAnimations === "function") el.unpauseAnimations();
  }, [visible]);

  useEffect(() => {
    if (reduceMotion) {
      setPhase("idle");
      return;
    }

    let cancelled = false;
    let sweep = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const fire = () => {
      if (cancelled) return;
      const mode: PulseMode = sweep ? "sweep" : "radial";
      sweep = !sweep;
      setPulseMode(mode);
      setPulseAngle(20 + Math.random() * 300);
      setSweepLane(-36 + Math.random() * 72);
      setPulseKey((k) => k + 1);
      setPhase("inbound");
      timers.push(setTimeout(() => !cancelled && setPhase("core"), mode === "sweep" ? 1100 : 950));
      timers.push(setTimeout(() => !cancelled && setPhase("outbound"), mode === "sweep" ? 1900 : 1650));
      timers.push(setTimeout(() => !cancelled && setPhase("idle"), mode === "sweep" ? 2800 : 2500));
      timers.push(setTimeout(fire, 4600 + Math.random() * 2400));
    };

    fire();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion]);

  const litRing =
    phase === "inbound" ? 4 : phase === "outbound" ? 2 : phase === "core" ? 1 : -1;

  const onAnchorEnter = useCallback((c: PlacedCapability) => setHovered(c), []);
  const onAnchorLeave = useCallback(() => setHovered(null), []);

  const pulseDur = pulseMode === "sweep" ? "2.6s" : "2s";

  return (
    <div className={`bie-brain-banner bie-brain-hero${reduceMotion ? "" : " bie-reactor-live"}`}>
      <div
        ref={diagramRef}
        className="bie-brain-diagram bie-reactor-diagram bie-reactor-stage"
        role="img"
        aria-label="BlackOut Intelligence Engine reactor: a large helix core surrounded by intelligence rings. Hover ring nodes to explore capabilities."
        style={{ ["--reactor-cx" as string]: `${CORE.x}px`, ["--reactor-cy" as string]: `${CORE.y}px` }}
      >
        <div className="bie-brain-canvas bie-reactor-canvas">
          <canvas ref={canvasRef} className="bie-reactor-particles" aria-hidden />

          <svg
            ref={svgRef}
            className="bie-brain-svg bie-reactor-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <radialGradient id="bie-core-grad" cx="38%" cy="32%" r="72%">
                <stop offset="0%" stopColor="#5df7ff" />
                <stop offset="42%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor="#0a3b45" />
              </radialGradient>
              <radialGradient id="bie-reactor-vignette" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(0,229,255,0.22)" />
                <stop offset="55%" stopColor="rgba(191,95,255,0.08)" />
                <stop offset="100%" stopColor="rgba(0,229,255,0)" />
              </radialGradient>
              <linearGradient id="bie-helix-strand-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#5df7ff" stopOpacity="0.95" />
                <stop offset="50%" stopColor="#00e5ff" stopOpacity="1" />
                <stop offset="100%" stopColor="#bf5fff" stopOpacity="0.85" />
              </linearGradient>
              <filter id="bie-helix-hero-bloom" x="-50%" y="-15%" width="200%" height="130%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <circle cx={CORE.x} cy={CORE.y} r={MAX_RX * 0.96} fill="url(#bie-reactor-vignette)" className="bie-reactor-vignette" />

            {rings.map((ring) => (
              <g
                key={`ring-${ring.ring}`}
                className={`bie-reactor-ring bie-reactor-ring-${ring.ring}${litRing === ring.ring ? " is-lit" : ""}`}
                style={
                  {
                    ["--ring-period" as string]: `${ring.periodSec}s`,
                    ["--ring-reverse" as string]: ring.reverse ? "reverse" : "normal",
                  } as React.CSSProperties
                }
              >
                <ellipse cx={CORE.x} cy={CORE.y} rx={ring.rx} ry={ring.ry} className="bie-reactor-ring-stroke" />
              </g>
            ))}

            <g className="bie-reactor-helix" filter="url(#bie-helix-hero-bloom)">
              <path id="bie-helix-path-a" d={helix.strandA} fill="none" stroke="none" />
              <path id="bie-helix-path-b" d={helix.strandB} fill="none" stroke="none" />
              <path d={helix.strandA} className="bie-reactor-helix-strand" fill="none" stroke="url(#bie-helix-strand-grad)" />
              <path d={helix.strandB} className="bie-reactor-helix-strand bie-reactor-helix-strand-b" fill="none" stroke="url(#bie-helix-strand-grad)" />
              {helix.rungs.map((r, i) => (
                <line
                  key={`hr-${i}`}
                  x1={r.x1}
                  y1={r.y1}
                  x2={r.x2}
                  y2={r.y2}
                  className="bie-reactor-helix-rung"
                  strokeOpacity={0.14 + 0.58 * r.depth}
                  strokeWidth={0.45 + 1.35 * r.depth}
                  style={{ animationDelay: `${-(i * 0.14)}s` }}
                />
              ))}
              {!reduceMotion &&
                HELIX_TRAVELERS.map((t, i) => (
                  <circle key={`ht-${i}`} r={t.r} className="bie-reactor-helix-traveler" fill="#5df7ff">
                    <animateMotion dur={t.dur} begin={t.begin} repeatCount="indefinite" rotate="auto">
                      <mpath href={`#bie-helix-path-${t.path}`} />
                    </animateMotion>
                  </circle>
                ))}
            </g>

            {!reduceMotion && phase !== "idle" && (
              <g key={pulseKey} className={`bie-reactor-pulse-wave bie-reactor-pulse-${pulseMode}`}>
                <path id="bie-reactor-impulse" d={activePulsePath} className="bie-reactor-impulse-track" pathLength={1} />
                <circle r={pulseMode === "sweep" ? 3.2 : 2.8} className="bie-reactor-impulse-dot" fill="#5df7ff">
                  <animateMotion dur={pulseDur} repeatCount="1" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.35 0 0.2 1">
                    <mpath href="#bie-reactor-impulse" />
                  </animateMotion>
                </circle>
              </g>
            )}

            {anchors.map((c) => (
              <g
                key={c.id}
                className={`bie-reactor-anchor${hovered?.id === c.id ? " is-active" : ""}${litRing === c.ring ? " is-lit" : ""}`}
                transform={`translate(${c.x}, ${c.y})`}
                onMouseEnter={() => onAnchorEnter(c)}
                onMouseLeave={onAnchorLeave}
                onFocus={() => onAnchorEnter(c)}
                onBlur={onAnchorLeave}
                tabIndex={0}
                role="button"
                aria-label={`${c.label}: ${c.detail}`}
              >
                <circle r={18} className="bie-reactor-anchor-hit" fill="transparent" />
                <circle r={2.8} className="bie-reactor-anchor-dot" fill={c.accent} />
              </g>
            ))}

            <g
              className={`bie-reactor-core${phase === "core" || phase === "outbound" ? " is-active" : ""}`}
              transform={`translate(${CORE.x}, ${CORE.y})`}
            >
              {!reduceMotion && (
                <>
                  <circle cx={0} cy={0} r={92} className="bie-reactor-ambient-pulse bie-reactor-ambient-pulse-a" />
                  <circle cx={0} cy={0} r={92} className="bie-reactor-ambient-pulse bie-reactor-ambient-pulse-b" />
                </>
              )}
              <circle cx={0} cy={0} r={68} className="bie-reactor-core-halo" />
              <circle cx={0} cy={0} r={48} className="bie-reactor-core-ring" />
              <circle cx={0} cy={0} r={36} className="bie-brain-core bie-reactor-core-nucleus" />
            </g>
          </svg>

          <span className="bie-brain-core-label bie-reactor-core-label" aria-hidden>
            BIE
          </span>

          {hovered && (
            <div
              className="bie-reactor-tooltip"
              style={{
                left: `${(hovered.x / VIEW_W) * 100}%`,
                top: `${(hovered.y / VIEW_H) * 100}%`,
                ["--tip-accent" as string]: hovered.accent,
              }}
              role="tooltip"
            >
              <span className="bie-reactor-tooltip-title">{hovered.label}</span>
              <span className="bie-reactor-tooltip-detail">{hovered.detail}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bie-brain-heading bie-brain-heading-caption">
        <span className="bie-brain-eyebrow">
          <span className="bie-brain-eyebrow-dot" aria-hidden />
          The operating brain of BlackOut
        </span>
        <h2 className="bie-brain-title">BlackOut Intelligence Engine</h2>
        <p className="bie-brain-sub">{READOUT_LINES[lineIndex]}</p>
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
