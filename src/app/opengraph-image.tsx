import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "BlackOut Trading — the command surface for 0DTE and options flow";

// Satori-safe ONLY: divs + flexbox + gradients + text. NO inline <svg>, NO React
// fragments, NO blur filters (Satori chokes on all three). Every div with children
// sets an explicit display. This renders the brand poster, not the animated sigils.
const KICK = "0DTE · OPTIONS FLOW · INSTITUTIONAL";
const INSTRUMENTS = [
  { name: "SPX SLAYER", accent: "#00e676" },
  { name: "HELIX", accent: "#bf5fff" },
  { name: "HEATMAPS", accent: "#ff6b2b" },
  { name: "LARGO AI", accent: "#22d3ee" },
  { name: "NIGHT HAWK", accent: "#ff2d55" },
];

// Best-effort load of the Anton display face for the wordmark, server-side (nodejs
// runtime). Fetching css2 with NO modern User-Agent makes Google return a .ttf src,
// which Satori can parse (woff2 it cannot). Timeout-guarded; on ANY failure — or if
// no .ttf URL is found — we return null and the poster falls back to bold sans-serif.
// The route therefore never throws on a font issue. (Local Windows @vercel/og has a
// bundled-font quirk that prevents dev render-verify; prod is Linux and unaffected.)
async function loadAnton(): Promise<ArrayBuffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const css = await fetch("https://fonts.googleapis.com/css2?family=Anton", {
      signal: controller.signal,
    }).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src:\s*url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    return await fetch(url, { signal: controller.signal }).then((r) =>
      r.ok ? r.arrayBuffer() : null,
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function OgImage() {
  const anton = await loadAnton();
  const displayFamily = anton ? "Anton, sans-serif" : "sans-serif";

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
        {/* emerald top glow */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background: "radial-gradient(900px 520px at 50% -12%, rgba(0,230,118,0.18), transparent)",
          }}
        />
        {/* corner vignettes so type pops */}
        <div style={{ position: "absolute", top: 0, left: 0, width: 620, height: 380, display: "flex", background: "radial-gradient(closest-side, #050608, transparent)" }} />
        <div style={{ position: "absolute", bottom: 0, right: 0, width: 620, height: 380, display: "flex", background: "radial-gradient(closest-side, #050608, transparent)" }} />

        {/* LEFT — wordmark lockup */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 84, width: 720 }}>
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 8, color: "#00e676", textTransform: "uppercase" }}>{KICK}</div>
          <div style={{ display: "flex", fontSize: 158, fontWeight: 800, color: "#ffffff", lineHeight: 0.9, marginTop: 6, fontFamily: displayFamily, letterSpacing: anton ? 4 : 0 }}>BLACKOUT</div>
          <div style={{ display: "flex", fontSize: 36, color: "#7dd3fc", marginTop: 14 }}>The command surface for the floor.</div>
          <div style={{ display: "flex", marginTop: 24, width: 240, height: 3, background: "linear-gradient(90deg, transparent, #00e676, #7dd3fc, transparent)" }} />
        </div>

        {/* RIGHT — instrument stack (div chips) */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, paddingRight: 84, marginLeft: "auto" }}>
          {INSTRUMENTS.map((m) => (
            <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  border: `2px solid ${m.accent}`,
                  boxShadow: `0 0 28px -6px ${m.accent}`,
                }}
              >
                <div style={{ display: "flex", width: 14, height: 14, borderRadius: 9999, background: m.accent }} />
              </div>
              <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: m.accent, letterSpacing: 1 }}>{m.name}</div>
            </div>
          ))}
        </div>

        {/* footer */}
        <div style={{ position: "absolute", bottom: 44, left: 84, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", width: 240, height: 1, background: "#00e676", opacity: 0.5 }} />
          <div style={{ display: "flex", marginTop: 12, fontSize: 22, color: "#7dd3fc", letterSpacing: 2 }}>{SITE.domain}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: anton
        ? [{ name: "Anton", data: anton, style: "normal" as const, weight: 400 as const }]
        : [],
    }
  );
}
