export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { gettingStartedGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "Getting Started | BlackOut Academy",
  description: gettingStartedGuide.description,
};

export default function GettingStartedPage() {
  return <LearnGuideView guide={gettingStartedGuide} />;
}
