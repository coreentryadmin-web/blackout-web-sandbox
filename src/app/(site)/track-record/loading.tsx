import { TrackRecordSkeleton } from "@/components/track-record";
import { PageShell } from "@/components/ui";

/** Route-level loading UI — layout-matched skeleton, no branded spinner. */
export default function TrackRecordLoading() {
  return (
    <PageShell>
      <div className="content-rail mx-auto max-w-3xl pb-12 pt-2">
        <TrackRecordSkeleton />
      </div>
    </PageShell>
  );
}
