import type { Metadata } from "next";
import { TrackRecordView } from "@/components/track-record";

export const metadata: Metadata = {
  title: "Track Record · BlackOut",
  description:
    "Verified SPX Slayer and Night Hawk signal results — recorded at generation time and scored automatically.",
};

export default function TrackRecordPage() {
  return <TrackRecordView />;
}
