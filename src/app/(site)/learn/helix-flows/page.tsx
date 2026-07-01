export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { helixFlowsGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "HELIX | BlackOut Academy",
  description: helixFlowsGuide.description,
};

export default function Page() {
  return <LearnGuideView guide={helixFlowsGuide} />;
}
