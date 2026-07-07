"use client";

import Image from "next/image";
import { clsx } from "clsx";
import type { SpxPlayAction } from "@/lib/spx-play-engine";
import { SPX_SNIPER_BACKDROP, sniperActionTint } from "@/lib/spx-sniper-backdrops";

type Props = {
  action?: SpxPlayAction;
};

export function SpxSniperBackdrop({ action }: Props) {
  return (
    <div className="spx-sniper-backdrop" aria-hidden>
      {/* Static hero image via next/image (fill, cover). The layer wrapper keeps
          the breathe animation + opacity/filter treatment. */}
      <div className="spx-sniper-backdrop-layer">
        <Image
          src={SPX_SNIPER_BACKDROP}
          alt=""
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover"
        />
      </div>
      <div className={clsx("spx-sniper-backdrop-scrim", sniperActionTint(action))} />
    </div>
  );
}
