"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCenterHelix,
  buildFieldParticles,
  buildImpulsePath,
  buildInboundPulsePath,
  buildIntelligenceRings,
  buildRingFieldNodes,
  buildRingSegmentPath,
  fieldGlowRadii,
  type FieldParticle,
  type RingFieldNode,
} from "./bie-helix-engine";

// Original-scale helix at center; large intelligence field with ring nodes + slow pulses.

export const VIEW_W = 1280;
export const VIEW_H = 720;
const CORE = { x: VIEW_W / 2, y: VIEW_H / 2 };
/** Large field — rings span most of the hero. */
const MAX_RX = 580;
const MAX_RY = 308;
/** Original helix proportions (institutional reactor v1 — do not scale). */
const HELIX_H = 320;
const HELIX_W = 92;
const FIELD_COUNT = 90;
const FIELD_RINGS = [1, 2, 3, 4] as const;
const NODES_PER_RING = 5;

const READOUT_LINES = [
  "continuous market intelligence — ingested, verified, never assumed",
  "trust the output because validation happened first",
  "the engine never stops learning from every session, every market day",
];

type ReactorPhase = "idle" | "inbound" | "core" | "ripple";

function useFieldParticles(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  reduceMotion: boolean
) {
  const particlesRef = useRef<FieldParticle[]>([]);

  useEffect(() => {
    particlesRef.current = buildFieldParticles(FIELD_COUNT, VIEW_W, VIEW_H, CORE.x, CORE.y, MAX_RX, MAX_RY);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduceMotion) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const padX = VIEW_W * 0.04;
    const padY = VIEW_H * 0.05;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / VIEW_W;
      const sy = rect.height / VIEW_H;
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.scale(sx, sy);

      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        if (p.life <= 0) {
          const i = particlesRef.current.indexOf(p);
          const fresh = buildFieldParticles(1, VIEW_W, VIEW_H, CORE.x, CORE.y, MAX_RX, MAX_RY)[0];
          particlesRef.current[i] = { ...fresh, life: fresh.maxLife };
        }
        if (p.x < padX) p.x = VIEW_W - padX;
        if (p.x > VIEW_W - padX) p.x = padX;
        if (p.y < padY) p.y = VIEW_H - padY;
        if (p.y > VIEW_H - padY) p.y = padY;

        const fade = Math.min(1, p.life / 40, (p.maxLife - p.life) / 40);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(148, 226, 255, ${p.opacity * fade * 0.75})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduceMotion, canvasRef]);
}

function nodesOnRing(all: RingFieldNode[], ring: 1 | 2 | 3 | 4): RingFieldNode[] {
  return all.filter((n) => n.ring === ring);
}

