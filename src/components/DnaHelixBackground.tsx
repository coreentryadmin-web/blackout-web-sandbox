"use client";

import { useReducedMotion } from "framer-motion";

// ─── Geometry (module-level, computed once) ───────────────────────────────────
const VW     = 280;
const VH     = 1100;
const CX     = VW / 2;
const AMP    = 92;
const PERIOD = 186;
const STEPS  = 320;

function buildPath(phase: number): string {
  const d: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const y = (i / STEPS) * VH;
    const x = CX + AMP * Math.sin((y / PERIOD) * 2 * Math.PI + phase);
    d.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return d.join(" ");
}

interface RungDatum { x1: number; x2: number; y: number; absCos: number; }

function buildRungs(): RungDatum[] {
  const out: RungDatum[] = [];
  for (let i = 0; i * (PERIOD / 2) < VH + PERIOD; i++) {
    const y = i * (PERIOD / 2) + PERIOD / 4;
    const t = (y / PERIOD) * 2 * Math.PI;
    out.push({
      x1: CX + AMP * Math.sin(t),
      x2: CX - AMP * Math.sin(t),
      y,
      absCos: Math.abs(Math.cos(t)),
    });
  }
  return out;
}

const S1    = buildPath(0);
const S2    = buildPath(Math.PI);
const RUNGS = buildRungs();

// Particles: 6 per strand — varied speeds, always spread across full length
const DOTS_S1 = [
  { dur: "6s",  begin: "0s"    },
  { dur: "9s",  begin: "-3s"   },
  { dur: "12s", begin: "-6s"   },
  { dur: "8s",  begin: "-4.5s" },
  { dur: "14s", begin: "-10s"  },
  { dur: "7s",  begin: "-1.5s" },
];
const DOTS_S2 = [
  { dur: "7s",  begin: "-0.5s" },
  { dur: "10s", begin: "-4s"   },
  { dur: "13s", begin: "-7.5s" },
  { dur: "5s",  begin: "-2s"   },
  { dur: "11s", begin: "-8.5s" },
  { dur: "8s",  begin: "-3.5s" },
];

// ─── Color palette ────────────────────────────────────────────────────────────
// Strand 1: electric violet    Strand 2: neon cyan    Rungs: violet→cyan
const C_S1    = "#c500ff";  // neon magenta-violet
const C_S2    = "#00f0ff";  // neon cyan
const C_DOT1  = "#e040ff";  // bright violet dots
const C_DOT2  = "#40ffff";  // bright cyan dots
const C_PART1 = "#ff80ff";  // particle on strand 1
const C_PART2 = "#80ffff";  // particle on strand 2

