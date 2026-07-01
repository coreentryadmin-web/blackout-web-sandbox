"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { glossaryGuide, GLOSSARY_CATEGORIES } from "@/lib/learn/guides/glossary";
import { LearnReveal } from "@/components/learn/LearnMotion";

export function LearnGlossaryPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return GLOSSARY_CATEGORIES;
    return GLOSSARY_CATEGORIES.map((cat) => ({
      ...cat,
      terms: cat.terms.filter(
        (t) => t.term.toLowerCase().includes(q) || t.def.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.terms.length > 0);
  }, [q]);

  const guideWithFilteredGlossary = useMemo(() => {
    if (!q) return glossaryGuide;
    return {
      ...glossaryGuide,
      sections: glossaryGuide.sections.map((s) =>
        s.type === "glossary" ? { ...s, categories: filtered } : s
      ),
    };
  }, [q, filtered]);

  return (
    <>
      <LearnReveal>
        <div className="learn-glossary-search mb-8">
          <Search className="size-4 text-mute" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search terms and definitions…"
            className="learn-glossary-input"
            aria-label="Search glossary"
          />
        </div>
      </LearnReveal>
      <LearnGuideView guide={guideWithFilteredGlossary} />
    </>
  );
}
