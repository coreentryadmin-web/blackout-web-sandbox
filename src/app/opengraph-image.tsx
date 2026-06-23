import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";
import type { MarkProduct } from "@/components/marks/ProductMark";

export const runtime = "nodejs";
// Render on-request, not at build time — mirrors track-record/opengraph-image.tsx,
// which forces dynamic so @vercel/og resolves correctly across environments.
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "BlackOut — The Living Terminal";

// One template, 5 skins. The default route emits the master ("THE LIVING TERMINAL").
export function ogConfig(product?: MarkProduct) {
  const M = {
    spx: { name: "SPX SLAYER", accent: "#00e676", kick: "0DTE · GEX · VWAP" },
    helix: { name: "HELIX", accent: "#bf5fff", kick: "WHALE · DARK POOL" },
    heatmap: { name: "HEATMAPS", accent: "#ff6b2b", kick: "SECTOR ROTATION" },
    largo: { name: "LARGO AI", accent: "#22d3ee", kick: "DESK TERMINAL" },
    nighthawk: { name: "NIGHT HAWK", accent: "#ff2d55", kick: "THE HUNT" },
  } as const;
  return product
    ? M[product]
    : { name: "", accent: "#00e676", kick: "0DTE · OPTIONS FLOW · INSTITUTIONAL" };
}

const STACK: { product: MarkProduct; accent: string }[] = [
  { product: "spx", accent: "#00e676" },
  { product: "helix", accent: "#bf5fff" },
  { product: "heatmap", accent: "#ff6b2b" },
  { product: "largo", accent: "#22d3ee" },
  { product: "nighthawk", accent: "#ff2d55" },
];

/**
 * Satori-safe sigil — the composed static frame at poster scale. NO blur: the focal
 * bloom is faked with three stacked concentric circles (r=60@.08, r=38@.18, r=20@.6).
 * Pared down to the silhouette-carrying primitives of each mark.
 */
