"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { IMAGES } from "@/lib/images";

/**
 * Full-screen cinematic backdrop for the Night Hawk desk — the night-vision operator
 * scene with perpetual "glow / dim" life: the whole frame breathes brightness + a green
 * glow pulses over the operator's eyes. Reduced-motion users get a static frame.
 * Scrimmed so the dense playbook / agent UI layered on top stays legible.
 * Fixed at z-0 (behind content); the radar HUD + scanlines layer over it.
 */
export function NightHawkBackdrop() {
  const reduced = useReducedMotion();
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* operator image — slow brightness breathe + subtle ken-burns */}
      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1.04 }}
        animate={
          reduced
            ? { scale: 1.04 }
            : {
                scale: [1.03, 1.07, 1.03],
                filter: ["brightness(0.9)", "brightness(1.12)", "brightness(0.9)"],
              }
        }
        transition={{ duration: 9, ease: "easeInOut", repeat: Infinity }}
      >
        <Image
          src={IMAGES.nighthawkOperator}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ objectPosition: "center 42%" }}
        />
      </motion.div>

      {/* pulsing green glow over the operator's eyes — the "glowing / dimming" effect */}
      <motion.div
        className="absolute inset-0 mix-blend-screen"
        animate={reduced ? { opacity: 0.28 } : { opacity: [0.14, 0.46, 0.14] }}
        transition={{ duration: 4.2, ease: "easeInOut", repeat: Infinity }}
        style={{
          background:
            "radial-gradient(22% 16% at 40% 49%, rgba(0,230,118,0.55), rgba(0,230,118,0) 70%)",
        }}
      />

      {/* legibility scrims — keep the upper frame (sky / eyes / A-10) visible, darken the
          content zone + base into the void so the desk UI stays readable + seams cleanly. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,4,7,0.30) 0%, rgba(4,4,7,0.40) 28%, rgba(4,4,7,0.66) 58%, rgba(4,4,7,0.88) 82%, #040407 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(125% 80% at 50% 32%, transparent 42%, rgba(4,4,7,0.55) 100%)",
        }}
      />
    </div>
  );
}
