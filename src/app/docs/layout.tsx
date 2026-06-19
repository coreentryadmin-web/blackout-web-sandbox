import type { ReactNode } from "react";
import { requireTier } from "@/lib/auth-access";

/** Premium gate for internal docs not covered by nested layouts. */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  await requireTier("premium");
  return children;
}
