import Image from "next/image";
import { clsx } from "clsx";

type PageBannerProps = {
  src: string;
  alt: string;
  className?: string;
};

export function PageBanner({ src, alt, className }: PageBannerProps) {
  return (
    <div
      className={clsx(
        "relative w-full aspect-[21/7] md:aspect-[21/6] overflow-hidden rounded-sm border border-bull/30 shadow-glow-bull mb-8",
        className
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover object-center"
        sizes="(max-width: 1280px) 100vw, 1280px"
        priority
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-black/60" />
    </div>
  );
}
