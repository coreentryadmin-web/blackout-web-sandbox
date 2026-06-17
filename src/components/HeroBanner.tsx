import Image from "next/image";
import { IMAGES } from "@/lib/images";

export function HeroBanner() {
  return (
    <div className="absolute inset-0">
      <Image
        src={IMAGES.heroBanner}
        alt="BlackOut Trading Community — eclipse over city skyline with live charts"
        fill
        priority
        className="object-cover object-center"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />
      <div className="absolute inset-0 bg-bull/5 mix-blend-overlay pointer-events-none" />
    </div>
  );
}
