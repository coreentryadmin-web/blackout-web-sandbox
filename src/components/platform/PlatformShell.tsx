import Image from "next/image";
import { clsx } from "clsx";
import type { ReactNode } from "react";

export type PlatformVariant = "dashboard" | "flows" | "heatmap" | "largo" | "nighthawk";

type PlatformShellProps = {
  variant: PlatformVariant;
  title: string;
  subtitle?: string;
  imageSrc?: string;
  imageAlt?: string;
  children: ReactNode;
};

const CONFIG: Record<
  PlatformVariant,
  {
    ambient: string;
    frame: string;
    label: string;
    titleClass: string;
    heroArt: string;
    badgeClass: string;
    imagePosition?: string;
  }
> = {
  dashboard: {
    ambient: "platform-ambient-dashboard",
    frame: "platform-frame-dashboard",
    label: "◆ SPX SNIPER OPS",
    titleClass: "text-white platform-title-glow-green",
    heroArt: "platform-hero-dashboard",
    badgeClass: "badge-live",
    imagePosition: "object-[center_22%]",
  },
  flows: {
    ambient: "platform-ambient-flows",
    frame: "platform-frame-flows",
    label: "◆ INSTITUTIONAL FLOW",
    titleClass: "platform-title-flow",
    heroArt: "platform-hero-flows",
    badgeClass: "badge-live badge-live-purple",
  },
  heatmap: {
    ambient: "platform-ambient-heatmap",
    frame: "platform-frame-heatmap",
    label: "◆ SECTOR ROTATION",
    titleClass: "platform-title-thermal",
    heroArt: "platform-hero-heatmap",
    badgeClass: "badge-thermal",
  },
  largo: {
    ambient: "platform-ambient-largo",
    frame: "platform-frame-largo",
    label: "◆ AI DESK — LARGO",
    titleClass: "text-purple-light platform-title-glow-purple",
    heroArt: "platform-hero-largo",
    badgeClass: "badge-ai",
    imagePosition: "object-[center_30%]",
  },
  nighthawk: {
    ambient: "platform-ambient-nighthawk",
    frame: "platform-frame-nighthawk",
    label: "◆ SWING RADAR",
    titleClass: "platform-title-nighthawk",
    heroArt: "platform-hero-nighthawk",
    badgeClass: "badge-ops",
  },
};

function HeroArt({ variant }: { variant: PlatformVariant }) {
  const art = CONFIG[variant].heroArt;

  return (
    <div className={clsx("platform-hero-art", art)} aria-hidden>
      {variant === "flows" && (
        <>
          <span className="platform-ghost-text">FLOW</span>
          <div className="platform-stream-lines" />
        </>
      )}
      {variant === "heatmap" && (
        <>
          <span className="platform-ghost-text platform-ghost-thermal">HEAT</span>
          <div className="platform-thermal-grid" />
        </>
      )}
      {variant === "nighthawk" && (
        <>
          <div className="platform-nv-scope" />
          <span className="platform-ghost-text platform-ghost-nv">HAWK</span>
        </>
      )}
    </div>
  );
}

function HeroImage({
  src,
  alt,
  variant,
}: {
  src: string;
  alt: string;
  variant: PlatformVariant;
}) {
  const { imagePosition } = CONFIG[variant];

  return (
    <div className="platform-hero-image-wrap scan-line">
      <div className="relative aspect-[16/9] md:aspect-[2/1] min-h-[240px] md:min-h-[320px]">
        <Image
          src={src}
          alt={alt}
          fill
          className={clsx("object-cover", imagePosition ?? "object-center")}
          sizes="(max-width: 1280px) 100vw, 1280px"
          priority
        />
      </div>
      <div className="platform-hud-corners" aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-black/10 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50 pointer-events-none" />
    </div>
  );
}

export function PlatformShell({
  variant,
  title,
  subtitle,
  imageSrc,
  imageAlt,
  children,
}: PlatformShellProps) {
  const theme = CONFIG[variant];

  return (
    <>
      <div className={clsx("platform-ambient", theme.ambient)} aria-hidden />
      <main className="relative z-10 max-w-7xl mx-auto px-4 md:px-6 pt-24 pb-16">
        <header className="mb-10">
          {imageSrc && imageAlt ? (
            <HeroImage src={imageSrc} alt={imageAlt} variant={variant} />
          ) : (
            <HeroArt variant={variant} />
          )}

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mt-8 platform-header-reveal">
            <div>
              <p className="font-mono text-[10px] tracking-[0.45em] text-grey-300 uppercase mb-2">
                {theme.label}
              </p>
              <h1
                className={clsx(
                  "font-anton text-5xl md:text-7xl lg:text-8xl leading-[0.9] tracking-wide uppercase",
                  theme.titleClass
                )}
              >
                {title}
              </h1>
              {subtitle && (
                <p className="font-mono text-xs md:text-sm text-grey-200 mt-3 tracking-widest uppercase">
                  {subtitle}
                </p>
              )}
            </div>
            <span className={theme.badgeClass}>
              <span className="badge-live-dot" />
              {variant === "largo" ? "AI Online" : variant === "heatmap" ? "Thermal Scan" : variant === "nighthawk" ? "Night Ops" : "Live"}
            </span>
          </div>
        </header>

        <div className={clsx("platform-content-frame", theme.frame)}>{children}</div>
      </main>
    </>
  );
}
