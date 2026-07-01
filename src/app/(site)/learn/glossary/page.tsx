export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGlossaryPage } from "@/components/learn/LearnGlossaryPage";
import { glossaryGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "Glossary | BlackOut Academy",
  description: glossaryGuide.description,
};

export default function Page() {
  return <LearnGlossaryPage />;
}
