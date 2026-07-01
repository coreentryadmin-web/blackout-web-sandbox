import type { LearnSlug } from "@/lib/learn/nav";

export type LearnSectionLink = { id: string; label: string };

export type LearnStat = { label: string; value: string; sub?: string };

export type LearnPipelineLayer = {
  layer: string;
  accent: "cyan" | "sky" | "indigo";
  items: string[];
};

export type LearnStep = { title: string; body: string };

export type LearnTimelineItem = {
  phase: string;
  time: string;
  toolSlug?: LearnSlug;
  toolLabel?: string;
  href?: string;
  action: string;
};

export type LearnFeature = { title: string; body: string };

export type LearnCrossLink = {
  slug: LearnSlug;
  description: string;
};

export type LearnFaqItem = { q: string; a: string };

export type LearnGlossaryTerm = { term: string; def: string };

export type LearnGlossaryCategory = {
  name: string;
  terms: LearnGlossaryTerm[];
};

export type LearnNavItem = {
  label: string;
  href: string;
  description: string;
  badge?: string;
};

export type LearnSection =
  | { type: "prose"; id: string; title: string; paragraphs: string[] }
  | { type: "stats"; id: string; title?: string; items: LearnStat[] }
  | { type: "pipeline"; id: string; title: string; intro?: string; layers: LearnPipelineLayer[] }
  | { type: "steps"; id: string; title: string; intro?: string; steps: LearnStep[] }
  | { type: "timeline"; id: string; title: string; intro?: string; items: LearnTimelineItem[] }
  | { type: "features"; id: string; title: string; intro?: string; items: LearnFeature[] }
  | { type: "tool-map"; id: string; title: string; intro?: string; slugs: LearnSlug[] }
  | { type: "dos-donts"; id: string; title: string; dos: string[]; donts: string[] }
  | { type: "cross-links"; id: string; title: string; intro?: string; links: LearnCrossLink[] }
  | { type: "faq"; id: string; title: string; items: LearnFaqItem[] }
  | { type: "glossary"; id: string; title: string; categories: LearnGlossaryCategory[] }
  | { type: "site-nav"; id: string; title: string; intro?: string; items: LearnNavItem[] }
  | { type: "callout"; id: string; variant: "note" | "tip" | "warning"; title: string; body: string }
  | { type: "cta"; id: string; title: string; body: string; toolSlug: LearnSlug; ctaLabel?: string };

export type LearnGuide = {
  slug: LearnSlug;
  chapter: number;
  title: string;
  description: string;
  kicker?: string;
  sections: LearnSection[];
};

export function sectionLinks(sections: LearnSection[]): LearnSectionLink[] {
  return sections
    .filter((s): s is LearnSection & { title: string } => "title" in s && Boolean(s.title))
    .map((s) => ({ id: s.id, label: s.title }));
}
