"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MARK_ACCENT } from "@/components/marks/ProductMark";
import {
  buildAmbientFieldMesh,
  buildAtmosphereGlows,
  buildFieldLineRings,
  buildFieldParticles,
  buildInboundPulsePath,
  fieldGlowRadii,
  pointOnFieldLine,
  type FieldLineRing,
  type FieldParticle,
} from "./bie-helix-engine";
import { buildGateTicks, resolveVerification, type VerificationOutcome } from "./bie-verification";
import { BieOrbitTools, type OrbitTool } from "./BieOrbitTools";

/**
 * Milestone 2 — The Verification Gate.
 * BIE isn't a generic "AI energy core" — its whole reason for existing is that it
 * checks things before they reach you, and sometimes says no. Milestone 1's field
 * (organic rings, ambient particles, six-product orbit) stays; the core is now a
 * literal gate a signal must pass, and roughly 1 in 6 cycles is visibly rejected
 * rather than always resolving to a clean success. See docs/design/BIE-HERO-VISION.md.
 */

export const VIEW_W = 1280;
export const VIEW_H = 720;
const CORE = { x: VIEW_W / 2, y: VIEW_H * 0.5 };
/** Half viewBox width — ring 6 at scale 1.0 spans edge-to-edge horizontally. */
const MAX_RX = VIEW_W / 2;
const MAX_RY = 310;
/** Trimmed from Milestone 1's 120 — a calmer, more deliberate field reads as more
 *  premium than a dense scatter, and keeps focus on the one meaningful motion:
 *  the verification cycle itself. */
const FIELD_COUNT = 36;
const GATE_TICK_COUNT = 28;
const GATE_INNER_R = 24;
const GATE_OUTER_R = 31;

const READOUT_LINES = [
  "continuous market intelligence — ingested, verified, never assumed",
  "trust the output because validation happened first",
  "unverified claims are rejected before they ever reach you",
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

type ReactorPhase = "idle" | "inbound" | "verifying" | "verified" | "rejected";

/**
 * Which field rings brighten during each phase. `rejected` deliberately reuses
 * `verifying`'s rings (1–2) instead of advancing to 3–4 — the signal never got
 * further than the gate, and the lit rings say so.
 */
function litRingsForPhase(phase: ReactorPhase): number[] {
  switch (phase) {
    case "inbound":
      return [5, 6];
    case "verifying":
      return [1, 2];
    case "verified":
      return [3, 4];
    case "rejected":
      return [1, 2];
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
  const fieldGlow = useMemo(() => fieldGlowRadii(VIEW_W, VIEW_H), []);
  const gateTicks = useMemo(() => buildGateTicks(GATE_TICK_COUNT, GATE_INNER_R, GATE_OUTER_R), []);

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

    /**
     * Signal enters → gate evaluates it → verified passes through and ripples
     * outward, OR rejected flares at the gate and goes no further. Repeats
     * every ~5.5–7.5s. The outcome is decided up front (not at the moment the
     * signal "arrives") so the whole cycle — including which rings light up —
     * is consistent with a single decision, matching how BIE itself decides
     * once per claim, not once per animation frame.
     */
    const fireCycle = () => {
      if (cancelled) return;

      const outcome: VerificationOutcome = resolveVerification();
      const origin = pickInboundOrigin();
      setPulsePath(buildInboundPulsePath(origin.x, origin.y, CORE.x, CORE.y));
      setPulseKey((k) => k + 1);
      setPhase("inbound");

      schedule(() => setPhase("verifying"), 1180);
      schedule(() => {
        setPhase(outcome);
        if (outcome === "verified") setRippleKey((k) => k + 1);
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
  const coreActive = phase === "verifying" || phase === "verified" || phase === "rejected";
  const coreVerifying = phase === "verifying";
  const coreVerified = phase === "verified";
  const coreRejected = phase === "rejected";

  const renderFieldLine = (ring: FieldLineRing) => {
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
      </g>
    );
  };

  return (
    <div className={`bie-brain-banner bie-brain-hero bie-reactor-hero bie-intelligence-field bie-reactor-phase-${phase}${reduceMotion ? "" : " bie-reactor-live"}`}>
      <div
        className="bie-brain-diagram bie-reactor-diagram bie-reactor-stage bie-field-stage"
        role="img"
        aria-label="BlackOut Intelligence Engine: every signal is checked against live data before it reaches you — unverified claims are rejected, not shown."
        style={{ ["--reactor-cx" as string]: `${CORE.x}px`, ["--reactor-cy" as string]: `${CORE.y}px` }}
      >
        <div className="bie-brain-canvas bie-reactor-canvas bie-field-canvas">
          <div className="bie-field-visual">
          <canvas ref={canvasRef} className="bie-reactor-particles bie-field-particles" aria-hidden />

          <svg
            className="bie-brain-svg bie-reactor-svg bie-field-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
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

            {outerLines.map((ring) => renderFieldLine(ring))}

            {midLines.map((ring) => renderFieldLine(ring))}

            {innerLines.map((ring) => renderFieldLine(ring))}

            {!reduceMotion && phase === "inbound" && pulsePath && (
              <g key={pulseKey} className="bie-reactor-pulse-wave bie-reactor-pulse-inbound">
                <path id="bie-reactor-impulse" d={pulsePath} className="bie-reactor-impulse-track" pathLength={1} />
                <circle r={2.6} className="bie-reactor-impulse-dot bie-reactor-signal-dot" fill="#a9b4c4">
                  <animateMotion dur="1.15s" repeatCount="1" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.35 0 0.2 1">
                    <mpath href="#bie-reactor-impulse" />
                  </animateMotion>
                </circle>
              </g>
            )}

            <g
              className={`bie-reactor-core bie-reactor-core-classic${coreActive ? " is-active" : ""}${coreVerifying ? " is-verifying" : ""}${coreVerified ? " is-verified" : ""}${coreRejected ? " is-rejected" : ""}`}
              transform={`translate(${CORE.x}, ${CORE.y})`}
            >
              {!reduceMotion && phase === "verified" && (
                <>
                  <circle key={`rip-a-${rippleKey}`} cx={0} cy={0} r={36} className="bie-field-ripple bie-field-ripple-a" />
                  <circle key={`rip-b-${rippleKey}`} cx={0} cy={0} r={36} className="bie-field-ripple bie-field-ripple-b" />
                  <circle key={`rip-c-${rippleKey}`} cx={0} cy={0} r={36} className="bie-field-ripple bie-field-ripple-c" />
                </>
              )}
              {!reduceMotion && phase === "rejected" && (
                <circle key={`rej-${rippleKey}`} cx={0} cy={0} r={GATE_OUTER_R} className="bie-gate-reject-flash" />
              )}
              <g className="bie-gate-ring" aria-hidden>
                {gateTicks.map((t) => (
                  <line key={t.angleDeg} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="bie-gate-tick" />
                ))}
              </g>
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