function PosterSigil({ product, accent, s }: { product: MarkProduct; accent: string; s: number }) {
  const px = (n: number) => (n / 64) * s;
  // Faked glow: three stacked circles behind the focal node (Satori has no feGaussianBlur).
  const Glow = ({ cx, cy }: { cx: number; cy: number }) => (
    <>
      <circle cx={px(cx)} cy={px(cy)} r={px(11)} fill={accent} opacity={0.08} />
      <circle cx={px(cx)} cy={px(cy)} r={px(7)} fill={accent} opacity={0.18} />
      <circle cx={px(cx)} cy={px(cy)} r={px(3.4)} fill={accent} opacity={0.6} />
    </>
  );

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ color: accent }}>
      {/* shared emerald horizon thread */}
      <line x1={px(12)} y1={px(40)} x2={px(52)} y2={px(40)} stroke="#00e676" strokeWidth={px(0.7)} opacity={0.35} />

      {product === "spx" && (
        <>
          <circle cx={px(32)} cy={px(32)} r={px(25.3)} fill="none" stroke={accent} strokeWidth={px(1.3)} strokeDasharray={`${px(2.6)} ${px(3.9)}`} opacity={0.7} />
          <circle cx={px(32)} cy={px(32)} r={px(17.3)} fill="none" stroke={accent} strokeWidth={px(1.3)} strokeDasharray={`${px(2.6)} ${px(3.9)}`} opacity={0.85} />
          <circle cx={px(32)} cy={px(32)} r={px(9.3)} fill="none" stroke={accent} strokeWidth={px(1.3)} opacity={0.6} />
          <path d={`M${px(11)} ${px(44)} C${px(20)} ${px(43)},${px(26)} ${px(40)},${px(32)} ${px(20)} C${px(38)} ${px(40)},${px(44)} ${px(43)},${px(53)} ${px(44)}`} fill="none" stroke={accent} strokeWidth={px(2.6)} strokeLinecap="round" />
          <Glow cx={32} cy={20} />
        </>
      )}

      {product === "helix" && (
        <>
          <circle cx={px(32)} cy={px(32)} r={px(17)} fill="none" stroke={accent} strokeWidth={px(1.3)} strokeDasharray={`${px(2)} ${px(3)}`} opacity={0.28} />
          <path d={`M${px(32)} ${px(8)} C ${px(44)} ${px(14)}, ${px(44)} ${px(26)}, ${px(32)} ${px(32)} C ${px(20)} ${px(38)}, ${px(20)} ${px(50)}, ${px(32)} ${px(56)}`} fill="none" stroke={accent} strokeWidth={px(2.7)} strokeLinecap="round" />
          <path d={`M${px(32)} ${px(8)} C ${px(20)} ${px(14)}, ${px(20)} ${px(26)}, ${px(32)} ${px(32)} C ${px(44)} ${px(38)}, ${px(44)} ${px(50)}, ${px(32)} ${px(56)}`} fill="none" stroke={accent} strokeWidth={px(2.7)} strokeLinecap="round" opacity={0.55} />
          <Glow cx={32} cy={32} />
        </>
      )}

      {product === "heatmap" && (
        <>
          <circle cx={px(32)} cy={px(32)} r={px(25.3)} fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(2)} ${px(3)}`} opacity={0.55} />
          {/* resting hot-band: a diagonal of warm cells over a dim floor */}
          {[
            { x: 15.3, y: 41, w: 6, h: 3.6, o: 0.9 },
            { x: 22, y: 41, w: 6, h: 3.6, o: 0.55 },
            { x: 28.7, y: 41, w: 6.4, h: 3.6, o: 0.3 },
            { x: 18.4, y: 34.2, w: 5.2, h: 3.3, o: 0.6 },
            { x: 24.2, y: 34.2, w: 5.2, h: 3.3, o: 0.9 },
            { x: 30, y: 34.2, w: 5.6, h: 3.3, o: 0.55 },
            { x: 36.2, y: 34.2, w: 5.2, h: 3.3, o: 0.3 },
            { x: 20.8, y: 27.4, w: 4.4, h: 2.9, o: 0.3 },
            { x: 25.8, y: 27.4, w: 4.4, h: 2.9, o: 0.6 },
            { x: 30.8, y: 27.4, w: 4.6, h: 2.9, o: 0.9 },
            { x: 35.9, y: 27.4, w: 4.4, h: 2.9, o: 0.3 },
            { x: 31.6, y: 21, w: 3.9, h: 2.5, o: 0.6 },
          ].map((c, i) => (
            <rect key={i} x={px(c.x)} y={px(c.y)} width={px(c.w)} height={px(c.h)} rx={px(1)} fill={accent} opacity={c.o} />
          ))}
          <Glow cx={31.9} cy={42.8} />
        </>
      )}

      {product === "largo" && (
        <>
          <circle cx={px(32)} cy={px(32)} r={px(25.3)} fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(6)}`} opacity={0.45} />
          <circle cx={px(32)} cy={px(32)} r={px(17.3)} fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(2)} ${px(3)}`} opacity={0.7} />
          <circle cx={px(32)} cy={px(32)} r={px(9.3)} fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(6)}`} opacity={0.55} />
          <path d={`M${px(9)} ${px(32)} q${px(3.3)} ${px(-7)} ${px(6.6)} 0 t${px(6.6)} 0 t${px(6.6)} 0 t${px(6.6)} 0 t${px(6.6)} 0 t${px(6.6)} 0`} fill="none" stroke={accent} strokeWidth={px(2)} strokeLinecap="round" opacity={0.9} />
          <Glow cx={32} cy={32} />
        </>
      )}

      {product === "nighthawk" && (
        <>
          <circle cx={px(32)} cy={px(32)} r={px(27)} fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(2)} ${px(3)}`} opacity={0.55} />
          <circle cx={px(32)} cy={px(32)} r={px(21)} fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(2)} ${px(3)}`} opacity={0.55} />
          <circle cx={px(32)} cy={px(32)} r={px(15)} fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(2)} ${px(3)}`} opacity={0.7} />
          {/* parked sweep line (toward upper-right) */}
          <line x1={px(32)} y1={px(32)} x2={px(48)} y2={px(20)} stroke={accent} strokeWidth={px(2)} strokeLinecap="round" />
          <Glow cx={39} cy={41} />
        </>
      )}
    </svg>
  );
}

export default function OgImage() {
  const cfg = ogConfig();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#040407",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* full-bleed substrate: perspective floor converging to VP (600,70) */}
        <svg width={1200} height={630} style={{ position: "absolute", top: 0, left: 0 }}>
          {Array.from({ length: 13 }).map((_, i) => {
            const x = 80 + i * (1040 / 12);
            return <line key={`v${i}`} x1={x} y1={630} x2={600} y2={70} stroke="#00e676" strokeWidth={1} opacity={0.06} />;
          })}
          {[200, 300, 400, 500, 600].map((y) => (
            <line key={`h${y}`} x1={0} y1={y} x2={1200} y2={y} stroke="#00e676" strokeWidth={1} opacity={0.05} />
          ))}
          {/* giant SPX emerald reticle behind the wordmark, low opacity, for depth */}
          <circle cx={840} cy={315} r={320} fill="none" stroke="#00e676" strokeWidth={2} opacity={0.1} strokeDasharray="6 9" />
          <circle cx={840} cy={315} r={220} fill="none" stroke="#00e676" strokeWidth={2} opacity={0.1} strokeDasharray="6 9" />
          <circle cx={840} cy={315} r={120} fill="none" stroke="#00e676" strokeWidth={2} opacity={0.1} />
        </svg>

        {/* corner vignettes so type pops */}
        <div style={{ position: "absolute", top: 0, left: 0, width: 600, height: 360, background: "radial-gradient(closest-side,#050608,transparent)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: 0, right: 0, width: 600, height: 360, background: "radial-gradient(closest-side,#050608,transparent)", display: "flex" }} />

        {/* LEFT block — wordmark lockup */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingLeft: 80,
            width: 700,
          }}
        >
          <div style={{ fontSize: 24, letterSpacing: 8, color: cfg.accent, textTransform: "uppercase", display: "flex" }}>
            {cfg.kick}
          </div>
          <div style={{ fontSize: 150, fontWeight: 800, color: "#ffffff", lineHeight: 0.9, display: "flex" }}>
            BLACKOUT
          </div>
          {cfg.name ? (
            <div style={{ fontSize: 64, fontWeight: 800, color: cfg.accent, lineHeight: 1, display: "flex" }}>
              // {cfg.name}
            </div>
          ) : null}
          <div style={{ fontSize: 34, color: "#7dd3fc", marginTop: 12, display: "flex" }}>
            THE LIVING TERMINAL
          </div>
          <div
            style={{
              marginTop: 22,
              width: 220,
              height: 2,
              background: `linear-gradient(90deg,transparent,${cfg.accent},transparent)`,
              display: "flex",
            }}
          />
        </div>

        {/* RIGHT third — instrument stack: 5 static sigils, one desk */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 18,
            paddingRight: 70,
            marginLeft: "auto",
          }}
        >
          {STACK.map((m) => (
            <div key={m.product} style={{ display: "flex" }}>
              <PosterSigil product={m.product} accent={m.accent} s={92} />
            </div>
          ))}
        </div>

        {/* footer strip */}
        <div style={{ position: "absolute", bottom: 40, left: 80, display: "flex", flexDirection: "column" }}>
          <div style={{ width: 220, height: 1, background: "#00e676", opacity: 0.5, display: "flex" }} />
          <div style={{ marginTop: 10, fontSize: 22, color: "#7dd3fc", letterSpacing: 2, display: "flex" }}>
            {SITE.domain}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
