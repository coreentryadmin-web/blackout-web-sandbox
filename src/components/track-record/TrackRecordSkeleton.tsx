import { Skeleton } from "@/components/ui";

/**
 * Layout-matched skeleton for /track-record — mirrors header + two stat cards + footer blocks.
 */
export function TrackRecordSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading track record">
      <div className="space-y-2">
        <Skeleton width={160} height={12} rounded="sm" />
        <Skeleton width="min(100%, 320px)" height={36} rounded="md" />
        <Skeleton width="min(100%, 420px)" height={14} rounded="sm" />
      </div>

      <div className="space-y-4">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="space-y-3 rounded-2xl border border-white/10 bg-[rgba(8,9,14,0.6)] p-4 backdrop-blur"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <Skeleton width={72} height={10} rounded="sm" />
                <Skeleton width={140} height={18} rounded="sm" />
              </div>
              <Skeleton width={88} height={22} rounded="full" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((j) => (
                <Skeleton key={j} height={72} rounded="xl" />
              ))}
            </div>
          </div>
        ))}

        <Skeleton height={88} rounded="xl" />
        <Skeleton height={140} rounded="xl" />
      </div>
    </div>
  );
}
