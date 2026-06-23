"use client";

// Global error boundary — catches faults in the root layout itself, so it must
// render its OWN <html>/<body> (it replaces the root layout). Kept ultra-robust:
// no imports beyond react, inline styles only since globals may not have loaded.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          textAlign: "center",
          backgroundColor: "#040407",
          color: "#ffffff",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.25rem",
            maxWidth: "32rem",
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#7dd3fc",
            }}
          >
            ◆ SYSTEM FAULT
          </span>

          <h1
            style={{
              margin: 0,
              fontSize: "2.25rem",
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              lineHeight: 1,
              color: "#ffffff",
            }}
          >
            BLACKOUT — SYSTEM FAULT
          </h1>

          <p style={{ margin: 0, maxWidth: "26rem", color: "#7dd3fc" }}>
            The terminal dropped offline. Reset to bring the desk back up.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "9999px",
              border: "none",
              padding: "0.625rem 1.5rem",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              fontWeight: 500,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#000000",
              backgroundColor: "#00e676",
            }}
          >
            Reset
          </button>
        </div>
      </body>
    </html>
  );
}
