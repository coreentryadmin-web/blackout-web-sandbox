"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MARK_ACCENT } from "@/components/marks/ProductMark";
import {
  buildAmbientFieldMesh,
  buildAtmosphereGlows,
  buildFieldLineRings,
  buildFieldParticles,
  buildInboundPulsePath,
  buildInnerFieldNodes,
  buildRingSegmentPath,
  fieldGlowRadii,
  pointOnFieldLine,
  type FieldLineRing,
  type FieldParticle,
  type RingFieldNode,
} from "./bie-helix-engine";
import { BieOrbitTools, type OrbitTool } from "./BieOrbitTools";

/**
 * Milestone 1 — Composition.
 * The viewport IS the intelligence field. Core (~20–30%) sits inside atmosphere (~70–80%).
 * See docs/design/BIE-HERO-VISION.md
 */

export const VIEW_W = 1280;
export const VIEW_H = 720;
const CORE = { x: VIEW_W / 2, y: VIEW_H * 0.5 };
/** Half viewBox width — ring 6 at scale 1.0 spans edge-to-edge horizontally. */
const MAX_RX = VIEW_W / 2;
const MAX_RY = 310;
const FIELD_COUNT = 120;
const INNER_RINGS = [1, 2] as const;
const INNER_NODES = 6;

const READOUT_LINES = [
  "continuous market intelligence — ingested, verified, never assumed",
  "trust the output because validation happened first",
  "the engine never stops learning from every session, every market day",
];

const FIELD_TOOLS: OrbitTool[] = [
  { name: "SPX Slayer", href: "/dashboard", mark: "spx", accent: MARK_ACCENT.spx },
  { name: "HELIX", href: "/flows", mark: "helix", accent: MARK_ACCENT.helix },
  { name: "BlackOut Thermal", href: "/heatmap", mark: "heatmap", accent: MARK_ACCENT.heatmap },
  { name: "BlackOut Grid", href: "/grid", mark: "grid", accent: MARK_ACCENT.grid },
  { name: "Largo", href: "/terminal", mark: "largo", accent: MARK_ACCENT.largo },
  { name: "Night Hawk", href: "/nighthawk", mark: "nighthawk", accent: MARK_ACCENT.nighthawk },
];

type ReactorPhase = "idle" | "inbound" | "absorb" | "ripple";

/** Which field rings brighten during each phase of the processing cycle. */
function litRingsForPhase(phase: ReactorPhase): number[] {
  switch (phase) {
    case "inbound":
      return [5, 6];
    case "absorb":
      return [1, 2];
    case "ripple":
      return [3, 4];
    default:
      return [];
  }
}

