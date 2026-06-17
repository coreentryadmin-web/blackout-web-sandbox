import Image from "next/image";
import { clsx } from "clsx";

type BrandImageProps = {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
  aspect?: "video" | "wide" | "banner";
};

const aspectClasses = {
  video: "aspect-video",
  wide: "aspect-[16/10]",
  banner: "aspect-[21/9]",
};

export function BrandImage({
  src,
  alt,
  priority = false,
  className,
  aspect = "wide",
}: BrandImageProps) {
  return (
    <div
      className={clsx(
        "relative overflow-hidden border border-bull/40 shadow-glow-bull",
        aspectClasses[aspect],
        className
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        className="object-cover object-center"
        sizes="(max-width: 768px) 100vw, 1200px"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}
