export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { spxSlayerGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "SPX Slayer | BlackOut Academy",
  description: spxSlayerGuide.description,
};

export default function Page() {
  return <LearnGuideView guide={spxSlayerGuide} />;
}
