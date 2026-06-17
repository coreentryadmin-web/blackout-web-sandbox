"use client";

import { motion } from "framer-motion";

const FEATURES = [
  { num: "01", title: "SPX LIVE", sub: "Dashboard", desc: "GEX, VWAP, regime, dealer positioning, 0DTE alerts.", tier: "Premium", accent: "border-bull text-bull", rotate: "-rotate-1" },
  { num: "02", title: "FLOW", sub: "Feed", desc: "Whale & dark pool alerts. Filter by premium, DTE, ticker.", tier: "Premium", accent: "border-purple text-purple-light", rotate: "rotate-1" },
  { num: "03", title: "SECTOR", sub: "Heatmaps", desc: "Live rotation heatmaps. See where institutions move.", tier: "Premium", accent: "border-grey-500 text-grey-300", rotate: "-rotate-2" },
  { num: "04", title: "AI", sub: "Largo", desc: "Desk-grade answers from flows, news, and technicals.", tier: "Premium", accent: "border-purple text-purple-light", rotate: "rotate-2" },
  { num: "05", title: "NIGHT", sub: "Hawk", desc: "2–10 DTE swing plays with full dossier intel.", tier: "Premium", accent: "border-bear text-bear", rotate: "-rotate-1" },
  { num: "06", title: "PRE-MARKET", sub: "Brief", desc: "AI SPX briefings at 6 AM PT. Levels & macro.", tier: "Premium", accent: "border-bull text-bull", rotate: "rotate-1" },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="relative py-32 px-4 md:px-8 overflow-hidden">
      {/* Overlapping section title — bleeds from hero */}
      <div className="relative z-10 mb-16 md:mb-24">
        <motion.p
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-2"
        >
          ◆ Platform
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="font-anton text-6xl md:text-8xl lg:text-9xl leading-none tracking-tight text-white mix-blend-difference"
        >
          EVERYTHING
          <br />
          <span className="text-stroke-green">YOU NEED</span>
        </motion.h2>
      </div>

      <div className="relative max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-0">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.num}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.08 }}
              className={`relative group ${i % 3 === 1 ? "md:-mt-8 lg:-mt-12" : ""} ${i % 3 === 2 ? "md:mt-4" : ""}`}
            >
              <div
                className={`bg-black/90 border-2 ${f.accent.split(" ")[0]} p-6 md:p-8
                  hover:scale-[1.03] hover:z-30 transition-all duration-300
                  ${f.rotate} hover:rotate-0 shadow-[0_20px_40px_rgba(0,0,0,0.5)]`}
              >
                <span className={`font-mono text-5xl font-bold opacity-20 ${f.accent.split(" ")[1]}`}>
                  {f.num}
                </span>
                <h3 className="font-syne font-extrabold text-3xl md:text-4xl leading-none tracking-tight text-white -mt-4">
                  {f.title}
                  <br />
                  <span className={f.accent.split(" ")[1]}>{f.sub}</span>
                </h3>
                <p className="text-grey-400 text-xs md:text-sm mt-4 leading-relaxed">{f.desc}</p>
                <span className="tier-badge-pro mt-5 inline-block">
                  {f.tier}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
