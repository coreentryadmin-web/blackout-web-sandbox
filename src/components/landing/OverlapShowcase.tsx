"use client";

import { clsx } from "clsx";
import { FadeInImage } from "@/components/landing/FadeInImage";
import { FloatingPanel, ScrollRevealPanel } from "@/components/landing/FloatingPanel";
import { LandingCta } from "@/components/landing/LandingCta";
import { motion } from "framer-motion";

type OverlapShowcaseProps = {
  image: string;
  alt: string;
  label: string;
  title: string;
  tagline: string;
  description: string;
  cta: string;
  href: string;
  reverse?: boolean;
  accent?: "green" | "purple";
};

function TaglineWipe({ tagline, className }: { tagline: string; className: string }) {
  const words = tagline.replace(/\.$/, "").split(". ").map((w) => w.trim());

  return (
    <p className={clsx("font-syne text-xs tracking-[0.3em] uppercase mb-5 flex flex-wrap gap-x-2", className)}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          initial={{ clipPath: "inset(0 100% 0 0)" }}
          whileInView={{ clipPath: "inset(0 0% 0 0)" }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block"
        >
          {word}
          {i < words.length - 1 ? "." : tagline.endsWith(".") ? "." : ""}
        </motion.span>
      ))}
    </p>
  );
}

export function OverlapShowcase({
  image,
  alt,
  label,
  title,
  tagline,
  description,
  cta,
  href,
  reverse = false,
  accent = "green",
}: OverlapShowcaseProps) {
  const borderColor = accent === "green" ? "border-bull/50" : "border-purple/50";
  const labelColor = accent === "green" ? "text-bull" : "text-purple-light";
  const glowClass = accent === "green" ? "showcase-glow-green" : "showcase-glow-purple";
  const bgClass = accent === "green" ? "landing-showcase-green" : "landing-showcase-largo";

  return (
    <section
      className={clsx(
        "landing-section landing-section-cut relative py-20 md:py-32 px-4 md:px-8",
        bgClass,
        reverse && "landing-showcase-navy"
      )}
    >
      {accent === "green" && <div className="landing-dot-grid" aria-hidden />}

      <div className={clsx("max-w-7xl mx-auto relative min-h-[480px] md:min-h-[520px]", reverse && "md:flex-row-reverse")}>
        <FloatingPanel
          revealX={reverse ? 60 : -60}
          className={clsx(
            "absolute top-0 w-[85%] md:w-[58%] aspect-[16/10] z-10",
            reverse ? "right-0 md:right-4" : "left-0 md:left-4"
          )}
        >
          <div className={clsx("showcase-image-glow absolute -inset-8 -z-10 rounded-2xl", glowClass)} aria-hidden />
          <div className={clsx("relative w-full h-full border-2 overflow-hidden shadow-glow-bull", borderColor)}>
            <motion.div
              className="relative w-full h-full"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <FadeInImage src={image} alt={alt} fill sizes="60vw" />
            </motion.div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
            <span
              className={clsx(
                "absolute top-4 left-4 font-mono text-[9px] tracking-[0.3em] uppercase bg-black/80 px-2 py-1 z-10",
                labelColor
              )}
            >
              ◆ {label}
            </span>
          </div>
        </FloatingPanel>

        <ScrollRevealPanel
          revealX={reverse ? -60 : 60}
          revealDelay={0.12}
          className={clsx(
            "absolute bottom-0 md:bottom-12 w-[92%] md:w-[48%] z-20 bg-black/80 border-2 backdrop-blur-xl p-8 md:p-10",
            borderColor,
            accent === "green" ? "showcase-panel-green" : "showcase-panel-purple",
            reverse ? "left-0 md:left-8 rotate-1" : "right-0 md:right-8 -rotate-1",
            "hover:rotate-0 transition-transform duration-500"
          )}
        >
          <p className={clsx("font-mono text-[10px] tracking-[0.4em] uppercase mb-3", labelColor)}>{label}</p>
          <h2 className="font-anton text-4xl md:text-5xl lg:text-6xl leading-none tracking-tight text-white mb-2">
            {title}
          </h2>
          {accent === "purple" ? (
            <TaglineWipe tagline={tagline} className={labelColor} />
          ) : (
            <p className={clsx("font-syne text-xs tracking-[0.3em] uppercase mb-5", labelColor)}>{tagline}</p>
          )}
          <p className="text-grey-400 text-sm leading-relaxed mb-8">{description}</p>
          <LandingCta href={href} className="text-sm !px-8 !py-3">
            {cta} →
          </LandingCta>
        </ScrollRevealPanel>
      </div>
    </section>
  );
}
