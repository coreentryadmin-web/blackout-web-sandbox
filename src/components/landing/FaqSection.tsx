"use client";

import { motion } from "framer-motion";

const FAQS = [
  {
    q: "What is BlackOut Trading?",
    a: "An institutional-grade trading intelligence platform — live flow alerts, a 0DTE SPX war room, AI desk analysis, live sector heatmaps, and Night Hawk swing scanner. Everything in one place, nothing held back.",
  },
  {
    q: "How do I get Premium access?",
    a: "Create your free BlackOut account, then choose monthly, yearly, or lifetime access using the same email. One click unlocks the full platform.",
  },
  {
    q: "What's included in Premium?",
    a: "HELIX live flow feed, SPX Sniper dashboard, full sector heatmaps, Largo AI desk terminal, and Night Hawk swing scanner — the entire arsenal, one membership.",
  },
  {
    q: "Do I need a broker connection?",
    a: "No. BlackOut is a pure intelligence and signal platform. You execute on your own broker — we surface the data, structure, and setups before price moves.",
  },
  {
    q: "Is this financial advice?",
    a: "No. BlackOut delivers market data and pattern recognition tools for educational purposes. Every trade is your decision — we just make sure you're never trading blind.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="landing-section landing-section-cut relative py-24 md:py-32 px-4 md:px-8 overflow-hidden">
      <div className="max-w-3xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12 text-center md:text-left"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-2">◆ FAQ&apos;s</p>
          <h2 className="font-anton text-5xl md:text-6xl tracking-tight text-white leading-none">
            QUESTIONS<span className="text-bull">?</span>
          </h2>
        </motion.div>

        <div className="flex flex-col gap-3">
          {FAQS.map((item, i) => (
            <motion.div
              key={item.q}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
            >
              <details className="faq-item group">
                <summary className="faq-question">{item.q}</summary>
                <p className="faq-answer">{item.a}</p>
              </details>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
