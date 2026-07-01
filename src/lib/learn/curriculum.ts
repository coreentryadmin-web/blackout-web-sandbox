import { LEARN_NAV, learnHref, type LearnSlug } from "@/lib/learn/nav";

export type CurriculumChapter = {
  slug: LearnSlug;
  chapter: number;
  label: string;
  href: string;
};

export const CURRICULUM: CurriculumChapter[] = LEARN_NAV.map((item, i) => ({
  slug: item.slug,
  chapter: i + 1,
  label: item.label,
  href: learnHref(item.slug),
}));

export function curriculumFor(slug: LearnSlug): {
  current: CurriculumChapter;
  prev: CurriculumChapter | null;
  next: CurriculumChapter | null;
} {
  const idx = CURRICULUM.findIndex((c) => c.slug === slug);
  const current = CURRICULUM[idx] ?? CURRICULUM[0]!;
  return {
    current,
    prev: idx > 0 ? CURRICULUM[idx - 1]! : null,
    next: idx >= 0 && idx < CURRICULUM.length - 1 ? CURRICULUM[idx + 1]! : null,
  };
}
