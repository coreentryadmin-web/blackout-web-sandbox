"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { IMAGES } from "@/lib/images";

export function HeroBanner() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const imageY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      <div className="landing-hero-mesh" aria-hidden />
      <motion.div className="absolute inset-0 will-change-transform" style={{ y: imageY }}>
        <div className="landing-hero-eclipse-glow eclipse-pulse absolute inset-0">
          <Image
            src={IMAGES.heroBanner}
            alt="BlackOut Trading Community — eclipse over city skyline with live charts"
            fill
            priority
            className="object-cover object-center"
            sizes="100vw"
          />
          <div className="hero-scan-line" aria-hidden />
        </div>
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />
      <div className="absolute inset-0 bg-bull/5 mix-blend-overlay pointer-events-none" />
    </div>
  );
}
