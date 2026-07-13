"use client";

import { clsx } from "clsx";
import { useRef } from "react";
import { LargoNativeTerminal } from "@/features/largo/components/LargoNativeTerminal";
import { LargoTerminal } from "@/features/largo/components/LargoTerminal";
import { PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { useFullscreen } from "@/hooks/useFullscreen";

/**
 * /terminal page frame — full-viewport chat on web; edge-to-edge native iOS shell.
 */
export function LargoPageShell() {
  const nativeShell = useIosNativeShell();
  // Full-screen targets the whole terminal surface (§6 "Full-screen mode"), so
  // the ref lives here on the shell and the toggle is threaded into the terminal.
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, supported: fullscreenSupported, toggle } = useFullscreen(shellRef);

  return (
    <div
      ref={shellRef}
      className={clsx(
        "largo-page-shell ios-native-page ios-native-page-largo",
        nativeShell && "largo-page-shell-native",
        isFullscreen && "largo-page-shell-fullscreen"
      )}
    >
      <main
        id="main"
        className={clsx("largo-page-main", nativeShell && "largo-page-main-native")}
      >
        {!nativeShell && (
          <PageHeader
            className="largo-page-header"
            kicker="AI desk analyst"
            title={
              <span className="flex items-center gap-3">
                <ProductMark product="largo" size={36} />
                Largo
              </span>
            }
            subtitle="Live desk intel · grounded in platform data"
            badge={
              <Badge tone="accent" dot>
                AI Online
              </Badge>
            }
          />
        )}
        {nativeShell ? (
          <LargoNativeTerminal />
        ) : (
          <LargoTerminal
            fullPage
            nativeShell={false}
            onToggleFullscreen={() => void toggle()}
            isFullscreen={isFullscreen}
            fullscreenSupported={fullscreenSupported}
          />
        )}
        {!nativeShell && (
          <p className="font-mono text-[10px] text-sky-300/60 text-center pt-1">
            Educational. Not advice. You decide.
          </p>
        )}
      </main>
    </div>
  );
}
