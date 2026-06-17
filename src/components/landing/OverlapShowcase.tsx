"use client";

import Image from "next/image";
import Link from "next/link";
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

  return (
    <section className={`relative py-20 md:py-32 px-4 md:px-8 ${reverse ? "bg-void-deep" : ""}`}>
      <div className={`max-w-7xl mx-auto relative min-h-[480px] md:min-h-[520px] ${reverse ? "md:flex-row-reverse" : ""}`}>
        {/* Image — tilted, overlaps */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, rotate: reverse ? 3 : -3 }}
          whileInView={{ opacity: 1, scale: 1, rotate: reverse ? 2 : -2 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className={`absolute ${reverse ? "right-0 md:right-4" : "left-0 md:left-4"} top-0 w-[85%] md:w-[58%] aspect-[16/10] z-10
            border-2 ${borderColor} shadow-glow-bull overflow-hidden`}
        >
          <Image src={image} alt={alt} fill className="object-cover object-center" sizes="60vw" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          {/* Corner tag */}
          <span className={`absolute top-4 left-4 font-mono text-[9px] tracking-[0.3em] uppercase ${labelColor} bg-black/80 px-2 py-1`}>
            ◆ {label}
          </span>
        </motion.div>

        {/* Text panel — overlaps image */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className={`absolute ${reverse ? "left-0 md:left-8" : "right-0 md:right-8"} bottom-0 md:bottom-12
            w-[92%] md:w-[48%] z-20 bg-black/95 border-2 ${borderColor}
            p-8 md:p-10 backdrop-blur-xl
            ${reverse ? "rotate-1" : "-rotate-1"} hover:rotate-0 transition-transform duration-500`}
        >
          <p className={`font-mono text-[10px] tracking-[0.4em] uppercase mb-3 ${labelColor}`}>
            {label}
          </p>
          <h2 className="font-anton text-4xl md:text-5xl lg:text-6xl leading-none tracking-tight text-white mb-2">
            {title}
          </h2>
          <p className={`font-syne text-xs tracking-[0.3em] uppercase mb-5 ${labelColor}`}>
            {tagline}
          </p>
          <p className="text-grey-400 text-sm leading-relaxed mb-8">{description}</p>
          <Link href={href} className="btn-primary text-sm !px-8 !py-3">
            {cta} →
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