export function BieBrainBanner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [lineIndex, setLineIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phase, setPhase] = useState<ReactorPhase>("idle");
  const [pulseKey, setPulseKey] = useState(0);
  const [pulsePath, setPulsePath] = useState("");
  const [rippleKey, setRippleKey] = useState(0);

  const helix = useMemo(() => buildCenterHelix(CORE.x, CORE.y, HELIX_H, HELIX_W), []);
  const rings = useMemo(
    () => buildIntelligenceRings(CORE.x, CORE.y, MAX_RX, MAX_RY).filter((r) => FIELD_RINGS.includes(r.ring as 1 | 2 | 3 | 4)),
    []
  );
  const ringNodes = useMemo(
    () => buildRingFieldNodes(CORE.x, CORE.y, MAX_RX, MAX_RY, FIELD_RINGS, NODES_PER_RING),
    []
  );
  const fieldGlow = useMemo(() => fieldGlowRadii(VIEW_W, VIEW_H), []);

  useFieldParticles(canvasRef, reduceMotion);

  useEffect(() => {
    const id = setInterval(() => setLineIndex((i) => (i + 1) % READOUT_LINES.length), 3600);
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
    if (reduceMotion) {
      setPhase("idle");
      return;
    }

    let cancelled = false;
    let useRadial = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const fire = () => {
      if (cancelled) return;
      useRadial = !useRadial;
      if (useRadial) {
        const angle = 20 + Math.random() * 300;
        setPulsePath(buildImpulsePath(CORE.x, CORE.y, angle, MAX_RX, MAX_RY));
      } else {
        const outer = ringNodes.filter((n) => n.ring === 4);
        const pick = outer[Math.floor(Math.random() * outer.length)];
        if (pick) setPulsePath(buildInboundPulsePath(pick.x, pick.y, CORE.x, CORE.y));
      }
      setPulseKey((k) => k + 1);
      setPhase("inbound");
      timers.push(setTimeout(() => !cancelled && setPhase("core"), 900));
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setPhase("ripple");
        setRippleKey((k) => k + 1);
      }, 1400));
      timers.push(setTimeout(() => !cancelled && setPhase("idle"), 2600));
      timers.push(setTimeout(fire, 6200 + Math.random() * 2800));
    };

    fire();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion, ringNodes]);

  const litRing = phase === "inbound" ? 4 : phase === "core" || phase === "ripple" ? 2 : -1;

  return (
    <div className={`bie-brain-banner bie-brain-hero bie-reactor-hero${reduceMotion ? "" : " bie-reactor-live"}`}>
      <div
        className="bie-brain-diagram bie-reactor-diagram bie-reactor-stage bie-field-stage"
        role="img"
        aria-label="BlackOut Intelligence Engine: original-scale helix at center, surrounded by four intelligence rings with glowing nodes and slow pulses."
        style={{ ["--reactor-cx" as string]: `${CORE.x}px`, ["--reactor-cy" as string]: `${CORE.y}px` }}
      >
        <div className="bie-brain-canvas bie-reactor-canvas bie-field-canvas">
          <canvas ref={canvasRef} className="bie-reactor-particles bie-field-particles" aria-hidden />

          <svg
            className="bie-brain-svg bie-reactor-svg bie-field-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <radialGradient id="bie-field-glow" cx="50%" cy="48%" r="50%">
                <stop offset="0%" stopColor="rgba(0,229,255,0.14)" />
                <stop offset="42%" stopColor="rgba(0,229,255,0.05)" />
                <stop offset="100%" stopColor="rgba(0,229,255,0)" />
              </radialGradient>
              <radialGradient id="bie-core-grad" cx="38%" cy="32%" r="72%">
                <stop offset="0%" stopColor="#5df7ff" />
                <stop offset="42%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor="#0a3b45" />
              </radialGradient>
              <linearGradient id="bie-helix-strand-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#5df7ff" stopOpacity="0.95" />
                <stop offset="50%" stopColor="#00e5ff" stopOpacity="1" />
                <stop offset="100%" stopColor="#bf5fff" stopOpacity="0.85" />
              </linearGradient>
              <filter id="bie-helix-classic-bloom" x="-60%" y="-20%" width="220%" height="140%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <ellipse
              cx={CORE.x}
              cy={CORE.y}
              rx={fieldGlow.rx}
              ry={fieldGlow.ry}
              fill="url(#bie-field-glow)"
              className="bie-field-glow"
            />

            {rings.map((ring) => {
              const onRing = nodesOnRing(ringNodes, ring.ring as 1 | 2 | 3 | 4);
              const bow = 10 + ring.ring * 4;
              return (
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
                  <ellipse cx={CORE.x} cy={CORE.y} rx={ring.rx} ry={ring.ry} className="bie-reactor-ring-stroke bie-field-ring-stroke" />
                  {onRing.map((node, i) => {
                    const next = onRing[(i + 1) % onRing.length];
                    const segId = `bie-ring-seg-${ring.ring}-${i}`;
                    const segPath = buildRingSegmentPath(node.x, node.y, next.x, next.y, CORE.x, CORE.y, bow);
                    const pulseDur = 5.8 + ring.ring * 0.9 + i * 0.35;
                    return (
                      <g key={node.id}>
                        <path id={segId} d={segPath} className="bie-ring-segment-track" pathLength={1} />
                        <circle cx={node.x} cy={node.y} r={2.2} className="bie-ring-node" />
                        {!reduceMotion && (
                          <circle r={1.5} className="bie-ring-pulse-dot" fill="#5df7ff">
                            <animateMotion
                              dur={`${pulseDur}s`}
                              begin={`-${i * (pulseDur / onRing.length)}s`}
                              repeatCount="indefinite"
                              calcMode="linear"
                            >
                              <mpath href={`#${segId}`} />
                            </animateMotion>
                          </circle>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            <g className="bie-reactor-helix bie-reactor-helix-classic" filter="url(#bie-helix-classic-bloom)">
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
                  strokeOpacity={0.12 + 0.55 * r.depth}
                  strokeWidth={0.35 + 1.1 * r.depth}
                />
              ))}
            </g>

            {!reduceMotion && phase !== "idle" && pulsePath && (
              <g key={pulseKey} className="bie-reactor-pulse-wave bie-reactor-pulse-inbound">
                <path id="bie-reactor-impulse" d={pulsePath} className="bie-reactor-impulse-track" pathLength={1} />
                <circle r={2.2} className="bie-reactor-impulse-dot" fill="#5df7ff">
                  <animateMotion dur="1.45s" repeatCount="1" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1">
                    <mpath href="#bie-reactor-impulse" />
                  </animateMotion>
                </circle>
              </g>
            )}

            <g
              className={`bie-reactor-core bie-reactor-core-classic${phase === "core" || phase === "ripple" ? " is-active" : ""}`}
              transform={`translate(${CORE.x}, ${CORE.y})`}
            >
              {!reduceMotion && phase === "ripple" && (
                <circle key={`rip-${rippleKey}`} cx={0} cy={0} r={36} className="bie-field-ripple bie-field-ripple-a" />
              )}
              <circle cx={0} cy={0} r={36} className="bie-reactor-core-halo" />
              <circle cx={0} cy={0} r={20} className="bie-brain-core bie-reactor-core-nucleus" />
            </g>
          </svg>

          <span className="bie-brain-core-label bie-reactor-core-label bie-reactor-core-label-classic" aria-hidden>
            BIE
          </span>

          <div className="bie-field-caption">
            <span className="bie-brain-eyebrow">
              <span className="bie-brain-eyebrow-dot" aria-hidden />
              The operating brain of BlackOut
            </span>
            <h2 className="bie-brain-title">BlackOut Intelligence Engine</h2>
            <p className="bie-brain-sub">{READOUT_LINES[lineIndex]}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
