"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { POLYGON_DOCS_SECTIONS } from "@/lib/polygon-docs-nav";

export function PolygonDocsNav() {
  const path = usePathname();

  return (
    <nav className="docs-ref-nav" aria-label="Polygon docs">
      {POLYGON_DOCS_SECTIONS.map((section) => (
        <div key={section.id} className="docs-ref-nav-group">
          <p className="docs-ref-nav-heading">{section.title}</p>
          <ul className="docs-ref-nav-list">
            {section.links.map((link) => {
              const active =
                link.href === "/docs/polygon"
                  ? path === "/docs/polygon"
                  : path.startsWith(link.href);
              const isAnchor = link.href.includes("#");
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={clsx("docs-ref-nav-link", active && !isAnchor && "docs-ref-nav-link-active")}
                  >
                    <span>{link.label}</span>
                    {link.description && (
                      <span className="docs-ref-nav-desc">{link.description}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