function pickInboundOrigin(): { x: number; y: number } {
  const useOuter = Math.random() < 0.65;
  const ring = useOuter ? 6 : 5;
  const scale = useOuter ? 1 : 0.88;
  const angle = 8 + Math.random() * 344;
  return pointOnFieldLine(CORE.x, CORE.y, MAX_RX, MAX_RY, scale, ring, angle);
}

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
    const padX = VIEW_W * 0.01;
    const padY = VIEW_H * 0.01;
    let viewW = VIEW_W;
    let viewH = VIEW_H;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      viewW = rect.width;
      viewH = rect.height;
      canvas.width = Math.max(1, Math.floor(viewW * dpr));
      canvas.height = Math.max(1, Math.floor(viewH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;

    const draw = (now: number) => {
      const sx = viewW / VIEW_W;
      const sy = viewH / VIEW_H;
      ctx.fillStyle = "#040407";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.save();
      ctx.scale(sx, sy);

      const tSec = now / 1000;

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

        const lifeFade = Math.min(1, p.life / 40, (p.maxLife - p.life) / 40);
        const twinkle = 0.38 + 0.62 * (0.5 + 0.5 * Math.sin(tSec * p.twinkleSpeed + p.twinklePhase));
        const alpha = p.opacity * lifeFade * twinkle;

        ctx.save();
        ctx.shadowBlur = p.size * 4.2;
        ctx.shadowColor = `rgba(255, 210, 80, ${Math.min(0.95, alpha * 1.1)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 236, 160, ${alpha})`;
        ctx.fill();
        ctx.restore();
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

function innerNodes(all: RingFieldNode[], ring: 1 | 2): RingFieldNode[] {
  return all.filter((n) => n.ring === ring);
}

function pairedInnerLinks(nodes: RingFieldNode[]): { a: RingFieldNode; b: RingFieldNode; key: string }[] {
  const r1 = innerNodes(nodes, 1);
  const r2 = innerNodes(nodes, 2);
  const n = Math.min(r1.length, r2.length);
  return Array.from({ length: n }, (_, i) => ({
    a: r1[i],
    b: r2[i],
    key: `link-${i}`,
  }));
}

export function BieBrainBanner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [lineIndex, setLineIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phase, setPhase] = useState<ReactorPhase>("idle");
  const [pulseKey, setPulseKey] = useState(0);
  const [pulsePath, setPulsePath] = useState("");
  const [rippleKey, setRippleKey] = useState(0);

  const fieldLines = useMemo(() => buildFieldLineRings(CORE.x, CORE.y, MAX_RX, MAX_RY), []);
  const atmosphereGlows = useMemo(() => buildAtmosphereGlows(CORE.x, CORE.y, MAX_RX, MAX_RY), []);
  const ambientMesh = useMemo(() => buildAmbientFieldMesh(CORE.x, CORE.y, MAX_RX, MAX_RY), []);
  const innerFieldNodes = useMemo(
    () => buildInnerFieldNodes(CORE.x, CORE.y, MAX_RX, MAX_RY, INNER_RINGS, INNER_NODES),
    []
  );
  const innerLinks = useMemo(() => pairedInnerLinks(innerFieldNodes), [innerFieldNodes]);
  const fieldGlow = useMemo(() => fieldGlowRadii(VIEW_W, VIEW_H), []);

  const outerLines = fieldLines.filter((r) => r.layer === "outer");
  const midLines = fieldLines.filter((r) => r.layer === "mid");
  const innerLines = fieldLines.filter((r) => r.layer === "inner");

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
    const timers: ReturnType<typeof setTimeout>[] = [];

    const schedule = (fn: () => void, ms: number) => {
      timers.push(setTimeout(() => !cancelled && fn(), ms));
    };

    /** Signal enters → core absorbs → ripple outward. Repeats every ~5.5–7.5s. */
    const fireCycle = () => {
      if (cancelled) return;

      const origin = pickInboundOrigin();
      setPulsePath(buildInboundPulsePath(origin.x, origin.y, CORE.x, CORE.y));
      setPulseKey((k) => k + 1);
      setPhase("inbound");

      schedule(() => setPhase("absorb"), 1180);
      schedule(() => {
        setPhase("ripple");
        setRippleKey((k) => k + 1);
      }, 1520);
      schedule(() => setPhase("idle"), 3400);
      schedule(fireCycle, 5600 + Math.floor(Math.random() * 1900));
    };

    fireCycle();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion]);

  const litRings = litRingsForPhase(phase);
  const coreActive = phase === "absorb" || phase === "ripple";
  const coreAbsorbing = phase === "absorb";

  const renderFieldLine = (ring: FieldLineRing, opts: { showNodes: boolean; loopPulse: boolean }) => {
    const onRing = opts.showNodes ? innerNodes(innerFieldNodes, ring.ring as 1 | 2) : [];
    const isLit = litRings.includes(ring.ring);
    return (
      <g
        key={`field-${ring.ring}`}
        className={`bie-reactor-ring bie-field-line bie-field-line-${ring.layer} bie-field-line-${ring.ring}${isLit ? " is-lit" : ""}`}
        style={
          {
            ["--ring-period" as string]: `${ring.periodSec}s`,
            ["--ring-reverse" as string]: ring.reverse ? "reverse" : "normal",
          } as React.CSSProperties
        }
      >
        <path d={ring.d} className="bie-field-line-stroke" pathLength={1} />
        {opts.loopPulse && !reduceMotion && (
          <circle r={2} className="bie-field-loop-pulse bie-star-pulse-dot" fill="#ffd966">
            <animateMotion
              dur={`${16 + ring.ring * 2.8}s`}
              begin={`-${ring.ring * 2.4}s`}
              repeatCount="indefinite"
              calcMode="linear"
            >
              <mpath href={`#bie-field-loop-${ring.ring}`} />
            </animateMotion>
          </circle>
        )}
        <path id={`bie-field-loop-${ring.ring}`} d={ring.d} className="bie-reactor-impulse-track" pathLength={1} />
        {onRing.map((node, i) => {
          const next = onRing[(i + 1) % onRing.length];
          const segId = `bie-inner-seg-${ring.ring}-${i}`;
          const segPath = buildRingSegmentPath(node.x, node.y, next.x, next.y, CORE.x, CORE.y, 8 + ring.ring * 3);
          return (
            <g key={node.id}>
              <path id={segId} d={segPath} className="bie-ring-segment-track" pathLength={1} />
              <circle cx={node.x} cy={node.y} r={4.8} className="bie-ring-node bie-inner-node bie-star-node" style={{ animationDelay: `${(i * 0.55 + ring.ring * 0.35).toFixed(2)}s` }} />
              {!reduceMotion && (
                <circle r={2.4} className="bie-ring-pulse-dot bie-star-pulse-dot" fill="#ffe08a">
                  <animateMotion
                    dur={`${6.2 + ring.ring * 0.8 + i * 0.4}s`}
                    begin={`-${i * 1.1}s`}
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
  };

  return (
    <div className={`bie-brain-banner bie-brain-hero bie-reactor-hero bie-intelligence-field bie-reactor-phase-${phase}${reduceMotion ? "" : " bie-reactor-live"}`}>
      <div
        className="bie-brain-diagram bie-reactor-diagram bie-reactor-stage bie-field-stage"
        role="img"
        aria-label="BlackOut Intelligence Engine: you are inside the living intelligence field that powers the platform."
        style={{ ["--reactor-cx" as string]: `${CORE.x}px`, ["--reactor-cy" as string]: `${CORE.y}px` }}
      >
        <div className="bie-brain-canvas bie-reactor-canvas bie-field-canvas">
          <div className="bie-field-visual">
          <canvas ref={canvasRef} className="bie-reactor-particles bie-field-particles" aria-hidden />

          <svg
            className="bie-brain-svg bie-reactor-svg bie-field-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <radialGradient id="bie-field-base" cx="50%" cy="50%" r="72%">
                <stop offset="0%" stopColor="rgba(4, 12, 18, 0.95)" />
                <stop offset="55%" stopColor="rgba(4, 6, 10, 0.98)" />
                <stop offset="100%" stopColor="rgba(4, 4, 7, 1)" />
              </radialGradient>
              <radialGradient id="bie-field-glow" cx="50%" cy="50%" r="52%">
                <stop offset="0%" stopColor="rgba(0,229,255,0.14)" />
                <stop offset="40%" stopColor="rgba(0,229,255,0.05)" />
                <stop offset="100%" stopColor="rgba(0,229,255,0)" />
              </radialGradient>
              <radialGradient id="bie-field-vignette" cx="50%" cy="50%" r="72%">
                <stop offset="74%" stopColor="rgba(4,4,7,0)" />
                <stop offset="100%" stopColor="rgba(4,4,7,0.18)" />
              </radialGradient>
              <radialGradient id="bie-core-grad" cx="38%" cy="32%" r="72%">
                <stop offset="0%" stopColor="#5df7ff" />
                <stop offset="42%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor="#0a3b45" />
              </radialGradient>
            </defs>

            <rect width={VIEW_W} height={VIEW_H} fill="url(#bie-field-base)" className="bie-field-base" />

            {atmosphereGlows.map((g) => (
              <ellipse
                key={g.id}
                cx={CORE.x}
                cy={CORE.y}
                rx={g.rx}
                ry={g.ry}
                className={`bie-atmosphere-glow bie-atmosphere-glow-${g.tier}`}
              />
            ))}

            <ellipse
              cx={CORE.x}
              cy={CORE.y}
              rx={fieldGlow.rx}
              ry={fieldGlow.ry}
              fill="url(#bie-field-glow)"
              className="bie-field-glow"
            />

            <g className="bie-ambient-mesh" aria-hidden>
              {ambientMesh.map((line) => (
                <path key={line.id} d={line.d} className="bie-ambient-mesh-line" />
              ))}
            </g>

            <rect width={VIEW_W} height={VIEW_H} fill="url(#bie-field-vignette)" className="bie-field-vignette" pointerEvents="none" />

            {outerLines.map((ring) => renderFieldLine(ring, { showNodes: false, loopPulse: true }))}

            {midLines.map((ring) => renderFieldLine(ring, { showNodes: false, loopPulse: ring.ring === 4 }))}

            {innerLines.map((ring) => renderFieldLine(ring, { showNodes: true, loopPulse: false }))}

            {!reduceMotion &&
              innerLinks.map((link, i) => {
                const pathId = `bie-inner-link-${i}`;
                const d = buildRingSegmentPath(link.a.x, link.a.y, link.b.x, link.b.y, CORE.x, CORE.y, 6);
                return (
                  <g key={link.key} className="bie-inner-connection">
                    <path id={pathId} d={d} className="bie-inner-link-track" pathLength={1} />
                    <circle r={1.2} className="bie-inner-link-pulse" fill="#bf5fff">
                      <animateMotion
                        dur={`${8.5 + i * 0.6}s`}
                        begin={`-${i * 1.4}s`}
                        repeatCount="indefinite"
                        calcMode="linear"
                      >
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  </g>
                );
              })}

            {!reduceMotion && phase === "inbound" && pulsePath && (
              <g key={pulseKey} className="bie-reactor-pulse-wave bie-reactor-pulse-inbound">
                <path id="bie-reactor-impulse" d={pulsePath} className="bie-reactor-impulse-track" pathLength={1} />
                <circle r={2.6} className="bie-reactor-impulse-dot bie-reactor-signal-dot" fill="#5df7ff">
                  <animateMotion dur="1.15s" repeatCount="1" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.35 0 0.2 1">
                    <mpath href="#bie-reactor-impulse" />
                  </animateMotion>
                </circle>
              </g>
            )}

            <g
              className={`bie-reactor-core bie-reactor-core-classic${coreActive ? " is-active" : ""}${coreAbsorbing ? " is-absorbing" : ""}${phase === "ripple" ? " is-emitting" : ""}`}
              transform={`translate(${CORE.x}, ${CORE.y})`}
            >
              {!reduceMotion && phase === "ripple" && (
                <>
                  <circle key={`rip-a-${rippleKey}`} cx={0} cy={0} r={36} className="bie-field-ripple bie-field-ripple-a" />
                  <circle key={`rip-b-${rippleKey}`} cx={0} cy={0} r={36} className="bie-field-ripple bie-field-ripple-b" />
                  <circle key={`rip-c-${rippleKey}`} cx={0} cy={0} r={36} className="bie-field-ripple bie-field-ripple-c" />
                </>
              )}
              <circle cx={0} cy={0} r={36} className="bie-reactor-core-halo" />
              <circle cx={0} cy={0} r={20} className="bie-brain-core bie-reactor-core-nucleus" />
              <text x={0} y={0} className="bie-core-label-svg" textAnchor="middle" dominantBaseline="central">
                BIE
              </text>
            </g>
          </svg>

          <BieOrbitTools
            tools={FIELD_TOOLS}
            viewW={VIEW_W}
            viewH={VIEW_H}
            coreX={CORE.x}
            coreY={CORE.y}
            maxRx={MAX_RX}
            maxRy={MAX_RY}
            reduceMotion={reduceMotion}
          />
          </div>

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
