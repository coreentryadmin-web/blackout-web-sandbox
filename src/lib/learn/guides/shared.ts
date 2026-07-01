import type {
  LearnCrossLink,
  LearnFaqItem,
  LearnFeature,
  LearnGuide,
  LearnGlossaryCategory,
  LearnStep,
} from "@/lib/learn/types";
import type { LearnSlug } from "@/lib/learn/nav";

export function defineToolGuide(opts: {
  slug: LearnSlug;
  chapter: number;
  title: string;
  description: string;
  overview: string[];
  howItWorks: { paragraphs: string[]; features?: LearnFeature[] };
  usage: { intro?: string; steps: LearnStep[] };
  crossLinks: LearnCrossLink[];
  dos: string[];
  donts: string[];
  faq: LearnFaqItem[];
  glossary?: LearnGlossaryCategory[];
  ctaBody?: string;
}): LearnGuide {
  const sections: LearnGuide["sections"] = [
    { type: "prose", id: "overview", title: "Overview", paragraphs: opts.overview },
    {
      type: "features",
      id: "how-it-works",
      title: "How it works",
      intro: opts.howItWorks.paragraphs[0],
      items:
        opts.howItWorks.features ??
        opts.howItWorks.paragraphs.slice(1).map((body, i) => ({
          title: `Core behavior ${i + 1}`,
          body,
        })),
    },
    {
      type: "steps",
      id: "usage",
      title: "Step-by-step workflow",
      intro: opts.usage.intro,
      steps: opts.usage.steps,
    },
    { type: "dos-donts", id: "dos-donts", title: "Best practices", dos: opts.dos, donts: opts.donts },
    {
      type: "cross-links",
      id: "cross-links",
      title: "Connected tools",
      intro: "BlackOut is one pipeline. These desks share the same GEX, flow, and intelligence layers.",
      links: opts.crossLinks,
    },
    { type: "faq", id: "faq", title: "FAQ", items: opts.faq },
  ];

  if (opts.glossary?.length) {
    sections.push({ type: "glossary", id: "glossary", title: "Key terms", categories: opts.glossary });
  }

  sections.push({
    type: "cta",
    id: "open-desk",
    title: `Open ${opts.title}`,
    body: opts.ctaBody ?? `Launch the live ${opts.title} desk and apply this chapter in real time.`,
    toolSlug: opts.slug,
    ctaLabel: "Launch desk",
  });

  return {
    slug: opts.slug,
    chapter: opts.chapter,
    title: opts.title,
    description: opts.description,
    sections,
  };
}

export const CROSS = {
  spx: (desc: string) => ({ slug: "spx-slayer" as const, description: desc }),
  helix: (desc: string) => ({ slug: "helix-flows" as const, description: desc }),
  largo: (desc: string) => ({ slug: "largo-ai" as const, description: desc }),
  hawk: (desc: string) => ({ slug: "night-hawk" as const, description: desc }),
  thermal: (desc: string) => ({ slug: "heat-maps" as const, description: desc }),
  watch: (desc: string) => ({ slug: "nights-watch" as const, description: desc }),
  grid: (desc: string) => ({ slug: "blackout-grid" as const, description: desc }),
};
