/** Internal reference nav for Unusual Whales API docs. */

import { UW_REST_TOC } from "@/lib/uw-docs-catalog";

export type UwDocLink = {
  href: string;
  label: string;
  description?: string;
};

export type UwDocSection = {
  id: string;
  title: string;
  links: UwDocLink[];
};

export const UW_DOCS_SECTIONS: UwDocSection[] = [
  {
    id: "overview",
    title: "Overview",
    links: [
      {
        href: "/docs/unusual-whales",
        label: "Introduction",
        description: "Auth, plan, BlackOut policy",
      },
    ],
  },
  {
    id: "rest",
    title: "REST API",
    links: [
      {
        href: "/docs/unusual-whales/endpoints",
        label: "All endpoints",
        description: `${UW_REST_TOC.reduce((n, c) => n + c.count, 0)} endpoints · 32 categories`,
      },
      ...UW_REST_TOC.map((c) => ({
        href: `/docs/unusual-whales/endpoints#${c.id}`,
        label: c.title,
        description: String(c.count),
      })),
    ],
  },
];
