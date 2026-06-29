import { Skeleton } from "@/components/ui";

export default function LearnLoading() {
  return (
    <div className="min-w-0 space-y-8" aria-busy aria-label="Loading documentation">
      <div className="space-y-3 border-b border-white/10 pb-8">
        <Skeleton width={120} height={12} rounded="sm" />
        <Skeleton width="min(100%, 320px)" height={36} rounded="md" />
        <Skeleton width="min(100%, 520px)" height={20} rounded="sm" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton width="min(100%, 240px)" height={24} rounded="md" />
          <Skeleton width="100%" height={72} rounded="lg" />
        </div>
      ))}
    </div>
  );
}
