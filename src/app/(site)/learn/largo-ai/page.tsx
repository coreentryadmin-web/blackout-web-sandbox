export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { largoAiGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "Largo | BlackOut Academy",
  description: largoAiGuide.description,
};

export default function Page() {
  return <LearnGuideView guide={largoAiGuide} />;
}
