export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { heatMapsGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "BlackOut Thermal | BlackOut Academy",
  description: heatMapsGuide.description,
};

export default function Page() {
  return <LearnGuideView guide={heatMapsGuide} />;
}
