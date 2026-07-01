export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { nightsWatchGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "Night's Watch | BlackOut Academy",
  description: nightsWatchGuide.description,
};

export default function Page() {
  return <LearnGuideView guide={nightsWatchGuide} />;
}