// ─── Single helix SVG ─────────────────────────────────────────────────────────
function HelixSvg({ uid, intense = false, reduce = false }: { uid: string; intense?: boolean; reduce?: boolean }) {
  const F  = `f-${uid}`;
  const RG = `rg-${uid}`;
  const M1 = `m1-${uid}`;
  const M2 = `m2-${uid}`;

  const sw = intense ? 4 : 3.2; // stroke width

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* ── 2-layer bloom filter (wide halo + mid glow, then crisp source on top).
             Dropped the redundant stdDeviation=1 pass: SourceGraphic is already
             merged on top, so the 1px blur was near-invisible but cost a full
             filter pass per column + per particle group. */}
        <filter id={F} x="-130%" y="-10%" width="360%" height="120%">
          {/* Wide atmospheric halo */}
          <feGaussianBlur in="SourceGraphic" stdDeviation={intense ? "14" : "11"} result="wideBlur"/>
          {/* Mid glow */}
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="midBlur"/>
          <feMerge>
            <feMergeNode in="wideBlur"/>
            <feMergeNode in="midBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        {/* ── Rung gradient: violet → white → cyan ── */}
        <linearGradient id={RG} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor={C_S1}    stopOpacity="1"/>
          <stop offset="35%"  stopColor="#f0d0ff" stopOpacity="1"/>
          <stop offset="65%"  stopColor="#d0ffff" stopOpacity="1"/>
          <stop offset="100%" stopColor={C_S2}    stopOpacity="1"/>
        </linearGradient>

        {/* Hidden motion paths */}
        <path id={M1} d={S1} fill="none" stroke="none"/>
        <path id={M2} d={S2} fill="none" stroke="none"/>
      </defs>

      <g filter={reduce ? undefined : `url(#${F})`}>
        {/* Strand 1 — electric violet */}
        <path d={S1} fill="none" stroke={C_S1} strokeWidth={sw} strokeLinecap="round"/>

        {/* Strand 2 — neon cyan */}
        <path d={S2} fill="none" stroke={C_S2} strokeWidth={sw} strokeLinecap="round"/>

        {/* Base-pair rungs — thicker when facing viewer */}
        {RUNGS.map((r, i) => (
          <line
            key={`r${i}`}
            x1={r.x1} y1={r.y} x2={r.x2} y2={r.y}
            stroke={`url(#${RG})`}
            strokeWidth={0.5 + 2.8 * r.absCos}
            strokeOpacity={0.32 + 0.68 * r.absCos}
            strokeLinecap="round"
          />
        ))}

        {/* Nucleotide dots — strand 1 */}
        {RUNGS.map((r, i) => (
          <circle key={`d1${i}`} cx={r.x1} cy={r.y}
            r={2 + 2 * r.absCos}
            fill={C_DOT1}
            fillOpacity={0.4 + 0.6 * r.absCos}
          />
        ))}

        {/* Nucleotide dots — strand 2 */}
        {RUNGS.map((r, i) => (
          <circle key={`d2${i}`} cx={r.x2} cy={r.y}
            r={2 + 2 * r.absCos}
            fill={C_DOT2}
            fillOpacity={0.4 + 0.6 * r.absCos}
          />
        ))}
      </g>

      {/* ── Traveling particles — strand 1 ── */}
      {!reduce && DOTS_S1.map((p, j) => (
        <g key={`p1${j}`} filter={`url(#${F})`}>
          <circle r="5.5" fill={C_PART1} fillOpacity="1">
            <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite" rotate="none">
              <mpath href={`#${M1}`}/>
            </animateMotion>
          </circle>
          <circle r="11" fill={C_S1} fillOpacity="0.28">
            <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite" rotate="none">
              <mpath href={`#${M1}`}/>
            </animateMotion>
          </circle>
        </g>
      ))}

      {/* ── Traveling particles — strand 2 ── */}
      {!reduce && DOTS_S2.map((p, j) => (
        <g key={`p2${j}`} filter={`url(#${F})`}>
          <circle r="5.5" fill={C_PART2} fillOpacity="1">
            <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite" rotate="none">
              <mpath href={`#${M2}`}/>
            </animateMotion>
          </circle>
          <circle r="11" fill={C_S2} fillOpacity="0.28">
            <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite" rotate="none">
              <mpath href={`#${M2}`}/>
            </animateMotion>
          </circle>
        </g>
      ))}
    </svg>
  );
}

// ─── Layout: 4 columns weighted toward the flow-feed area ────────────────────
// helix-sway = gentle ±18° tilt + drift — never goes edge-on, always visible
const COLS = [
  // Far left — dimmer accent
  { left: "10%",  w: 220, dur: "70s", delay: "-18s", opacity: 0.22, intense: false },
  // Left-centre — covers main flow feed (the circled area)
  { left: "34%",  w: 310, dur: "52s", delay:  "-5s", opacity: 0.40, intense: true  },
  // Right-centre
  { left: "62%",  w: 310, dur: "58s", delay: "-25s", opacity: 0.35, intense: true  },
  // Far right — dimmer accent
  { left: "88%",  w: 220, dur: "76s", delay: "-40s", opacity: 0.20, intense: false },
] as const;

// ─── Root export ─────────────────────────────────────────────────────────────
export function DnaHelixBackground() {
  const reduce = useReducedMotion() ?? false;
  return (
    <div
      className="fixed inset-0 pointer-events-none select-none overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden
    >
      {/* Deep violet atmospheric base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 70% at 45% 35%, rgba(100,0,160,0.18) 0%, rgba(0,60,100,0.12) 55%, transparent 80%)",
        }}
      />

      {/* Helix columns */}
      {COLS.map((col, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left:           col.left,
            top:            "-5%",
            height:         "110%",
            width:          col.w,
            transform:      "translateX(-50%)",
            opacity:        col.opacity,
            animation:      `helix-sway ${col.dur} ease-in-out infinite`,
            animationDelay: col.delay,
            willChange:     "transform",
          }}
        >
          <HelixSvg uid={`h${i}`} intense={col.intense} reduce={reduce} />
        </div>
      ))}

      {/* Soft vignette — only darkens the very corners, not the body */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 90% at 50% 50%, transparent 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Top edge fade */}
      <div
        className="absolute top-0 left-0 right-0 h-16"
        style={{ background: "linear-gradient(to top, transparent, rgba(4,4,7,0.9))" }}
      />

      {/* Bottom edge fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-28"
        style={{ background: "linear-gradient(to bottom, transparent, rgba(4,4,7,0.95))" }}
      />
    </div>
  );
}
