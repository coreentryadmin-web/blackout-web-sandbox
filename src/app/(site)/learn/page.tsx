export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnHub } from "@/components/learn/LearnHub";

export const metadata: Metadata = {
  title: "Learn · BlackOut Academy",
  description:
    "Structured documentation for every BlackOut desk — textbook chapters, cross-linked tools, and navigation guides.",
};

export default function LearnPage() {
  return <LearnHub />;
}
