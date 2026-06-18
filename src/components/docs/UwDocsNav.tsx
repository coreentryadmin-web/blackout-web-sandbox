"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { UW_DOCS_SECTIONS } from "@/lib/uw-docs-nav";

export function UwDocsNav() {
  const path = usePathname();

  return (
    <nav className="docs-ref-nav docs-ref-nav-compact" aria-label="Unusual Whales docs">
      {UW_DOCS_SECTIONS.map((section) => (
        <div key={section.id} className="docs-ref-nav-group">
          <p className="docs-ref-nav-heading">{section.title}</p>
          <ul className="docs-ref-nav-list">
            {section.links.map((link) => {
              const isAnchor = link.href.includes("#");
              const active =
                link.href === "/docs/unusual-whales"
                  ? path === "/docs/unusual-whales"
                  : !isAnchor && path.startsWith(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={clsx("docs-ref-nav-link", active && "docs-ref-nav-link-active")}
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
