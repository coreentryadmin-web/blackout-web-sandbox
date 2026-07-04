"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildCenterHelix,
  buildFieldParticles,
  buildInboundPulsePath,
  buildIntelligenceRings,
  fieldGlowRadii,
  placeCapabilities,
  type FieldParticle,
  type PlacedCapability,
  type Capability,
} from "./bie-helix-engine";

// Reactor-only hero — emotion and trust, not product catalog.

export const VIEW_W = 1280;
export const VIEW_H = 720;
const CORE = { x: VIEW_W / 2, y: VIEW_H / 2 };
const MAX_RX = 590;
const MAX_RY = 315;
const HELIX_H = 520;
const HELIX_W = 162;
const FIELD_COUNT = 120;
/** Three intelligence rings — inner, mid, outer. */
const VISIBLE_RINGS = new Set([1, 2, 4]);

const HELIX_TRAVELERS = [
  { path: "a", dur: "4.2s", begin: "-1.4s", r: 2 },
  { path: "b", dur: "5.6s", begin: "-2.8s", r: 1.6 },
] as const;

const CAPABILITIES: Capability[] = [
  { id: "validation", label: "Validation", detail: "Integrity, consistency, and real-time self-audit", angleDeg: 128, ring: 2, accent: "#00e676" },
  { id: "confidence", label: "Confidence", detail: "Every number grounded or withheld — never fabricated", angleDeg: 208, ring: 2, accent: "#00e676" },
  { id: "memory", label: "Memory", detail: "Every alert, outcome, and precedent informs the next call", angleDeg: 48, ring: 1, accent: "#bf5fff" },
];

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
        ctx.fillStyle = `rgba(148, 226, 255, ${p.opacity * fade * 0.85})`;
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

function outerFieldPoint(): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const t = 0.82 + Math.random() * 0.14;
  return {
    x: CORE.x + MAX_RX * t * Math.cos(angle),
    y: CORE.y + MAX_RY * t * Math.sin(angle),
  };
}

export function BieBrainBanner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [lineIndex, setLineIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hovered, setHovered] = useState<PlacedCapability | null>(null);
  const [phase, setPhase] = useState<ReactorPhase>("idle");
  const [pulseKey, setPulseKey] = useState(0);
  const [pulsePath, setPulsePath] = useState("");
  const [rippleKey, setRippleKey] = useState(0);

  const helix = useMemo(() => buildCenterHelix(CORE.x, CORE.y, HELIX_H, HELIX_W), []);
  const rings = useMemo(
    () => buildIntelligenceRings(CORE.x, CORE.y, MAX_RX, MAX_RY).filter((r) => VISIBLE_RINGS.has(r.ring)),
    []
  );
  const anchors = useMemo(() => placeCapabilities(CORE.x, CORE.y, CAPABILITIES, MAX_RX, MAX_RY), []);
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
    const timers: ReturnType<typeof setTimeout>[] = [];

    const fire = () => {
      if (cancelled) return;
      const { x, y } = outerFieldPoint();
      setPulsePath(buildInboundPulsePath(x, y, CORE.x, CORE.y));
      setPulseKey((k) => k + 1);
      setPhase("inbound");
      timers.push(setTimeout(() => !cancelled && setPhase("core"), 950));
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setPhase("ripple");
        setRippleKey((k) => k + 1);
      }, 1350));
      timers.push(setTimeout(() => !cancelled && setPhase("idle"), 2400));
      timers.push(setTimeout(fire, 5200 + Math.random() * 2400));
    };

    fire();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion]);

  const litRing =
    phase === "inbound" ? 4 : phase === "core" || phase === "ripple" ? 2 : -1;

  const onAnchorEnter = useCallback((c: PlacedCapability) => setHovered(c), []);
  const onAnchorLeave = useCallback(() => setHovered(null), []);

  return (
    <div className={`bie-brain-banner bie-brain-hero bie-reactor-hero${reduceMotion ? "" : " bie-reactor-live"}`}>
      <div
        className="bie-brain-diagram bie-reactor-diagram bie-reactor-stage bie-field-stage"
        role="img"
        aria-label="BlackOut Intelligence Engine: a living reactor with helix core, subtle rings, and particle field."
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
                <stop offset="0%" stopColor="rgba(0,229,255,0.18)" />
                <stop offset="40%" stopColor="rgba(0,229,255,0.07)" />
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
              <filter id="bie-helix-hero-bloom" x="-50%" y="-15%" width="200%" height="130%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="b" />
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

            {!reduceMotion && phase !== "idle" && pulsePath && (
              <g key={pulseKey} className="bie-reactor-pulse-wave bie-reactor-pulse-inbound">
                <path id="bie-reactor-impulse" d={pulsePath} className="bie-reactor-impulse-track" pathLength={1} />
                <circle r={2.4} className="bie-reactor-impulse-dot" fill="#5df7ff">
                  <animateMotion dur="1.9s" repeatCount="1" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.35 0 0.2 1">
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
              className={`bie-reactor-core${phase === "core" || phase === "ripple" ? " is-active" : ""}`}
              transform={`translate(${CORE.x}, ${CORE.y})`}
            >
              {!reduceMotion && (
                <>
                  <circle cx={0} cy={0} r={MAX_RX * 0.2} className="bie-reactor-ambient-pulse bie-reactor-ambient-pulse-a" />
                  {phase === "ripple" && (
                    <circle key={`rip-${rippleKey}`} cx={0} cy={0} r={48} className="bie-field-ripple bie-field-ripple-a" />
                  )}
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
