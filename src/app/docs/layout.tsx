import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin-access";

/** Admin-only gate for internal engineering/architecture docs. These pages
 * expose internal analysis and live UW/Polygon endpoint probes, so they must
 * never be reachable by paying premium customers — admins only. */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}
